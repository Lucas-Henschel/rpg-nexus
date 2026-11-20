from __future__ import annotations

import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.adapters.memory_store import InMemoryCharacterStore  # noqa: E402
from app.application.handlers import MessageHandlers  # noqa: E402
from app.bootstrap import build_container  # noqa: E402
from app.config import Settings  # noqa: E402
from app.domain.models import Character, HitPoints  # noqa: E402
from app.main import create_app  # noqa: E402
from app.messaging.contracts import ContractRegistry  # noqa: E402
from app.messaging.envelope import Envelope, build_envelope  # noqa: E402
from app.messaging.events import (  # noqa: E402
    ACQUISITION_CANCELLED,
    CAMPAIGN_MEMBER_JOINED,
    CAMPAIGN_MEMBER_REMOVED,
    CHARACTER_VALIDATION_REQUESTED,
    CHARACTER_VALIDATION_REQUESTED_V2,
    ITEM_ACQUIRED,
    MONEY_DEBIT_REQUESTED,
    MONEY_REFUND_REQUESTED,
)
from app.security import sign_access_token  # noqa: E402

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


def money_debit_request(
    *,
    operation_id: str | None = None,
    character_id: str = "p1",
    campaign_id: str = "c1",
    user_id: str = "user-ana",
    amount: int = 30,
    deadline_at: str | None = None,
    message_id: str | None = None,
) -> Envelope:
    """MoneyDebitRequested, como o S3 publicaria no passo de pagamento da compra."""
    op = operation_id or str(uuid.uuid4())
    payload: dict[str, Any] = {
        "operationId": op,
        "campaignId": campaign_id,
        "characterId": character_id,
        "userId": user_id,
        "amount": amount,
        "itemId": "sword",
    }
    if deadline_at:
        payload["deadlineAt"] = deadline_at
    return Envelope.model_validate(
        build_envelope(
            event_type=MONEY_DEBIT_REQUESTED.type,
            version=1,
            correlation_id=op,
            payload=payload,
            occurred_at=datetime(2026, 11, 11, 12, 0, tzinfo=UTC),
            message_id=message_id,
        )
    )


def money_refund_request(operation_id: str, character_id: str = "p1", message_id: str | None = None) -> Envelope:
    return Envelope.model_validate(
        build_envelope(
            event_type=MONEY_REFUND_REQUESTED.type,
            version=1,
            correlation_id=operation_id,
            payload={
                "operationId": operation_id,
                "campaignId": "c1",
                "userId": "user-ana",
                "characterId": character_id,
                "itemId": "sword",
                "amount": 30,
            },
            occurred_at=datetime(2026, 11, 11, 12, 0, 5, tzinfo=UTC),
            message_id=message_id,
        )
    )


# --- API (FastAPI TestClient) ---------------------------------------------------------------------


@pytest.fixture
def container():
    settings = Settings.from_env(
        {
            "STORE_BACKEND": "memory",
            "STORAGE_BACKEND": "memory",
            "MESSAGING_ENABLED": "false",
            "LOG_FORMAT": "text",
            "PORTRAIT_MAX_BYTES": "2048",
        }
    )
    container = build_container(settings)
    # Participantes, como o S1 publicaria: user-mestre é o dono (mestre); ana e bia são jogadoras.
    for campaign in ("c1", "c2", "vazia"):
        for user, role in (("user-mestre", "OWNER"), ("user-ana", "PLAYER"), ("user-bia", "PLAYER")):
            container.handlers.dispatch(member_joined(campaign, user, role))
    return container


def member_joined(campaign_id: str, user_id: str, role: str = "PLAYER", at: str = "2026-11-11T11:00:00Z") -> Envelope:
    """CampaignMemberJoined, como o S1 publica (o dono também entra assim, com role OWNER)."""
    return Envelope.model_validate(
        build_envelope(
            event_type=CAMPAIGN_MEMBER_JOINED.type,
            version=1,
            correlation_id=campaign_id,
            payload={"campaignId": campaign_id, "userId": user_id, "username": user_id, "role": role, "joinedAt": at},
            occurred_at=datetime.fromisoformat(at.replace("Z", "+00:00")),
        )
    )


def member_removed(campaign_id: str, user_id: str, at: str = "2026-11-11T13:00:00Z") -> Envelope:
    return Envelope.model_validate(
        build_envelope(
            event_type=CAMPAIGN_MEMBER_REMOVED.type,
            version=1,
            correlation_id=campaign_id,
            payload={"campaignId": campaign_id, "userId": user_id, "removedBy": user_id, "reason": "LEFT", "removedAt": at},
            occurred_at=datetime.fromisoformat(at.replace("Z", "+00:00")),
        )
    )


def token_for(container, user_id: str = "user-ana", username: str = "ana") -> str:
    s = container.settings
    return sign_access_token(s.jwt_secret, issuer=s.jwt_issuer, audience=s.jwt_audience, user_id=user_id, username=username)


@pytest.fixture
def api(container):
    """Cliente logado como user-ana (access token igual ao do S4)."""
    headers = {"Authorization": f"Bearer {token_for(container)}"}
    with TestClient(create_app(container=container), headers=headers) as client:
        yield client


@pytest.fixture
def other(container):
    """Outro usuário logado (user-bia), para testar que ninguém mexe na ficha alheia."""
    headers = {"Authorization": f"Bearer {token_for(container, 'user-bia', 'bia')}"}
    with TestClient(create_app(container=container), headers=headers) as client:
        yield client


@pytest.fixture
def gm(container):
    """O mestre (dono) das campanhas c1 e c2: lê as fichas da campanha e ajusta o dinheiro."""
    headers = {"Authorization": f"Bearer {token_for(container, 'user-mestre', 'mestre')}"}
    with TestClient(create_app(container=container), headers=headers) as client:
        yield client


@pytest.fixture
def anonymous(container):
    with TestClient(create_app(container=container)) as client:
        yield client
