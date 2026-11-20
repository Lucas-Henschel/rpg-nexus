"""Semântica real das condições/transações usando moto (DynamoDB em memória). Requer requirements-dev.txt."""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest

pytest.importorskip("moto")
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

from app.adapters.dynamodb_read_model import DynamoDBReadModel  # noqa: E402
from app.adapters.dynamodb_store import DynamoDBCharacterStore  # noqa: E402
from app.application.handlers import MessageHandlers, Outcome  # noqa: E402
from app.application.read_model import Projector, RosterQuery  # noqa: E402
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


# --- CQRS: modelo de leitura em tabela própria ------------------------------------------------------


def test_modelo_de_leitura_no_dynamodb_acompanha_a_saga_e_recusa_projecao_antiga(dynamo, clock):
    read_model = DynamoDBReadModel(region="us-east-1", endpoint_url=None, table="character_read_model", client=dynamo._client)
    read_model.ping()
    dynamo.create_character(_character(clock, max_items=3))
    projector = Projector(dynamo, read_model, clock=clock)
    dispatch = projector.after(MessageHandlers(dynamo, clock=clock).dispatch)

    dispatch(validation_request(operation_id="op-1", message_id=str(uuid.uuid4())))
    clock.advance(seconds=1)
    dispatch(validation_request(operation_id="op-2", message_id=str(uuid.uuid4())))
    clock.advance(seconds=1)
    dispatch(outcome_event("cancelled", "op-2", message_id=str(uuid.uuid4())))

    roster = RosterQuery(read_model).by_campaign("c1")
    (summary,) = roster.items
    assert (summary.name, summary.slots_used, summary.slots_available) == ("Lyra", 1, 2)
    assert (summary.holds_held, summary.holds_released) == (1, 1)
    assert roster.totals["holdsHeld"] == 1
    assert RosterQuery(read_model).by_campaign("outra").items == []

    antigo = summary.__class__(**{**summary.__dict__, "name": "Antigo", "projected_at": summary.projected_at.replace(year=2020)})
    assert read_model.put_summary(antigo) is False
    assert RosterQuery(read_model).by_campaign("c1").items[0].name == "Lyra"


def test_outbox_guarda_e_devolve_o_contexto_de_trace(dynamo, clock):
    from app.application.ports import InboxRecord, OutboxRecord

    traceparent = "00-" + "ab" * 16 + "-" + "cd" * 8 + "-01"
    inbox = InboxRecord(str(uuid.uuid4()), "rpg.test.v1", "op", "REJECTED", clock())
    outbox = OutboxRecord(
        message_id=str(uuid.uuid4()),
        type="rpg.character.rejected.v1",
        routing_key="character.rejected.v1",
        correlation_id="op",
        envelope={"payload": {}},
        created_at=clock(),
        trace_context={"traceparent": traceparent},
    )
    dynamo.record_outcome(inbox, outbox)
    (claimed,) = dynamo.claim_outbox(10, 30, "replica-a", clock())
    assert claimed.trace_context == {"traceparent": traceparent}


# --- Dinheiro e modelos de ficha (escritas condicionais reais) ------------------------------------


def test_debito_e_reembolso_no_dynamodb(dynamo, clock):
    from .conftest import money_debit_request, money_refund_request

    dynamo.create_character(_character(clock, owner_id="user-ana", currency_amount=50))
    handlers = MessageHandlers(dynamo, clock=clock)

    assert handlers.dispatch(money_debit_request(operation_id="op-1", amount=30)).outcome is Outcome.APPROVED
    assert dynamo.get_character("p1").currency_amount == 20
    # saldo insuficiente: a condição do DynamoDB recusa, e o handler responde com recusa
    assert handlers.dispatch(money_debit_request(operation_id="op-2", amount=30)).outcome is Outcome.REJECTED
    # mesma operação de novo, outro messageId: não cobra de novo
    assert handlers.dispatch(money_debit_request(operation_id="op-1", amount=30)).outcome is Outcome.APPROVED_REPLAY
    assert dynamo.get_character("p1").currency_amount == 20

    assert handlers.dispatch(money_refund_request("op-1")).outcome is Outcome.MONEY_REFUNDED
    assert handlers.dispatch(money_refund_request("op-1")).outcome is Outcome.ALREADY_APPLIED
    assert dynamo.get_character("p1").currency_amount == 50
    statuses = {m.operation_id: m.status.value for m in dynamo.list_money_entries("p1")}
    assert statuses == {"op-1": "REFUNDED"}
    assert dynamo.list_holds("p1") == []  # MONEY# não se mistura com HOLD#


def test_debito_condicional_recusa_quando_saldo_mudou_entre_leitura_e_escrita(dynamo, clock):
    from app.application.ports import ConcurrencyConflict, InboxRecord, OutboxRecord
    from app.domain.models import MoneyEntry, MoneyStatus

    dynamo.create_character(_character(clock, owner_id="user-ana", currency_amount=10))
    entry = MoneyEntry("op-1", "p1", "PURCHASE", 30, MoneyStatus.DEBITED, clock(), clock(), campaign_id="c1", user_id="user-ana")
    inbox = InboxRecord(str(uuid.uuid4()), "t", "op", "APPROVED", clock())
    outbox = OutboxRecord(str(uuid.uuid4()), "t", "rk", "op", {}, clock())
    with pytest.raises(ConcurrencyConflict):
        dynamo.debit_money(inbox, entry, outbox)
    assert dynamo.get_character("p1").currency_amount == 10


def test_ajuste_manual_no_dynamodb(dynamo, clock):
    from app.application.ports import AdjustmentAlreadyApplied, ConcurrencyConflict
    from app.domain.models import MoneyEntry

    dynamo.create_character(_character(clock, owner_id="user-ana"))
    plus = MoneyEntry("ADJ-1", "p1", "ADJUSTMENT", 25, None, clock(), clock())
    dynamo.adjust_money(plus)
    with pytest.raises(AdjustmentAlreadyApplied):
        dynamo.adjust_money(plus)
    with pytest.raises(ConcurrencyConflict):
        dynamo.adjust_money(MoneyEntry("ADJ-2", "p1", "ADJUSTMENT", -26, None, clock(), clock()))
    assert dynamo.get_character("p1").currency_amount == 25


def test_patch_da_ficha_nao_sobrescreve_o_saldo(dynamo, clock):
    from app.domain.models import MoneyEntry

    character = _character(clock, owner_id="user-ana", currency_amount=40)
    dynamo.create_character(character)
    dynamo.adjust_money(MoneyEntry("ADJ-1", "p1", "ADJUSTMENT", -15, None, clock(), clock()))
    # a edição usa a ficha lida antes do ajuste (saldo 40): o saldo gravado continua 25
    dynamo.save_profile(character.evolve(name="Lyra II", version=2, currency_name="Ouro"), 1, 0)
    saved = dynamo.get_character("p1")
    assert (saved.name, saved.currency_name, saved.currency_amount) == ("Lyra II", "Ouro", 25)


def test_listagem_filtra_pelo_dono(dynamo, clock):
    dynamo.create_character(_character(clock, id="a1", owner_id="user-ana"))
    dynamo.create_character(_character(clock, id="b1", owner_id="user-bia"))
    assert [c.id for c in dynamo.list_characters("c1", 50, None, owner_id="user-ana").items] == ["a1"]
    assert {c.id for c in dynamo.list_characters("c1", 50, None).items} == {"a1", "b1"}


def test_modelos_com_versoes_no_dynamodb(dynamo, clock):
    from app.adapters.dynamodb_templates import DynamoDBTemplateStore
    from app.application.ports import ConcurrencyConflict
    from app.domain.models import CharacterTemplate, TemplateDefinition

    store = DynamoDBTemplateStore(region="us-east-1", endpoint_url=None, table="character_templates", client=dynamo._client)
    store.ping()
    definition = TemplateDefinition({"template": None, "header": {}, "columns": [[]]}, {"forca": 10}, {}, 12, 5, "Moedas", 20)
    v1 = CharacterTemplate("t1", "user-ana", "Fantasia", None, 1, definition, clock(), clock())
    store.create_template(v1)

    v2 = v1.evolve(name="Fantasia v2", version=2, definition=TemplateDefinition(None, {"forca": 12}, {}, 30, 5, "Ouro", 0))
    store.add_version(v2, expected_version=1)
    with pytest.raises(ConcurrencyConflict):  # edição concorrente que ainda acha que a atual é a v1
        store.add_version(v2.evolve(version=2, name="Por cima"), expected_version=1)

    assert store.get_template("t1").name == "Fantasia v2"
    old = store.get_template("t1", version=1)
    assert (old.name, old.definition.hp_max, old.definition.attributes) == ("Fantasia", 12, {"forca": 10})
    assert [t.id for t in store.list_templates("user-ana")] == ["t1"]
    assert store.list_templates("user-bia") == []

    store.delete_template("t1", "user-bia")  # de outra pessoa: nada acontece
    assert store.list_templates("user-ana") != []
    store.delete_template("t1", "user-ana")
    assert store.list_templates("user-ana") == []
    assert store.get_template("t1").deleted is True
    assert store.get_template("t1", version=1).name == "Fantasia"  # versões continuam legíveis


def test_participacao_no_dynamodb_respeita_a_ordem_dos_eventos(dynamo, clock):
    from .conftest import member_joined, member_removed

    handlers = MessageHandlers(dynamo, clock=clock)
    assert (
        handlers.dispatch(member_joined("camp", "u1", "OWNER", at="2026-11-11T12:00:00Z")).outcome is Outcome.MEMBERSHIP_APPLIED
    )
    assert dynamo.get_membership("camp", "u1").is_owner
    handlers.dispatch(member_removed("camp", "u1", at="2026-11-11T13:00:00Z"))
    stale = handlers.dispatch(member_joined("camp", "u1", "OWNER", at="2026-11-11T12:30:00Z"))
    assert stale.outcome is Outcome.STALE
    assert dynamo.get_membership("camp", "u1").active is False
    assert dynamo.get_membership("camp", "ninguem") is None


def test_modelo_da_campanha_no_dynamodb_respeita_a_ordem_dos_eventos(dynamo, clock):
    from .conftest import template_assigned

    handlers = MessageHandlers(dynamo, clock=clock)
    assert handlers.dispatch(template_assigned("camp", "t1", 3, "Aventureiro", at="2026-11-11T13:00:00Z")).outcome is (
        Outcome.CAMPAIGN_TEMPLATE_APPLIED
    )
    assert handlers.dispatch(template_assigned("camp", "t1", 1, at="2026-11-11T12:00:00Z")).outcome is Outcome.STALE
    assigned = dynamo.get_campaign_template("camp")
    assert (assigned.template_id, assigned.version, assigned.name) == ("t1", 3, "Aventureiro")
    assert dynamo.get_campaign_template("outra") is None
