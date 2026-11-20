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


class MoneyStatus(StrEnum):
    """Estado de uma operação de dinheiro da Saga de compra, guardada por ``operationId``.

    DEBITED   -> o valor saiu do saldo (MoneyDebitRequested aprovado).
    REFUNDED  -> o valor voltou ao saldo (MoneyRefundRequested); terminal.

    Uma entrada já REFUNDED sem débito anterior é uma *lápide*: o reembolso chegou antes do pedido de
    débito (reordenação), e o débito atrasado é recusado em vez de cobrar uma compra já desfeita.
    """

    DEBITED = "DEBITED"
    REFUNDED = "REFUNDED"


class MoneyRejectionReason(StrEnum):
    CHARACTER_NOT_FOUND = "CHARACTER_NOT_FOUND"
    NOT_OWNER = "NOT_OWNER"
    CAMPAIGN_MISMATCH = "CAMPAIGN_MISMATCH"
    CHARACTER_INACTIVE = "CHARACTER_INACTIVE"
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    DEADLINE_EXPIRED = "DEADLINE_EXPIRED"
    OPERATION_CLOSED = "OPERATION_CLOSED"


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
    #: Dinheiro. Só o S2 altera ``currency_amount``, sempre com escrita condicional (nunca negativo).
    currency_name: str = "Moedas"
    currency_amount: int = 0
    #: De qual modelo (e versão) a ficha foi copiada. A cópia é fixa: o modelo mudar depois não a altera.
    source_template_id: str | None = None
    source_template_version: int | None = None

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


@dataclass(frozen=True)
class MoneyEntry:
    """Registro de uma operação de dinheiro do personagem (débito da Saga, reembolso ou ajuste manual).

    Débitos/reembolsos têm uma entrada por ``operation_id`` (idempotência por operação, além da inbox).
    Ajustes manuais do dono da ficha usam ``kind="ADJUSTMENT"`` e ``amount`` com sinal.
    """

    operation_id: str
    character_id: str
    kind: str  # "PURCHASE" | "ADJUSTMENT"
    amount: int
    status: MoneyStatus | None
    created_at: datetime
    updated_at: datetime
    campaign_id: str | None = None
    user_id: str | None = None
    reason: str | None = None
    tombstone: bool = False

    def evolve(self, **changes: object) -> MoneyEntry:
        return replace(self, **changes)  # type: ignore[arg-type]


@dataclass(frozen=True)
class TemplateDefinition:
    """Estrutura e valores iniciais de uma ficha. Nada de dados atuais de um personagem."""

    sheet: dict[str, Any] | None
    attributes: dict[str, int]
    skills: dict[str, int]
    hp_max: int
    max_items: int
    currency_name: str
    currency_amount: int


@dataclass(frozen=True)
class CharacterTemplate:
    """Modelo de ficha privado do usuário. Cada edição cria uma versão nova e imutável."""

    id: str
    owner_id: str
    name: str
    description: str | None
    version: int
    definition: TemplateDefinition
    created_at: datetime
    updated_at: datetime
    visibility: str = "PRIVATE"
    deleted: bool = False

    def evolve(self, **changes: object) -> CharacterTemplate:
        return replace(self, **changes)  # type: ignore[arg-type]


@dataclass(frozen=True)
class CampaignMembership:
    """Cópia local de quem participa de cada campanha, montada com os eventos do S1.

    O S2 não lê o banco do S1: ele guarda o que precisa (papel e se ainda participa) para decidir quem
    cria ficha na campanha e quem é o mestre (``OWNER``). ``changed_at`` é o instante do evento no S1;
    um evento mais antigo que o gravado é ignorado (eventos podem chegar fora de ordem).
    """

    campaign_id: str
    user_id: str
    role: str  # "OWNER" | "PLAYER"
    active: bool
    changed_at: datetime
    username: str | None = None

    @property
    def is_owner(self) -> bool:
        return self.active and self.role == "OWNER"
