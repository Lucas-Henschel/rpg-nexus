"""Modelos de ficha no DynamoDB: tabela ``character_templates`` (privada do S2).

``TEMPLATE#{id}`` / ``HEAD``        versão atual (cópia completa) + ``gsi1pk=OWNER#{ownerId}`` para listar
``TEMPLATE#{id}`` / ``V#{000001}``  cada versão, gravada uma vez e nunca alterada

Editar um modelo grava a versão nova e troca o cabeçalho na mesma transação, com a condição
``version = versão esperada``: duas edições concorrentes não se sobrescrevem.
"""

from __future__ import annotations

import json
from typing import Any

from boto3.session import Session
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.application.ports import CharacterAlreadyExists, ConcurrencyConflict, StoreUnavailable
from app.domain.models import CharacterTemplate, TemplateDefinition

from .dynamodb_store import _from_item, _parse_ts, _to_item, _ts

HEAD = "HEAD"


def _pk(template_id: str) -> str:
    return f"TEMPLATE#{template_id}"


def _version_sk(version: int) -> str:
    return f"V#{version:06d}"


class DynamoDBTemplateStore:
    def __init__(self, *, region: str, endpoint_url: str | None, table: str, client: Any | None = None) -> None:
        self._client = client or Session().client(
            "dynamodb",
            region_name=region,
            endpoint_url=endpoint_url,
            config=Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=2, read_timeout=5),
        )
        self._table = table

    def _call(self, fn: Any, **kwargs: Any) -> Any:
        try:
            return fn(**kwargs)
        except BotoCoreError as exc:
            raise StoreUnavailable(str(exc)) from exc

    def ping(self) -> None:
        self._call(self._client.describe_table, TableName=self._table)

    # --- serialização -------------------------------------------------------------------------

    @staticmethod
    def _fields(t: CharacterTemplate) -> dict[str, Any]:
        d = t.definition
        return {
            "templateId": t.id,
            "ownerId": t.owner_id,
            "name": t.name,
            "description": t.description,
            "version": t.version,
            "visibility": t.visibility,
            "sheet": json.dumps(d.sheet, ensure_ascii=False) if d.sheet is not None else None,
            "attributes": d.attributes,
            "skills": d.skills,
            "hpMax": d.hp_max,
            "maxItems": d.max_items,
            "currencyName": d.currency_name,
            "currencyAmount": d.currency_amount,
            "createdAt": _ts(t.created_at),
            "updatedAt": _ts(t.updated_at),
        }

    def _head_item(self, t: CharacterTemplate) -> dict[str, Any]:
        return _to_item(
            {
                "pk": _pk(t.id),
                "sk": HEAD,
                **self._fields(t),
                "deleted": t.deleted,
                "gsi1pk": None if t.deleted else f"OWNER#{t.owner_id}",
                "gsi1sk": None if t.deleted else f"{_ts(t.updated_at)}#{t.id}",
            }
        )

    def _version_item(self, t: CharacterTemplate) -> dict[str, Any]:
        return _to_item({"pk": _pk(t.id), "sk": _version_sk(t.version), **self._fields(t)})

    @staticmethod
    def _from(item: dict[str, Any], deleted: bool | None = None) -> CharacterTemplate:
        d = _from_item(item)
        return CharacterTemplate(
            id=d["templateId"],
            owner_id=d["ownerId"],
            name=d["name"],
            description=d.get("description"),
            version=d["version"],
            visibility=d.get("visibility", "PRIVATE"),
            definition=TemplateDefinition(
                sheet=json.loads(d["sheet"]) if d.get("sheet") else None,
                attributes=dict(d.get("attributes") or {}),
                skills=dict(d.get("skills") or {}),
                hp_max=d["hpMax"],
                max_items=d["maxItems"],
                currency_name=d.get("currencyName", "Moedas"),
                currency_amount=d.get("currencyAmount", 0),
            ),
            created_at=_parse_ts(d["createdAt"]),
            updated_at=_parse_ts(d["updatedAt"]),
            deleted=bool(d.get("deleted", False)) if deleted is None else deleted,
        )

    # --- operações ----------------------------------------------------------------------------

    def _transact(self, items: list[dict[str, Any]]) -> None:
        try:
            self._call(self._client.transact_write_items, TransactItems=items)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("TransactionCanceledException", "TransactionConflictException"):
                raise ConcurrencyConflict("condição do modelo falhou") from exc
            raise

    def create_template(self, template: CharacterTemplate) -> None:
        try:
            self._transact(
                [
                    {
                        "Put": {
                            "TableName": self._table,
                            "Item": self._head_item(template),
                            "ConditionExpression": "attribute_not_exists(pk)",
                        }
                    },
                    {
                        "Put": {
                            "TableName": self._table,
                            "Item": self._version_item(template),
                            "ConditionExpression": "attribute_not_exists(pk)",
                        }
                    },
                ]
            )
        except ConcurrencyConflict as exc:
            raise CharacterAlreadyExists(template.id) from exc

    def _get(self, template_id: str, sk: str) -> dict[str, Any] | None:
        resp = self._call(
            self._client.get_item, TableName=self._table, Key=_to_item({"pk": _pk(template_id), "sk": sk}), ConsistentRead=True
        )
        return resp.get("Item")

    def get_template(self, template_id: str, version: int | None = None) -> CharacterTemplate | None:
        head = self._get(template_id, HEAD)
        if head is None:
            return None
        if version is None:
            return self._from(head)
        item = self._get(template_id, _version_sk(version))
        return self._from(item, deleted=bool(_from_item(head).get("deleted", False))) if item else None

    def list_templates(self, owner_id: str) -> list[CharacterTemplate]:
        templates: list[CharacterTemplate] = []
        params: dict[str, Any] = {
            "TableName": self._table,
            "IndexName": "byOwner",
            "KeyConditionExpression": "gsi1pk = :o",
            "ExpressionAttributeValues": {":o": {"S": f"OWNER#{owner_id}"}},
            "ScanIndexForward": False,  # mais recente primeiro
        }
        while True:
            resp = self._call(self._client.query, **params)
            templates.extend(self._from(i) for i in resp.get("Items", []))
            if "LastEvaluatedKey" not in resp:
                return templates
            params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    def add_version(self, template: CharacterTemplate, expected_version: int) -> None:
        self._transact(
            [
                {
                    "Put": {
                        "TableName": self._table,
                        "Item": self._head_item(template),
                        "ConditionExpression": "#v = :expected AND #deleted = :false",
                        "ExpressionAttributeNames": {"#v": "version", "#deleted": "deleted"},
                        "ExpressionAttributeValues": {":expected": {"N": str(expected_version)}, ":false": {"BOOL": False}},
                    }
                },
                {
                    "Put": {
                        "TableName": self._table,
                        "Item": self._version_item(template),
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                },
            ]
        )

    def delete_template(self, template_id: str, owner_id: str) -> None:
        try:
            self._call(
                self._client.update_item,
                TableName=self._table,
                Key=_to_item({"pk": _pk(template_id), "sk": HEAD}),
                # sai da listagem (sem gsi1pk), mas as versões ficam: fichas antigas continuam apontando para elas
                UpdateExpression="SET #deleted = :true REMOVE gsi1pk, gsi1sk",
                ConditionExpression="ownerId = :o",
                ExpressionAttributeNames={"#deleted": "deleted"},
                ExpressionAttributeValues={":true": {"BOOL": True}, ":o": {"S": owner_id}},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
