"""Entidades do domínio de Personagens."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import StrEnum
from typing import Any


class HoldStatus(StrEnum):
    """Estado da reserva de capacidade que o S2 mantém para cada operação da Saga.

    HELD       -> capacidade reservada, aguardando desfecho da Saga.
    COMMITTED  -> ItemAcquired recebido; a capacidade passa a ser ocupada pelo item.
    RELEASED   -> AcquisitionCancelled recebido; a capacidade voltou a ficar livre.

    Transições válidas: HELD -> COMMITTED, HELD -> RELEASED. COMMITTED e RELEASED são terminais.
    """

    HELD = "HELD"
    COMMITTED = "COMMITTED"
    RELEASED = "RELEASED"

    @property
    def is_terminal(self) -> bool:
        return self is not HoldStatus.HELD


class RejectionReason(StrEnum):
    CHARACTER_NOT_FOUND = "CHARACTER_NOT_FOUND"
    CHARACTER_INACTIVE = "CHARACTER_INACTIVE"
    CAMPAIGN_MISMATCH = "CAMPAIGN_MISMATCH"
    CAPACITY_EXCEEDED = "CAPACITY_EXCEEDED"
    DEADLINE_EXPIRED = "DEADLINE_EXPIRED"
    OPERATION_CLOSED = "OPERATION_CLOSED"


@dataclass(frozen=True)
class HitPoints:
    current: int
    max: int


@dataclass(frozen=True)
class Portrait:
    key: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime


@dataclass(frozen=True)
class Character:
    """Ficha genérica: atributos e perícias são mapas livres, sem regras de sistemas comerciais.

    ``slots_used`` soma as reservas HELD e COMMITTED. A capacidade livre é sempre
    ``max_items - slots_used`` e nunca fica negativa (invariante garantida por escrita condicional).
    ``version`` é a versão do *perfil* (edições do usuário) e é usada para concorrência otimista na
    API; reservas de capacidade não alteram a versão, para não gerar conflitos falsos na edição.
    """

    id: str
    campaign_id: str
    name: str
    hp: HitPoints
    created_at: datetime
    updated_at: datetime
    attributes: dict[str, int] = field(default_factory=dict)
    skills: dict[str, int] = field(default_factory=dict)
    max_items: int = 10
    slots_used: int = 0
    active: bool = True
    owner_id: str | None = None
    description: str | None = None
    portrait: Portrait | None = None
    #: Organização livre da ficha (colunas de blocos), definida pelo frontend. None = ficha padrão.
    sheet: dict[str, Any] | None = None
    version: int = 1

    @property
    def slots_available(self) -> int:
        return self.max_items - self.slots_used

    def evolve(self, **changes: object) -> Character:
        return replace(self, **changes)  # type: ignore[arg-type]


@dataclass(frozen=True)
class CapacityHold:
    """Reserva de capacidade de um personagem para uma operação (operationId) da Saga.

    ``tombstone=True`` indica que o cancelamento chegou *antes* do pedido de validação
    (reordenação entre filas). A lápide impede que um pedido atrasado reserve capacidade de uma
    operação já encerrada.
    """

    operation_id: str
    character_id: str
    quantity: int
    status: HoldStatus
    created_at: datetime
    updated_at: datetime
    campaign_id: str | None = None
    item_id: str | None = None
    tombstone: bool = False

    def evolve(self, **changes: object) -> CapacityHold:
        return replace(self, **changes)  # type: ignore[arg-type]
