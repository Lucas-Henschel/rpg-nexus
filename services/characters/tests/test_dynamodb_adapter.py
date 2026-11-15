"""Adaptador DynamoDB sem rede: cada chamada é validada contra o modelo oficial da API (botocore).

O cliente fake:
* valida os parâmetros com o ``ParamValidator`` do botocore (mesma checagem feita antes de enviar à AWS);
* verifica as regras de expressão do DynamoDB que causam ``ValidationException`` em produção
  (todo alias ``#x``/``:v`` usado precisa estar definido e todo alias definido precisa ser usado);
* devolve respostas/erros programados, permitindo testar o mapeamento de ``CancellationReasons``.

A semântica completa das condições é coberta por ``test_dynamodb_moto.py`` (moto) e pelo teste de
integração contra MiniStack/AWS.
"""

from __future__ import annotations

import re
from collections import defaultdict, deque
from typing import Any

import pytest

boto3 = pytest.importorskip("boto3")
from botocore.exceptions import ClientError  # noqa: E402
from botocore.validate import ParamValidator  # noqa: E402

from app.adapters.dynamodb_store import DynamoDBCharacterStore  # noqa: E402
from app.application.ports import ConcurrencyConflict, DuplicateMessage, InboxRecord, OutboxRecord, StoreUnavailable  # noqa: E402
from app.domain.models import CapacityHold, Character, HitPoints, HoldStatus, Portrait  # noqa: E402

NAME = re.compile(r"#[A-Za-z0-9_]+")
VALUE = re.compile(r":[A-Za-z0-9_]+")
EXPRESSION_KEYS = (
    "UpdateExpression",
    "ConditionExpression",
    "KeyConditionExpression",
    "FilterExpression",
    "ProjectionExpression",
)


def check_expressions(params: dict[str, Any]) -> None:
    text = " ".join(params.get(k, "") for k in EXPRESSION_KEYS)
    assert set(NAME.findall(text)) == set(params.get("ExpressionAttributeNames", {})), params
    assert set(VALUE.findall(text)) == set(params.get("ExpressionAttributeValues", {})), params


class RecordingClient:
    def __init__(self) -> None:
        self._real = boto3.session.Session().client(
            "dynamodb", region_name="us-east-1", aws_access_key_id="x", aws_secret_access_key="x"
        )
        self._validator = ParamValidator()
        self._responses: dict[str, deque[Any]] = defaultdict(deque)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def respond(self, method: str, *responses: Any) -> None:
        self._responses[method].extend(responses)

    def __getattr__(self, method: str):
        api_name = self._real.meta.method_to_api_mapping.get(method)
        if api_name is None:
            raise AttributeError(method)

        def invoke(**params: Any) -> Any:
            shape = self._real.meta.service_model.operation_model(api_name).input_shape
            report = self._validator.validate(params, shape)
            assert not report.has_errors(), report.generate_report()
            check_expressions(params)
            for item in params.get("TransactItems", []):
                for op in item.values():
                    check_expressions(op)
            self.calls.append((method, params))
            queue = self._responses[method]
            response = queue.popleft() if queue else {}
            if isinstance(response, Exception):
                raise response
            return response

        return invoke


def cancelled(*codes: str, message_only: bool = False) -> ClientError:
    error: dict[str, Any] = {
        "Error": {
            "Code": "TransactionCanceledException",
            "Message": f"Transaction cancelled, please refer cancellation reasons for specific reasons [{', '.join(codes)}]",
        }
    }
    if not message_only:
        error["CancellationReasons"] = [{"Code": c} for c in codes]
    return ClientError(error, "TransactWriteItems")


@pytest.fixture
def client() -> RecordingClient:
    return RecordingClient()


@pytest.fixture
def dynamo(client) -> DynamoDBCharacterStore:
    return DynamoDBCharacterStore(
        region="us-east-1",
        endpoint_url=None,
        table_characters="characters",
        table_inbox="character_inbox",
        table_outbox="character_outbox",
        client=client,
    )


@pytest.fixture
def character(clock) -> Character:
    return Character(
        id="p1",
        campaign_id="c1",
        name="Lyra",
        hp=HitPoints(18, 20),
        attributes={"forca": 15, "destreza": 12},
        skills={},
        max_items=10,
        slots_used=2,
        owner_id="ana",
        portrait=Portrait("characters/p1/portrait", "image/png", 123, clock()),
        created_at=clock(),
        updated_at=clock(),
    )


def _inbox(clock, message_id="5f0c2b9e-6a1d-4f3b-8c7e-1d2a3b4c5d6e") -> InboxRecord:
    return InboxRecord(message_id, "rpg.character.validation-requested.v1", "op-1", "APPROVED", clock())


def _outbox(clock) -> OutboxRecord:
    return OutboxRecord(
        "6e5d4c3b-2a19-4f8e-8d7c-6b5a49382716",
        "rpg.character.validated.v1",
        "character.validated.v1",
        "op-1",
        {"messageId": "6e5d4c3b-2a19-4f8e-8d7c-6b5a49382716", "payload": {"x": 1}},
        clock(),
    )


def _hold(clock, status=HoldStatus.HELD) -> CapacityHold:
    return CapacityHold("op-1", "p1", 1, status, clock(), clock(), campaign_id="c1", item_id="sword")


def test_ficha_ida_e_volta(dynamo, client, character):
    dynamo.create_character(character)
    method, params = client.calls[-1]
    item = params["Item"]
    assert method == "put_item" and params["ConditionExpression"] == "attribute_not_exists(pk)"
    assert item["pk"] == {"S": "CHAR#p1"} and item["sk"] == {"S": "PROFILE"}
    assert item["slotsAvailable"] == {"N": "8"} and item["gsi1pk"] == {"S": "CAMPAIGN#c1"}
    assert "description" not in item  # None não é gravado

    client.respond("get_item", {"Item": item})
    assert dynamo.get_character("p1") == character
    assert client.calls[-1][1]["ConsistentRead"] is True


def test_organizacao_da_ficha_vai_como_json_e_volta(dynamo, client, character):
    sheet = {"template": None, "columns": [[{"id": "n", "type": "counter", "title": "Mana", "data": {"current": 2, "max": 5.5}}]]}
    with_sheet = character.evolve(sheet=sheet)
    dynamo.create_character(with_sheet)
    item = client.calls[-1][1]["Item"]
    assert set(item["sheet"]) == {"S"}  # texto JSON: dados livres não passam pelo tipo numérico do DynamoDB
    client.respond("get_item", {"Item": item})
    assert dynamo.get_character("p1") == with_sheet

    dynamo.save_profile(with_sheet.evolve(version=2), expected_version=1, max_items_delta=0)
    assert "#sheet" in client.calls[-1][1]["UpdateExpression"].split("REMOVE")[0]
    dynamo.save_profile(character.evolve(version=3), expected_version=2, max_items_delta=0)
    assert "#sheet" in client.calls[-1][1]["UpdateExpression"].split("REMOVE")[1]


def test_reserva_e_uma_transacao_de_quatro_itens_com_inbox_primeiro(dynamo, client, clock):
    dynamo.reserve_capacity(_inbox(clock), _hold(clock), _outbox(clock))
    method, params = client.calls[-1]
    items = params["TransactItems"]
    assert method == "transact_write_items" and len(items) == 4
    assert items[0]["Put"]["TableName"] == "character_inbox"
    assert items[0]["Put"]["ConditionExpression"] == "attribute_not_exists(messageId)"
    update = items[1]["Update"]
    assert ">=" in update["ConditionExpression"] and "attribute_exists(pk)" in update["ConditionExpression"]
    assert update["UpdateExpression"].startswith("SET")
    assert items[2]["Put"]["Item"]["sk"] == {"S": "HOLD#op-1"}
    assert items[3]["Put"]["Item"]["pendingKey"] == {"S": "PENDING"}


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (cancelled("ConditionalCheckFailed", "None", "None", "None"), DuplicateMessage),
        (cancelled("None", "ConditionalCheckFailed", "None", "None"), ConcurrencyConflict),
        (cancelled("None", "None", "ConditionalCheckFailed", "None"), ConcurrencyConflict),
        (cancelled("None", "TransactionConflict", "None", "None"), ConcurrencyConflict),
        (cancelled("ConditionalCheckFailed", "None", message_only=True), DuplicateMessage),
        (cancelled("None", "ThrottlingError"), StoreUnavailable),
        (
            ClientError({"Error": {"Code": "TransactionConflictException", "Message": "x"}}, "TransactWriteItems"),
            ConcurrencyConflict,
        ),
        (
            ClientError({"Error": {"Code": "ProvisionedThroughputExceededException", "Message": "x"}}, "TransactWriteItems"),
            StoreUnavailable,
        ),
    ],
)
def test_mapeamento_de_falhas_da_transacao(dynamo, client, clock, error, expected):
    client.respond("transact_write_items", error)
    with pytest.raises(expected):
        dynamo.reserve_capacity(_inbox(clock), _hold(clock), _outbox(clock))


def test_release_devolve_capacidade_e_exige_hold_held(dynamo, client, clock):
    dynamo.release_hold(_inbox(clock), _hold(clock).evolve(status=HoldStatus.RELEASED, quantity=2))
    items = client.calls[-1][1]["TransactItems"]
    hold_update, capacity_update = items[1]["Update"], items[2]["Update"]
    assert list(hold_update["ExpressionAttributeValues"].values())[-1] == {"S": "HELD"}
    assert "+" in capacity_update["UpdateExpression"] and {"N": "2"} in capacity_update["ExpressionAttributeValues"].values()


def test_commit_tombstone_e_record_outcome(dynamo, client, clock):
    dynamo.commit_hold(_inbox(clock), _hold(clock))
    dynamo.create_tombstone(_inbox(clock), _hold(clock, HoldStatus.RELEASED))
    dynamo.record_outcome(_inbox(clock), None)
    dynamo.record_outcome(_inbox(clock), _outbox(clock))
    sizes = [len(p["TransactItems"]) for m, p in client.calls]
    assert sizes == [2, 2, 1, 2]


def test_save_profile_reducao_exige_capacidade_livre(dynamo, client, character):
    dynamo.save_profile(character.evolve(version=2), expected_version=1, max_items_delta=-3)
    params = client.calls[-1][1]
    assert ">=" in params["ConditionExpression"]
    assert "REMOVE" in params["UpdateExpression"]  # description=None é removida

    dynamo.save_profile(character.evolve(version=3, description="nova"), expected_version=2, max_items_delta=0)
    params = client.calls[-1][1]
    assert ">=" not in params["ConditionExpression"] and "maxItems" not in str(params["ExpressionAttributeNames"].values())


def test_save_profile_condicao_falha_vira_conflito(dynamo, client, character):
    client.respond(
        "update_item", ClientError({"Error": {"Code": "ConditionalCheckFailedException", "Message": "x"}}, "UpdateItem")
    )
    with pytest.raises(ConcurrencyConflict):
        dynamo.save_profile(character, 1, 0)


def test_hold_ida_e_volta(dynamo, client, clock):
    hold = _hold(clock)
    dynamo.create_tombstone(_inbox(clock), hold)
    item = client.calls[-1][1]["TransactItems"][1]["Put"]["Item"]
    client.respond("get_item", {"Item": item})
    assert dynamo.get_hold("p1", "op-1") == hold


def test_claim_outbox_pula_itens_ja_reivindicados(dynamo, client, clock):
    dynamo.record_outcome(_inbox(clock), _outbox(clock))
    stored = client.calls[-1][1]["TransactItems"][1]["Put"]["Item"]
    other = {**stored, "messageId": {"S": "7f6e5d4c-3b2a-4190-8f8e-7d6c5b4a3928"}}
    client.respond("query", {"Items": [other, stored]})
    client.respond(
        "update_item",
        ClientError({"Error": {"Code": "ConditionalCheckFailedException", "Message": "x"}}, "UpdateItem"),
        {"Attributes": {**stored, "attempts": {"N": "1"}, "lockedBy": {"S": "me"}}},
    )
    claimed = dynamo.claim_outbox(10, 30, "me", clock())
    assert [r.message_id for r in claimed] == [stored["messageId"]["S"]]
    assert claimed[0].envelope["payload"] == {"x": 1} and claimed[0].attempts == 1


def test_mark_published_remove_do_indice_pendente(dynamo, client, clock):
    dynamo.mark_outbox_published("abc", "me", clock())
    expression = client.calls[-1][1]["UpdateExpression"]
    assert "REMOVE" in expression and "#pendingKey" in expression


def test_lease_perdido_nao_quebra(dynamo, client, clock):
    client.respond(
        "update_item", ClientError({"Error": {"Code": "ConditionalCheckFailedException", "Message": "x"}}, "UpdateItem")
    )
    dynamo.mark_outbox_published("abc", "me", clock())  # só registra aviso


def test_listagem_com_cursor(dynamo, client, character):
    dynamo.create_character(character)
    item = client.calls[-1][1]["Item"]
    last = {"pk": item["pk"], "sk": item["sk"], "gsi1pk": item["gsi1pk"], "gsi1sk": item["gsi1sk"]}
    client.respond("query", {"Items": [item], "LastEvaluatedKey": last}, {"Items": []})
    page = dynamo.list_characters("c1", 1, None)
    assert page.items == [character] and page.next_cursor
    dynamo.list_characters("c1", 1, page.next_cursor)
    assert client.calls[-1][1]["ExclusiveStartKey"] == last


def test_outbox_stats(dynamo, client, clock):
    client.respond(
        "query",
        {"Count": 2, "LastEvaluatedKey": {"x": {"S": "1"}}},
        {"Count": 1},
        {"Items": [{"createdAt": {"S": "2026-11-11T12:00:00.000Z"}}]},
    )
    stats = dynamo.outbox_stats()
    assert stats.pending == 3 and stats.oldest_pending_at == clock()
