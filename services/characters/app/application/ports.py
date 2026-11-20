"""Portas (arquitetura hexagonal) implementadas pelos adaptadores DynamoDB/S3/memória.

Cada método de escrita que envolve uma mensagem é **uma única transação local**: registro na
inbox + efeito de negócio + evento na outbox são gravados juntos ou nenhum é gravado. É isso que
torna o consumo *at-least-once* seguro (R1) e evita perder eventos entre banco e broker.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from app.domain.models import CampaignMembership, CampaignTemplate, CapacityHold, Character, CharacterTemplate, MoneyEntry

# --- Exceções de infraestrutura que os casos de uso sabem tratar -------------------------------


class DuplicateMessage(Exception):
    """O messageId já está na inbox: o efeito já foi aplicado; basta confirmar (ACK)."""


class ConcurrencyConflict(Exception):
    """Uma condição da transação falhou (estado mudou entre leitura e escrita). Releia e decida de novo."""


class CharacterAlreadyExists(Exception):
    pass


class AdjustmentAlreadyApplied(Exception):
    """O ajuste de saldo com esta chave já foi gravado: repetir a requisição não ajusta de novo."""


class StoreUnavailable(Exception):
    """Banco indisponível/throttling — erro transitório."""


# --- Registros técnicos -------------------------------------------------------------------------


@dataclass(frozen=True)
class InboxRecord:
    message_id: str
    type: str
    correlation_id: str
    outcome: str
    received_at: datetime
    detail: str = ""


@dataclass(frozen=True)
class OutboxRecord:
    message_id: str
    type: str
    routing_key: str
    correlation_id: str
    envelope: dict[str, Any]
    created_at: datetime
    status: str = "PENDING"  # PENDING | PUBLISHED
    attempts: int = 0
    published_at: datetime | None = None
    #: W3C Trace Context de quando o evento foi gerado; o relay continua este trace ao publicar.
    trace_context: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Page:
    items: list[Character]
    next_cursor: str | None


@dataclass(frozen=True)
class OutboxStats:
    pending: int
    oldest_pending_at: datetime | None
    extra: dict[str, Any] = field(default_factory=dict)


class CharacterStore(Protocol):
    # Saúde
    def ping(self) -> None: ...

    # Fichas
    def create_character(self, character: Character) -> None:
        """Cria a ficha; ``CharacterAlreadyExists`` se o id já existir."""
        ...

    def get_character(self, character_id: str) -> Character | None: ...

    def list_characters(self, campaign_id: str, limit: int, cursor: str | None, owner_id: str | None = None) -> Page:
        """Fichas da campanha; com ``owner_id``, só as daquele usuário."""
        ...

    def save_profile(self, character: Character, expected_version: int, max_items_delta: int) -> None:
        """Grava campos de perfil com condição ``version = expected_version``.

        Se ``max_items_delta`` != 0, ajusta ``slotsAvailable`` no mesmo comando; para deltas negativos
        exige ``slotsAvailable >= -delta`` (nunca deixa a capacidade livre negativa).
        Lança ``ConcurrencyConflict`` se a condição falhar.
        """
        ...

    # Reservas de capacidade
    def get_hold(self, character_id: str, operation_id: str) -> CapacityHold | None: ...

    def list_holds(self, character_id: str) -> list[CapacityHold]: ...

    # Inbox
    def get_inbox(self, message_id: str) -> InboxRecord | None: ...

    # Transações de consumo (todas lançam DuplicateMessage / ConcurrencyConflict)
    def reserve_capacity(self, inbox: InboxRecord, hold: CapacityHold, outbox: OutboxRecord) -> None:
        """inbox(novo) + personagem(ativo, mesma campanha, slotsAvailable >= q) -= q + hold(novo, HELD) + outbox."""
        ...

    def record_outcome(self, inbox: InboxRecord, outbox: OutboxRecord | None) -> None:
        """inbox(novo) + outbox opcional — decisão sem mudança de estado (recusa, replay, anomalia)."""
        ...

    def commit_hold(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        """inbox(novo) + hold HELD -> COMMITTED."""
        ...

    def release_hold(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        """inbox(novo) + hold HELD -> RELEASED + personagem += q (capacidade devolvida)."""
        ...

    def create_tombstone(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        """inbox(novo) + hold inexistente -> RELEASED (lápide para cancelamento que chegou antes)."""
        ...

    # Dinheiro (todas as transações lançam DuplicateMessage / ConcurrencyConflict)
    def get_money_entry(self, character_id: str, operation_id: str) -> MoneyEntry | None: ...

    def list_money_entries(self, character_id: str) -> list[MoneyEntry]: ...

    def debit_money(self, inbox: InboxRecord, entry: MoneyEntry, outbox: OutboxRecord) -> None:
        """inbox(novo) + personagem(dono, campanha, ativo, saldo >= valor) -= valor + entrada DEBITED(nova) + outbox."""
        ...

    def refund_money(self, inbox: InboxRecord, entry: MoneyEntry, outbox: OutboxRecord) -> None:
        """inbox(novo) + entrada DEBITED -> REFUNDED + personagem += valor + outbox."""
        ...

    def create_money_tombstone(self, inbox: InboxRecord, entry: MoneyEntry, outbox: OutboxRecord) -> None:
        """inbox(novo) + entrada inexistente -> REFUNDED (lápide: reembolso chegou antes do débito) + outbox."""
        ...

    def adjust_money(self, entry: MoneyEntry) -> None:
        """Ajuste manual: entrada nova + saldo += amount (com sinal), sem deixar o saldo negativo.

        ``AdjustmentAlreadyApplied`` se a entrada já existe; ``ConcurrencyConflict`` se o saldo não comporta.
        """
        ...

    # Participantes das campanhas (projeção dos eventos do S1)
    def get_membership(self, campaign_id: str, user_id: str) -> CampaignMembership | None: ...

    def apply_membership(self, inbox: InboxRecord, membership: CampaignMembership) -> None:
        """inbox(novo) + participação, só se o evento for mais novo que o gravado.

        ``DuplicateMessage`` se o messageId já foi processado; ``ConcurrencyConflict`` se o evento é antigo.
        """
        ...

    # Modelo de ficha de cada campanha (projeção dos eventos do S1)
    def get_campaign_template(self, campaign_id: str) -> CampaignTemplate | None: ...

    def apply_campaign_template(self, inbox: InboxRecord, assigned: CampaignTemplate) -> None:
        """inbox(novo) + modelo da campanha, só se o evento for mais novo que o gravado (como na participação)."""
        ...

    # Outbox
    def claim_outbox(self, limit: int, lease_seconds: int, owner: str, now: datetime) -> list[OutboxRecord]:
        """Reivindica até ``limit`` eventos PENDING com lease, para que réplicas não publiquem o mesmo ao mesmo tempo."""
        ...

    def mark_outbox_published(self, message_id: str, owner: str, now: datetime) -> None: ...

    def release_outbox_claim(self, message_id: str, owner: str) -> None: ...

    def outbox_stats(self) -> OutboxStats: ...


class TemplateStore(Protocol):
    """Modelos de ficha: o cabeçalho guarda a versão atual; cada versão fica gravada e não muda mais."""

    def ping(self) -> None: ...

    def create_template(self, template: CharacterTemplate) -> None: ...

    def get_template(self, template_id: str, version: int | None = None) -> CharacterTemplate | None:
        """Versão pedida, ou a atual. Modelos apagados continuam legíveis por versão (fichas antigas apontam para eles)."""
        ...

    def list_templates(self, owner_id: str) -> list[CharacterTemplate]:
        """Versão atual de cada modelo não apagado do usuário."""
        ...

    def add_version(self, template: CharacterTemplate, expected_version: int) -> None:
        """Grava a versão nova; ``ConcurrencyConflict`` se a atual não for mais ``expected_version``."""
        ...

    def delete_template(self, template_id: str, owner_id: str) -> None: ...


# --- Armazenamento de objetos -------------------------------------------------------------------


@dataclass(frozen=True)
class PresignedRequest:
    url: str
    method: str
    headers: dict[str, str]
    expires_in: int
    key: str


@dataclass(frozen=True)
class ObjectInfo:
    key: str
    size: int
    content_type: str


class ObjectStorage(Protocol):
    def ping(self) -> None: ...

    def presign_upload(self, key: str, content_type: str, expires_in: int) -> PresignedRequest: ...

    def presign_download(self, key: str, expires_in: int) -> str: ...

    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def head(self, key: str) -> ObjectInfo | None: ...

    def read_prefix(self, key: str, length: int) -> bytes: ...

    def get(self, key: str) -> tuple[bytes, str]: ...

    def delete(self, key: str) -> None: ...
