"""Semântica real das condições/transações usando moto (DynamoDB em memória). Requer requirements-dev.txt."""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest

pytest.importorskip("moto")
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

from app.adapters.dynamodb_store import DynamoDBCharacterStore  # noqa: E402
from app.application.handlers import MessageHandlers, Outcome  # noqa: E402
from app.domain.models import Character, HitPoints, HoldStatus  # noqa: E402

from .conftest import REPO_ROOT, outcome_event, validation_request  # noqa: E402

MANIFEST = json.loads((REPO_ROOT / "infra" / "manifests" / "characters.json").read_text(encoding="utf-8"))


def _create_tables(client) -> None:
    for table in MANIFEST["dynamodb"]["tables"]:
        params = {
            "TableName": table["name"],
            "KeySchema": table["keySchema"],
            "AttributeDefinitions": table["attributeDefinitions"],
            "BillingMode": table["billingMode"],
        }
        if table.get("globalSecondaryIndexes"):
            params["GlobalSecondaryIndexes"] = table["globalSecondaryIndexes"]
        client.create_table(**params)


@pytest.fixture
def dynamo(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-1")
        _create_tables(client)
        yield DynamoDBCharacterStore(
            region="us-east-1",
            endpoint_url=None,
            table_characters="characters",
            table_inbox="character_inbox",
            table_outbox="character_outbox",
            client=client,
        )


def _character(clock, **kw) -> Character:
    data: dict[str, Any] = dict(
        id="p1", campaign_id="c1", name="Lyra", hp=HitPoints(10, 10), max_items=2, created_at=clock(), updated_at=clock()
    )
    data.update(kw)
    return Character(**data)


def test_fluxo_completo_com_condicoes_reais(dynamo, clock):
    dynamo.create_character(_character(clock))
    handlers = MessageHandlers(dynamo, clock=clock)

    first = validation_request(operation_id="op-1")
    assert handlers.handle_validation_requested(first).outcome is Outcome.APPROVED
    assert handlers.handle_validation_requested(first).outcome is Outcome.DUPLICATE
    assert handlers.handle_validation_requested(validation_request(operation_id="op-2")).outcome is Outcome.APPROVED
    assert handlers.handle_validation_requested(validation_request(operation_id="op-3")).outcome is Outcome.REJECTED

    character = dynamo.get_character("p1")
    assert (character.slots_used, character.slots_available) == (2, 0)

    assert handlers.handle_acquisition_cancelled(outcome_event("cancelled", "op-1")).outcome is Outcome.HOLD_RELEASED
    assert handlers.handle_item_acquired(outcome_event("acquired", "op-2")).outcome is Outcome.HOLD_COMMITTED
    assert dynamo.get_character("p1").slots_available == 1
    assert {h.operation_id: h.status for h in dynamo.list_holds("p1")} == {
        "op-1": HoldStatus.RELEASED,
        "op-2": HoldStatus.COMMITTED,
    }

    assert dynamo.outbox_stats().pending == 3
    claimed = dynamo.claim_outbox(10, 30, "me", clock())
    assert len(claimed) == 3 and dynamo.claim_outbox(10, 30, "other", clock()) == []
    for record in claimed:
        dynamo.mark_outbox_published(record.message_id, "me", clock())
    assert dynamo.outbox_stats().pending == 0


def test_reserva_condicional_nao_ultrapassa_capacidade(dynamo, clock):
    dynamo.create_character(_character(clock, max_items=3))
    handlers = MessageHandlers(dynamo, clock=clock)
    outcomes = [
        handlers.handle_validation_requested(validation_request(operation_id=str(uuid.uuid4()))).outcome for _ in range(6)
    ]
    assert outcomes.count(Outcome.APPROVED) == 3
    assert dynamo.get_character("p1").slots_available == 0


def test_lapide_bloqueia_pedido_atrasado(dynamo, clock):
    dynamo.create_character(_character(clock))
    handlers = MessageHandlers(dynamo, clock=clock)
    assert handlers.handle_acquisition_cancelled(outcome_event("cancelled", "op-9")).outcome is Outcome.TOMBSTONE_CREATED
    assert handlers.handle_validation_requested(validation_request(operation_id="op-9")).outcome is Outcome.REJECTED
    assert dynamo.get_character("p1").slots_used == 0


def test_save_profile_com_versao_e_capacidade(dynamo, clock):
    from app.application.ports import ConcurrencyConflict

    dynamo.create_character(_character(clock, max_items=2))
    MessageHandlers(dynamo, clock=clock).handle_validation_requested(validation_request())
    current = dynamo.get_character("p1")
    with pytest.raises(ConcurrencyConflict):  # reduzir 2 -> 0 com 1 reservado
        dynamo.save_profile(current.evolve(version=2), expected_version=1, max_items_delta=-2)
    dynamo.save_profile(current.evolve(version=2, name="Nova"), expected_version=1, max_items_delta=3)
    updated = dynamo.get_character("p1")
    assert (updated.name, updated.max_items, updated.slots_available, updated.version) == ("Nova", 5, 4, 2)
    with pytest.raises(ConcurrencyConflict):
        dynamo.save_profile(updated.evolve(version=3), expected_version=1, max_items_delta=0)
