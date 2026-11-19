"""Repositório DynamoDB do S2 — o único código que toca as tabelas do serviço.

Modelo (tabelas privadas do S2, ver infra/manifests/characters.json):

``characters`` (pk, sk)
    CHAR#{id} / PROFILE          ficha + contadores ``slotsUsed`` / ``slotsAvailable``
    CHAR#{id} / HOLD#{opId}      reserva de capacidade da Saga
    CHAR#{id} / MONEY#{opId}     operação de dinheiro (débito/reembolso da compra, ou ajuste manual)
    GSI ``byCampaign`` (gsi1pk=CAMPAIGN#{campaignId}, gsi1sk={createdAt}#{id}) — esparso, só perfis
``character_inbox`` (messageId)   mensagens já processadas (TTL ``expiresAt``)
``character_outbox`` (messageId)  eventos a publicar; GSI esparso ``pending`` (pendingKey, createdAt)

Por que ``slotsAvailable`` é armazenado e não calculado? ``ConditionExpression`` não faz aritmética
entre atributos; guardar a capacidade livre permite a condição atômica ``slotsAvailable >= :q``.
Todas as escritas mantêm ``slotsAvailable = maxItems - slotsUsed``.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from collections.abc import Callable
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, TypeVar

from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from boto3.session import Session
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.application.ports import (
    AdjustmentAlreadyApplied,
    CharacterAlreadyExists,
    ConcurrencyConflict,
    DuplicateMessage,
    InboxRecord,
    OutboxRecord,
    OutboxStats,
    Page,
    StoreUnavailable,
)
from app.domain.models import CapacityHold, Character, HitPoints, HoldStatus, MoneyEntry, MoneyStatus, Portrait
from app.messaging.envelope import format_timestamp

log = logging.getLogger(__name__)

T = TypeVar("T")

PROFILE_SK = "PROFILE"
HOLD_PREFIX = "HOLD#"
MONEY_PREFIX = "MONEY#"
PENDING = "PENDING"
_TRANSIENT_CODES = {
    "ProvisionedThroughputExceededException",
    "ThrottlingException",
    "RequestLimitExceeded",
    "InternalServerError",
    "ServiceUnavailable",
    "TransactionInProgressException",
}

_ser = TypeSerializer()
_deser = TypeDeserializer()


def _char_pk(character_id: str) -> str:
    return f"CHAR#{character_id}"


def _to_item(data: dict[str, Any]) -> dict[str, Any]:
    return {k: _ser.serialize(v) for k, v in data.items() if v is not None}


def _from_item(item: dict[str, Any]) -> dict[str, Any]:
    return {k: _plain(_deser.deserialize(v)) for k, v in item.items()}


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def _ts(value: datetime) -> str:
    return format_timestamp(value)


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _epoch(value: datetime) -> int:
    return int(value.timestamp())


class _Expr:
    """Monta expressões com *aliases* para todos os nomes e valores (evita palavras reservadas)."""

    def __init__(self) -> None:
        self.names: dict[str, str] = {}
        self.values: dict[str, Any] = {}

    def n(self, attribute: str) -> str:
        alias = f"#{re.sub(r'[^A-Za-z0-9_]', '_', attribute)}"
        self.names[alias] = attribute
        return alias

    def v(self, value: Any) -> str:
        alias = f":v{len(self.values)}"
        self.values[alias] = _ser.serialize(value)
        return alias

    def params(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.names:
            out["ExpressionAttributeNames"] = self.names
        if self.values:
            out["ExpressionAttributeValues"] = self.values
        return out


class DynamoDBCharacterStore:
    def __init__(
        self,
        *,
        region: str,
        endpoint_url: str | None,
        table_characters: str,
        table_inbox: str,
        table_outbox: str,
        inbox_ttl_days: int = 7,
        outbox_published_ttl_days: int = 3,
        client: Any | None = None,
    ) -> None:
        self._client = client or Session().client(
            "dynamodb",
            region_name=region,
            endpoint_url=endpoint_url,
            config=Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=2, read_timeout=5),
        )
        self._t_chars = table_characters
        self._t_inbox = table_inbox
        self._t_outbox = table_outbox
        self._inbox_ttl = timedelta(days=inbox_ttl_days)
        self._published_ttl = timedelta(days=outbox_published_ttl_days)

    # --- infraestrutura -----------------------------------------------------------------------

    def _call(self, fn: Callable[..., T], **kwargs: Any) -> T:
        try:
            return fn(**kwargs)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in _TRANSIENT_CODES:
                raise StoreUnavailable(str(exc)) from exc
            raise
        except BotoCoreError as exc:  # conexão recusada, timeout, endpoint inacessível
            raise StoreUnavailable(str(exc)) from exc

    def _transact(self, items: list[dict[str, Any]]) -> None:
        """Executa TransactWriteItems. O primeiro item é SEMPRE o registro da inbox.

        Mapeamento de ``CancellationReasons`` (uma por item, na mesma ordem):
        * item 0 (inbox) com ConditionalCheckFailed -> DuplicateMessage (efeito já aplicado);
        * qualquer outra condição/conflito          -> ConcurrencyConflict (reler e decidir de novo).
        """
        try:
            self._call(self._client.transact_write_items, TransactItems=items)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code == "TransactionConflictException":
                raise ConcurrencyConflict(code) from exc
            if code != "TransactionCanceledException":
                raise
            reasons = [r.get("Code") for r in exc.response.get("CancellationReasons") or []]
            if not reasons:  # alguns emuladores só informam os motivos na mensagem
                match = re.search(r"\[(.*)\]", exc.response.get("Error", {}).get("Message", ""))
                reasons = [r.strip() for r in match.group(1).split(",")] if match else []
            if reasons and reasons[0] == "ConditionalCheckFailed":
                raise DuplicateMessage(items[0]["Put"]["Item"]["messageId"]["S"]) from exc
            if any(r in ("ConditionalCheckFailed", "TransactionConflict") for r in reasons):
                raise ConcurrencyConflict(",".join(str(r) for r in reasons)) from exc
            raise StoreUnavailable(f"transação cancelada: {reasons}") from exc

    def ping(self) -> None:
        for table in (self._t_chars, self._t_inbox, self._t_outbox):
            self._call(self._client.describe_table, TableName=table)

    # --- fichas -------------------------------------------------------------------------------

    def _character_item(self, c: Character) -> dict[str, Any]:
        return _to_item(
            {
                "pk": _char_pk(c.id),
                "sk": PROFILE_SK,
                "entity": "CHARACTER",
                "id": c.id,
                "campaignId": c.campaign_id,
                "name": c.name,
                "ownerId": c.owner_id,
                "description": c.description,
                "sheet": json.dumps(c.sheet, ensure_ascii=False) if c.sheet is not None else None,
                "attributes": c.attributes,
                "skills": c.skills,
                "hpCurrent": c.hp.current,
                "hpMax": c.hp.max,
                "maxItems": c.max_items,
                "slotsUsed": c.slots_used,
                "slotsAvailable": c.slots_available,
                "active": c.active,
                "portrait": self._portrait_map(c.portrait),
                "version": c.version,
                "currencyName": c.currency_name,
                "currencyAmount": c.currency_amount,
                "sourceTemplateId": c.source_template_id,
                "sourceTemplateVersion": c.source_template_version,
                "createdAt": _ts(c.created_at),
                "updatedAt": _ts(c.updated_at),
                "gsi1pk": f"CAMPAIGN#{c.campaign_id}",
                "gsi1sk": f"{_ts(c.created_at)}#{c.id}",
            }
        )

    @staticmethod
    def _portrait_map(p: Portrait | None) -> dict[str, Any] | None:
        if p is None:
            return None
        return {"key": p.key, "contentType": p.content_type, "sizeBytes": p.size_bytes, "uploadedAt": _ts(p.uploaded_at)}

    @staticmethod
    def _character_from(item: dict[str, Any]) -> Character:
        d = _from_item(item)
        portrait = d.get("portrait")
        return Character(
            id=d["id"],
            campaign_id=d["campaignId"],
            name=d["name"],
            owner_id=d.get("ownerId"),
            description=d.get("description"),
            sheet=json.loads(d["sheet"]) if d.get("sheet") else None,
            attributes=dict(d.get("attributes") or {}),
            skills=dict(d.get("skills") or {}),
            hp=HitPoints(d["hpCurrent"], d["hpMax"]),
            max_items=d["maxItems"],
            slots_used=d["slotsUsed"],
            active=bool(d["active"]),
            portrait=(
                Portrait(portrait["key"], portrait["contentType"], portrait["sizeBytes"], _parse_ts(portrait["uploadedAt"]))
                if portrait
                else None
            ),
            version=d["version"],
            created_at=_parse_ts(d["createdAt"]),
            updated_at=_parse_ts(d["updatedAt"]),
            # fichas gravadas antes do dinheiro existir começam com saldo 0
            currency_name=d.get("currencyName", "Moedas"),
            currency_amount=int(d.get("currencyAmount", 0)),
            source_template_id=d.get("sourceTemplateId"),
            source_template_version=d.get("sourceTemplateVersion"),
        )

    def create_character(self, character: Character) -> None:
        try:
            self._call(
                self._client.put_item,
                TableName=self._t_chars,
                Item=self._character_item(character),
                ConditionExpression="attribute_not_exists(pk)",
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise CharacterAlreadyExists(character.id) from exc
            raise

    def get_character(self, character_id: str) -> Character | None:
        resp = self._call(
            self._client.get_item,
            TableName=self._t_chars,
            Key=_to_item({"pk": _char_pk(character_id), "sk": PROFILE_SK}),
            ConsistentRead=True,
        )
        item = resp.get("Item")
        return self._character_from(item) if item else None

    def list_characters(self, campaign_id: str, limit: int, cursor: str | None, owner_id: str | None = None) -> Page:
        params: dict[str, Any] = {
            "TableName": self._t_chars,
            "IndexName": "byCampaign",
            "KeyConditionExpression": "gsi1pk = :p",
            "ExpressionAttributeValues": {":p": {"S": f"CAMPAIGN#{campaign_id}"}},
            "Limit": limit,
        }
        if owner_id is not None:
            # o filtro roda depois do Limit: uma página pode vir com menos itens, mas o cursor continua valendo
            params["FilterExpression"] = "ownerId = :o"
            params["ExpressionAttributeValues"][":o"] = {"S": owner_id}
        if cursor:
            params["ExclusiveStartKey"] = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        resp = self._call(self._client.query, **params)
        items = [self._character_from(i) for i in resp.get("Items", [])]
        last = resp.get("LastEvaluatedKey")
        next_cursor = base64.urlsafe_b64encode(json.dumps(last).encode()).decode() if last else None
        return Page(items, next_cursor)

    def save_profile(self, character: Character, expected_version: int, max_items_delta: int) -> None:
        e = _Expr()
        sets = [
            f"{e.n('name')} = {e.v(character.name)}",
            f"{e.n('attributes')} = {e.v(character.attributes)}",
            f"{e.n('skills')} = {e.v(character.skills)}",
            f"{e.n('hpCurrent')} = {e.v(character.hp.current)}",
            f"{e.n('hpMax')} = {e.v(character.hp.max)}",
            f"{e.n('active')} = {e.v(character.active)}",
            f"{e.n('version')} = {e.v(character.version)}",
            # só o nome da moeda: o saldo muda apenas pelas operações condicionais de dinheiro
            f"{e.n('currencyName')} = {e.v(character.currency_name)}",
            f"{e.n('updatedAt')} = {e.v(_ts(character.updated_at))}",
        ]
        removes = []
        for attribute, value in (
            ("ownerId", character.owner_id),
            ("description", character.description),
            ("sheet", json.dumps(character.sheet, ensure_ascii=False) if character.sheet is not None else None),
            ("portrait", self._portrait_map(character.portrait)),
        ):
            if value is None:
                removes.append(e.n(attribute))
            else:
                sets.append(f"{e.n(attribute)} = {e.v(value)}")
        condition = f"{e.n('version')} = {e.v(expected_version)}"
        if max_items_delta:
            delta = e.v(max_items_delta)
            sets.append(f"{e.n('maxItems')} = {e.n('maxItems')} + {delta}")
            sets.append(f"{e.n('slotsAvailable')} = {e.n('slotsAvailable')} + {delta}")
            if max_items_delta < 0:
                condition += f" AND {e.n('slotsAvailable')} >= {e.v(-max_items_delta)}"
        expression = "SET " + ", ".join(sets) + (" REMOVE " + ", ".join(removes) if removes else "")
        try:
            self._call(
                self._client.update_item,
                TableName=self._t_chars,
                Key=_to_item({"pk": _char_pk(character.id), "sk": PROFILE_SK}),
                UpdateExpression=expression,
                ConditionExpression=condition,
                **e.params(),
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise ConcurrencyConflict("versão ou capacidade divergente") from exc
            raise

    # --- reservas -----------------------------------------------------------------------------

    @staticmethod
    def _hold_item(h: CapacityHold) -> dict[str, Any]:
        return _to_item(
            {
                "pk": _char_pk(h.character_id),
                "sk": f"{HOLD_PREFIX}{h.operation_id}",
                "entity": "HOLD",
                "operationId": h.operation_id,
                "characterId": h.character_id,
                "quantity": h.quantity,
                "status": h.status.value,
                "campaignId": h.campaign_id,
                "itemId": h.item_id,
                "tombstone": h.tombstone,
                "createdAt": _ts(h.created_at),
                "updatedAt": _ts(h.updated_at),
            }
        )

    @staticmethod
    def _hold_from(item: dict[str, Any]) -> CapacityHold:
        d = _from_item(item)
        return CapacityHold(
            operation_id=d["operationId"],
            character_id=d["characterId"],
            quantity=d["quantity"],
            status=HoldStatus(d["status"]),
            campaign_id=d.get("campaignId"),
            item_id=d.get("itemId"),
            tombstone=bool(d.get("tombstone", False)),
            created_at=_parse_ts(d["createdAt"]),
            updated_at=_parse_ts(d["updatedAt"]),
        )

    def get_hold(self, character_id: str, operation_id: str) -> CapacityHold | None:
        resp = self._call(
            self._client.get_item,
            TableName=self._t_chars,
            Key=_to_item({"pk": _char_pk(character_id), "sk": f"{HOLD_PREFIX}{operation_id}"}),
            ConsistentRead=True,
        )
        item = resp.get("Item")
        return self._hold_from(item) if item else None

    def list_holds(self, character_id: str) -> list[CapacityHold]:
        holds: list[CapacityHold] = []
        params: dict[str, Any] = {
            "TableName": self._t_chars,
            "KeyConditionExpression": "pk = :pk AND begins_with(sk, :hold)",
            "ExpressionAttributeValues": {":pk": {"S": _char_pk(character_id)}, ":hold": {"S": HOLD_PREFIX}},
            "ConsistentRead": True,
        }
        while True:
            resp = self._call(self._client.query, **params)
            holds.extend(self._hold_from(i) for i in resp.get("Items", []))
            if "LastEvaluatedKey" not in resp:
                break
            params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        return sorted(holds, key=lambda h: h.created_at)

    # --- inbox / outbox (itens de transação) ----------------------------------------------------

    def get_inbox(self, message_id: str) -> InboxRecord | None:
        resp = self._call(
            self._client.get_item, TableName=self._t_inbox, Key={"messageId": {"S": message_id}}, ConsistentRead=True
        )
        item = resp.get("Item")
        if not item:
            return None
        d = _from_item(item)
        return InboxRecord(
            d["messageId"], d["type"], d["correlationId"], d["outcome"], _parse_ts(d["receivedAt"]), d.get("detail", "")
        )

    def _inbox_put(self, inbox: InboxRecord) -> dict[str, Any]:
        return {
            "Put": {
                "TableName": self._t_inbox,
                "Item": _to_item(
                    {
                        "messageId": inbox.message_id,
                        "type": inbox.type,
                        "correlationId": inbox.correlation_id,
                        "outcome": inbox.outcome,
                        "detail": inbox.detail or None,
                        "receivedAt": _ts(inbox.received_at),
                        "expiresAt": _epoch(inbox.received_at + self._inbox_ttl),
                    }
                ),
                "ConditionExpression": "attribute_not_exists(messageId)",
            }
        }

    def _outbox_put(self, outbox: OutboxRecord) -> dict[str, Any]:
        return {
            "Put": {
                "TableName": self._t_outbox,
                "Item": _to_item(
                    {
                        "messageId": outbox.message_id,
                        "type": outbox.type,
                        "routingKey": outbox.routing_key,
                        "correlationId": outbox.correlation_id,
                        "envelope": json.dumps(outbox.envelope, ensure_ascii=False),
                        "status": PENDING,
                        "pendingKey": PENDING,
                        "createdAt": _ts(outbox.created_at),
                        "attempts": 0,
                        "traceContext": outbox.trace_context or None,
                    }
                ),
                "ConditionExpression": "attribute_not_exists(messageId)",
            }
        }

    def _hold_status_update(self, hold: CapacityHold, new_status: HoldStatus) -> dict[str, Any]:
        e = _Expr()
        return {
            "Update": {
                "TableName": self._t_chars,
                "Key": _to_item({"pk": _char_pk(hold.character_id), "sk": f"{HOLD_PREFIX}{hold.operation_id}"}),
                "UpdateExpression": (
                    f"SET {e.n('status')} = {e.v(new_status.value)}, {e.n('updatedAt')} = {e.v(_ts(hold.updated_at))}"
                ),
                "ConditionExpression": f"{e.n('status')} = {e.v(HoldStatus.HELD.value)}",
                **e.params(),
            }
        }

    def _capacity_update(self, character_id: str, delta_used: int, *, require_active_campaign: str | None) -> dict[str, Any]:
        e = _Expr()
        used, available = e.n("slotsUsed"), e.n("slotsAvailable")
        q = e.v(abs(delta_used))
        if delta_used > 0:
            expression = f"SET {available} = {available} - {q}, {used} = {used} + {q}"
            condition = f"attribute_exists(pk) AND {available} >= {q}"
        else:
            expression = f"SET {available} = {available} + {q}, {used} = {used} - {q}"
            condition = "attribute_exists(pk)"
        if require_active_campaign is not None:
            condition += f" AND {e.n('active')} = {e.v(True)} AND {e.n('campaignId')} = {e.v(require_active_campaign)}"
        return {
            "Update": {
                "TableName": self._t_chars,
                "Key": _to_item({"pk": _char_pk(character_id), "sk": PROFILE_SK}),
                "UpdateExpression": expression,
                "ConditionExpression": condition,
                **e.params(),
            }
        }

    # --- transações de consumo ----------------------------------------------------------------

    def reserve_capacity(self, inbox: InboxRecord, hold: CapacityHold, outbox: OutboxRecord) -> None:
        self._transact(
            [
                self._inbox_put(inbox),
                self._capacity_update(hold.character_id, hold.quantity, require_active_campaign=hold.campaign_id or ""),
                {
                    "Put": {
                        "TableName": self._t_chars,
                        "Item": self._hold_item(hold),
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                },
                self._outbox_put(outbox),
            ]
        )

    def record_outcome(self, inbox: InboxRecord, outbox: OutboxRecord | None) -> None:
        items = [self._inbox_put(inbox)]
        if outbox is not None:
            items.append(self._outbox_put(outbox))
        self._transact(items)

    def commit_hold(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        self._transact([self._inbox_put(inbox), self._hold_status_update(hold, HoldStatus.COMMITTED)])

    def release_hold(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        self._transact(
            [
                self._inbox_put(inbox),
                self._hold_status_update(hold, HoldStatus.RELEASED),
                self._capacity_update(hold.character_id, -hold.quantity, require_active_campaign=None),
            ]
        )

    def create_tombstone(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        self._transact(
            [
                self._inbox_put(inbox),
                {
                    "Put": {
                        "TableName": self._t_chars,
                        "Item": self._hold_item(hold),
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                },
            ]
        )

    # --- dinheiro -----------------------------------------------------------------------------

    @staticmethod
    def _money_item(m: MoneyEntry) -> dict[str, Any]:
        return _to_item(
            {
                "pk": _char_pk(m.character_id),
                "sk": f"{MONEY_PREFIX}{m.operation_id}",
                "entity": "MONEY",
                "operationId": m.operation_id,
                "characterId": m.character_id,
                "kind": m.kind,
                "amount": m.amount,
                "status": m.status.value if m.status else None,
                "campaignId": m.campaign_id,
                "userId": m.user_id,
                "reason": m.reason,
                "tombstone": m.tombstone,
                "createdAt": _ts(m.created_at),
                "updatedAt": _ts(m.updated_at),
            }
        )

    @staticmethod
    def _money_from(item: dict[str, Any]) -> MoneyEntry:
        d = _from_item(item)
        return MoneyEntry(
            operation_id=d["operationId"],
            character_id=d["characterId"],
            kind=d["kind"],
            amount=d["amount"],
            status=MoneyStatus(d["status"]) if d.get("status") else None,
            campaign_id=d.get("campaignId"),
            user_id=d.get("userId"),
            reason=d.get("reason"),
            tombstone=bool(d.get("tombstone", False)),
            created_at=_parse_ts(d["createdAt"]),
            updated_at=_parse_ts(d["updatedAt"]),
        )

    def _money_put(self, entry: MoneyEntry) -> dict[str, Any]:
        return {
            "Put": {
                "TableName": self._t_chars,
                "Item": self._money_item(entry),
                "ConditionExpression": "attribute_not_exists(pk)",
            }
        }

    def _balance_update(self, character_id: str, delta: int, condition: str, e: _Expr) -> dict[str, Any]:
        amount = e.n("currencyAmount")
        return {
            "Update": {
                "TableName": self._t_chars,
                "Key": _to_item({"pk": _char_pk(character_id), "sk": PROFILE_SK}),
                # if_not_exists: fichas antigas não têm o atributo e começam em 0
                "UpdateExpression": f"SET {amount} = if_not_exists({amount}, {e.v(0)}) + {e.v(delta)}",
                "ConditionExpression": condition,
                **e.params(),
            }
        }

    def get_money_entry(self, character_id: str, operation_id: str) -> MoneyEntry | None:
        resp = self._call(
            self._client.get_item,
            TableName=self._t_chars,
            Key=_to_item({"pk": _char_pk(character_id), "sk": f"{MONEY_PREFIX}{operation_id}"}),
            ConsistentRead=True,
        )
        item = resp.get("Item")
        return self._money_from(item) if item else None

    def list_money_entries(self, character_id: str) -> list[MoneyEntry]:
        entries: list[MoneyEntry] = []
        params: dict[str, Any] = {
            "TableName": self._t_chars,
            "KeyConditionExpression": "pk = :pk AND begins_with(sk, :m)",
            "ExpressionAttributeValues": {":pk": {"S": _char_pk(character_id)}, ":m": {"S": MONEY_PREFIX}},
            "ConsistentRead": True,
        }
        while True:
            resp = self._call(self._client.query, **params)
            entries.extend(self._money_from(i) for i in resp.get("Items", []))
            if "LastEvaluatedKey" not in resp:
                break
            params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        return sorted(entries, key=lambda m: m.created_at)

    def debit_money(self, inbox: InboxRecord, entry: MoneyEntry, outbox: OutboxRecord) -> None:
        e = _Expr()
        amount = e.n("currencyAmount")
        # Débito atômico: o saldo só cai se ainda comportar o valor (duas compras nunca gastam o mesmo dinheiro).
        condition = (
            f"attribute_exists(pk) AND {amount} >= {e.v(entry.amount)} AND {e.n('ownerId')} = {e.v(entry.user_id or '')}"
            f" AND {e.n('campaignId')} = {e.v(entry.campaign_id or '')} AND {e.n('active')} = {e.v(True)}"
        )
        self._transact(
            [
                self._inbox_put(inbox),
                self._balance_update(entry.character_id, -entry.amount, condition, e),
                self._money_put(entry),
                self._outbox_put(outbox),
            ]
        )

    def refund_money(self, inbox: InboxRecord, entry: MoneyEntry, outbox: OutboxRecord) -> None:
        status_e = _Expr()
        status = status_e.n("status")
        balance_e = _Expr()
        self._transact(
            [
                self._inbox_put(inbox),
                {
                    "Update": {
                        "TableName": self._t_chars,
                        "Key": _to_item({"pk": _char_pk(entry.character_id), "sk": f"{MONEY_PREFIX}{entry.operation_id}"}),
                        "UpdateExpression": (
                            f"SET {status} = {status_e.v(MoneyStatus.REFUNDED.value)}, "
                            f"{status_e.n('updatedAt')} = {status_e.v(_ts(entry.updated_at))}"
                        ),
                        # só devolve o que foi debitado, e uma única vez
                        "ConditionExpression": f"{status} = {status_e.v(MoneyStatus.DEBITED.value)}",
                        **status_e.params(),
                    }
                },
                self._balance_update(entry.character_id, entry.amount, "attribute_exists(pk)", balance_e),
                self._outbox_put(outbox),
            ]
        )

    def create_money_tombstone(self, inbox: InboxRecord, entry: MoneyEntry, outbox: OutboxRecord) -> None:
        self._transact([self._inbox_put(inbox), self._money_put(entry), self._outbox_put(outbox)])

    def adjust_money(self, entry: MoneyEntry) -> None:
        e = _Expr()
        condition = "attribute_exists(pk)"
        if entry.amount < 0:
            amount = e.n("currencyAmount")
            condition += f" AND {amount} >= {e.v(-entry.amount)}"
        items = [self._money_put(entry), self._balance_update(entry.character_id, entry.amount, condition, e)]
        try:
            self._call(self._client.transact_write_items, TransactItems=items)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "TransactionCanceledException":
                raise
            reasons = [r.get("Code") for r in exc.response.get("CancellationReasons") or []]
            if not reasons:
                match = re.search(r"\[(.*)\]", exc.response.get("Error", {}).get("Message", ""))
                reasons = [r.strip() for r in match.group(1).split(",")] if match else []
            if reasons and reasons[0] == "ConditionalCheckFailed":
                raise AdjustmentAlreadyApplied(entry.operation_id) from exc
            raise ConcurrencyConflict(",".join(str(r) for r in reasons)) from exc

    # --- outbox (relay) -----------------------------------------------------------------------

    @staticmethod
    def _outbox_from(item: dict[str, Any]) -> OutboxRecord:
        d = _from_item(item)
        return OutboxRecord(
            message_id=d["messageId"],
            type=d["type"],
            routing_key=d["routingKey"],
            correlation_id=d["correlationId"],
            envelope=json.loads(d["envelope"]),
            created_at=_parse_ts(d["createdAt"]),
            status=d.get("status", PENDING),
            attempts=int(d.get("attempts", 0)),
            published_at=_parse_ts(d["publishedAt"]) if d.get("publishedAt") else None,
            trace_context=d.get("traceContext") or {},
        )

    def claim_outbox(self, limit: int, lease_seconds: int, owner: str, now: datetime) -> list[OutboxRecord]:
        resp = self._call(
            self._client.query,
            TableName=self._t_outbox,
            IndexName="pending",
            KeyConditionExpression="pendingKey = :p",
            ExpressionAttributeValues={":p": {"S": PENDING}},
            Limit=limit * 2,
            ScanIndexForward=True,
        )
        now_ms = int(now.timestamp() * 1000)
        claimed: list[OutboxRecord] = []
        for candidate in resp.get("Items", []):
            if len(claimed) >= limit:
                break
            e = _Expr()
            lock = e.n("lockedUntil")
            try:
                updated = self._call(
                    self._client.update_item,
                    TableName=self._t_outbox,
                    Key={"messageId": candidate["messageId"]},
                    UpdateExpression=(
                        f"SET {e.n('lockedBy')} = {e.v(owner)}, {lock} = {e.v(now_ms + lease_seconds * 1000)} "
                        f"ADD {e.n('attempts')} {e.v(1)}"
                    ),
                    ConditionExpression=(
                        f"{e.n('pendingKey')} = {e.v(PENDING)} AND (attribute_not_exists({lock}) OR {lock} < {e.v(now_ms)})"
                    ),
                    ReturnValues="ALL_NEW",
                    **e.params(),
                )
            except ClientError as exc:
                if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                    continue  # outra réplica reivindicou, ou já foi publicado (GSI é eventual)
                raise
            claimed.append(self._outbox_from(updated["Attributes"]))
        return claimed

    def mark_outbox_published(self, message_id: str, owner: str, now: datetime) -> None:
        e = _Expr()
        try:
            self._call(
                self._client.update_item,
                TableName=self._t_outbox,
                Key={"messageId": {"S": message_id}},
                UpdateExpression=(
                    f"SET {e.n('status')} = {e.v('PUBLISHED')}, {e.n('publishedAt')} = {e.v(_ts(now))}, "
                    f"{e.n('expiresAt')} = {e.v(_epoch(now + self._published_ttl))} "
                    f"REMOVE {e.n('pendingKey')}, {e.n('lockedBy')}, {e.n('lockedUntil')}"
                ),
                ConditionExpression=f"{e.n('lockedBy')} = {e.v(owner)}",
                **e.params(),
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            # lease expirou e outra réplica assumiu: pode haver publicação duplicada — a inbox do consumidor resolve.
            log.warning("outbox.lease_lost", extra={"outboxMessageId": message_id})

    def release_outbox_claim(self, message_id: str, owner: str) -> None:
        e = _Expr()
        try:
            self._call(
                self._client.update_item,
                TableName=self._t_outbox,
                Key={"messageId": {"S": message_id}},
                UpdateExpression=f"REMOVE {e.n('lockedBy')}, {e.n('lockedUntil')}",
                ConditionExpression=f"{e.n('lockedBy')} = {e.v(owner)}",
                **e.params(),
            )
        except (ClientError, StoreUnavailable):
            pass  # o lease expira sozinho

    def outbox_stats(self) -> OutboxStats:
        count = 0
        params: dict[str, Any] = {
            "TableName": self._t_outbox,
            "IndexName": "pending",
            "KeyConditionExpression": "pendingKey = :p",
            "ExpressionAttributeValues": {":p": {"S": PENDING}},
            "Select": "COUNT",
        }
        while True:
            resp = self._call(self._client.query, **params)
            count += resp.get("Count", 0)
            if "LastEvaluatedKey" not in resp:
                break
            params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        oldest = None
        if count:
            first = self._call(
                self._client.query,
                TableName=self._t_outbox,
                IndexName="pending",
                KeyConditionExpression="pendingKey = :p",
                ExpressionAttributeValues={":p": {"S": PENDING}},
                Limit=1,
                ScanIndexForward=True,
            )
            if first.get("Items"):
                oldest = _parse_ts(first["Items"][0]["createdAt"]["S"])
        return OutboxStats(pending=count, oldest_pending_at=oldest)
