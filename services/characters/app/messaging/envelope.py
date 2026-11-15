"""Envelope comum (contracts/envelope.schema.json) em forma de modelo Pydantic."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from .errors import PoisonMessage

TYPE_PATTERN = r"^rpg\.[a-z0-9-]+(\.[a-z0-9-]+)*\.v[1-9][0-9]*$"


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    messageId: uuid.UUID
    correlationId: str = Field(min_length=1, max_length=128)
    type: str = Field(pattern=TYPE_PATTERN)
    version: int = Field(ge=1)
    occurredAt: AwareDatetime
    payload: dict[str, Any]


def format_timestamp(value: datetime) -> str:
    """ISO-8601 em UTC com milissegundos e sufixo Z (ex.: 2026-11-11T12:00:00.123Z)."""
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_envelope(
    *,
    event_type: str,
    version: int,
    correlation_id: str,
    payload: dict[str, Any],
    occurred_at: datetime,
    message_id: str | None = None,
) -> dict[str, Any]:
    """Monta o envelope já serializável em JSON. Um novo messageId é gerado por evento lógico."""
    return {
        "messageId": message_id or str(uuid.uuid4()),
        "correlationId": correlation_id,
        "type": event_type,
        "version": version,
        "occurredAt": format_timestamp(occurred_at),
        "payload": payload,
    }


def parse_envelope(body: bytes | str) -> Envelope:
    try:
        raw = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PoisonMessage(f"corpo não é JSON válido: {exc}") from exc
    if not isinstance(raw, dict):
        raise PoisonMessage("envelope deve ser um objeto JSON")
    try:
        return Envelope.model_validate(raw)
    except ValidationError as exc:
        raise PoisonMessage(f"envelope inválido: {_summarize(exc)}") from exc


def _summarize(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors()[:5]:
        loc = ".".join(str(p) for p in err["loc"]) or "<raiz>"
        parts.append(f"{loc}: {err['msg']}")
    return "; ".join(parts)


summarize_validation_error = _summarize
