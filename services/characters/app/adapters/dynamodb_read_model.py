"""Modelo de leitura (CQRS) no DynamoDB: tabela ``character_read_model``.

Chave: ``campaignId`` (partição) + ``characterId`` (ordenação). "Todos os personagens da campanha, já
resumidos" é uma única Query pela chave primária, sem índice e sem tocar a tabela de escrita.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from boto3.session import Session
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.application.ports import StoreUnavailable
from app.application.read_model import CharacterSummary
from app.messaging.envelope import format_timestamp

from .dynamodb_store import _from_item, _to_item

MAX_PAGES = 20


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class DynamoDBReadModel:
    def __init__(self, *, region: str, endpoint_url: str | None, table: str, client: Any | None = None) -> None:
        self._client = client or Session().client(
            "dynamodb",
            region_name=region,
            endpoint_url=endpoint_url,
            config=Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=2, read_timeout=5),
        )
        self._table = table

    def ping(self) -> None:
        try:
            self._client.describe_table(TableName=self._table)
        except BotoCoreError as exc:
            raise StoreUnavailable(str(exc)) from exc

    def put_summary(self, summary: CharacterSummary) -> bool:
        item = _to_item(
            {
                "campaignId": summary.campaign_id,
                "characterId": summary.character_id,
                "name": summary.name,
                "active": summary.active,
                "hpCurrent": summary.hp_current,
                "hpMax": summary.hp_max,
                "maxItems": summary.max_items,
                "slotsUsed": summary.slots_used,
                "slotsAvailable": summary.slots_available,
                "holdsHeld": summary.holds_held,
                "holdsCommitted": summary.holds_committed,
                "holdsReleased": summary.holds_released,
                "hasPortrait": summary.has_portrait,
                "profileVersion": summary.profile_version,
                "createdAt": format_timestamp(summary.created_at),
                "updatedAt": format_timestamp(summary.updated_at),
                "projectedAt": format_timestamp(summary.projected_at),
            }
        )
        try:
            # Só regrava se esta projeção não for mais antiga que a que já está na tabela.
            self._client.put_item(
                TableName=self._table,
                Item=item,
                ConditionExpression="attribute_not_exists(campaignId) OR projectedAt <= :p",
                ExpressionAttributeValues={":p": item["projectedAt"]},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return False
            raise
        except BotoCoreError as exc:
            raise StoreUnavailable(str(exc)) from exc
        return True

    def list_campaign(self, campaign_id: str) -> list[CharacterSummary]:
        params: dict[str, Any] = {
            "TableName": self._table,
            "KeyConditionExpression": "campaignId = :c",
            "ExpressionAttributeValues": {":c": {"S": campaign_id}},
        }
        summaries: list[CharacterSummary] = []
        try:
            for _ in range(MAX_PAGES):
                resp = self._client.query(**params)
                summaries.extend(self._summary_from(_from_item(i)) for i in resp.get("Items", []))
                last = resp.get("LastEvaluatedKey")
                if not last:
                    break
                params["ExclusiveStartKey"] = last
        except BotoCoreError as exc:
            raise StoreUnavailable(str(exc)) from exc
        return summaries

    @staticmethod
    def _summary_from(data: dict[str, Any]) -> CharacterSummary:
        return CharacterSummary(
            campaign_id=data["campaignId"],
            character_id=data["characterId"],
            name=data["name"],
            active=bool(data["active"]),
            hp_current=data["hpCurrent"],
            hp_max=data["hpMax"],
            max_items=data["maxItems"],
            slots_used=data["slotsUsed"],
            slots_available=data["slotsAvailable"],
            holds_held=data["holdsHeld"],
            holds_committed=data["holdsCommitted"],
            holds_released=data["holdsReleased"],
            has_portrait=bool(data["hasPortrait"]),
            profile_version=data["profileVersion"],
            created_at=_parse_ts(data["createdAt"]),
            updated_at=_parse_ts(data["updatedAt"]),
            projected_at=_parse_ts(data["projectedAt"]),
        )
