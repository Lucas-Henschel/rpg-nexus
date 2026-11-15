from __future__ import annotations

import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.adapters.memory_store import InMemoryCharacterStore  # noqa: E402
from app.application.handlers import MessageHandlers  # noqa: E402
from app.domain.models import Character, HitPoints  # noqa: E402
from app.messaging.contracts import ContractRegistry  # noqa: E402
from app.messaging.envelope import Envelope, build_envelope  # noqa: E402
from app.messaging.events import (  # noqa: E402
    ACQUISITION_CANCELLED,
    CHARACTER_VALIDATION_REQUESTED,
    CHARACTER_VALIDATION_REQUESTED_V2,
    ITEM_ACQUIRED,
)

CONTRACTS_DIR = REPO_ROOT / "contracts"


class FakeClock:
    def __init__(self, start: datetime | None = None) -> None:
        self.now = start or datetime(2026, 11, 11, 12, 0, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def store() -> InMemoryCharacterStore:
    return InMemoryCharacterStore()


@pytest.fixture
def contracts() -> ContractRegistry:
    return ContractRegistry(CONTRACTS_DIR)


@pytest.fixture
def handlers(store: InMemoryCharacterStore, clock: FakeClock, contracts: ContractRegistry) -> MessageHandlers:
    # valida todo evento produzido contra o JSON Schema: um handler que gerar evento fora do contrato quebra o teste
    return MessageHandlers(store, clock=clock, outgoing_validator=contracts.validate_event)


def make_character(store: InMemoryCharacterStore, clock: FakeClock, **overrides: Any) -> Character:
    defaults: dict[str, Any] = dict(
        id="p1",
        campaign_id="c1",
        name="Lyra",
        hp=HitPoints(20, 20),
        attributes={"forca": 15},
        skills={"furtividade": 3},
        max_items=10,
        created_at=clock(),
        updated_at=clock(),
    )
    defaults.update(overrides)
    character = Character(**defaults)
    store.create_character(character)
    return character


def validation_request(
    *,
    operation_id: str | None = None,
    character_id: str = "p1",
    campaign_id: str = "c1",
    quantity: int = 1,
    deadline_at: str | None = None,
    message_id: str | None = None,
    occurred_at: datetime | None = None,
) -> Envelope:
    op = operation_id or str(uuid.uuid4())
    payload: dict[str, Any] = {
        "operationId": op,
        "campaignId": campaign_id,
        "characterId": character_id,
        "itemId": "sword",
        "quantity": quantity,
    }
    if deadline_at:
        payload["deadlineAt"] = deadline_at
    return Envelope.model_validate(
        build_envelope(
            event_type=CHARACTER_VALIDATION_REQUESTED.type,
            version=1,
            correlation_id=op,
            payload=payload,
            occurred_at=occurred_at or datetime(2026, 11, 11, 12, 0, tzinfo=UTC),
            message_id=message_id,
        )
    )


def validation_request_v2(
    character_id: str = "p1",
    campaign_id: str = "c1",
    operation_id: str | None = None,
    expires_at: str | None = "2026-11-11T12:05:00Z",
    message_id: str | None = None,
) -> Envelope:
    """Pedido na versão 2 do evento: prazo obrigatório no campo ``expiresAt``."""
    op = operation_id or str(uuid.uuid4())
    payload: dict[str, Any] = {
        "operationId": op,
        "campaignId": campaign_id,
        "characterId": character_id,
        "itemId": "sword",
        "quantity": 1,
    }
    if expires_at:
        payload["expiresAt"] = expires_at
    return Envelope.model_validate(
        build_envelope(
            event_type=CHARACTER_VALIDATION_REQUESTED_V2.type,
            version=2,
            correlation_id=op,
            payload=payload,
            occurred_at=datetime(2026, 11, 11, 12, 0, tzinfo=UTC),
            message_id=message_id,
        )
    )


def outcome_event(kind: str, operation_id: str, character_id: str = "p1", message_id: str | None = None) -> Envelope:
    spec = ITEM_ACQUIRED if kind == "acquired" else ACQUISITION_CANCELLED
    return Envelope.model_validate(
        build_envelope(
            event_type=spec.type,
            version=1,
            correlation_id=operation_id,
            payload={"operationId": operation_id, "characterId": character_id, "itemId": "sword", "quantity": 1},
            occurred_at=datetime(2026, 11, 11, 12, 0, 5, tzinfo=UTC),
            message_id=message_id,
        )
    )
