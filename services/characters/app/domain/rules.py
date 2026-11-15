"""Regras de negócio puras (determinísticas, sem I/O) — fáceis de testar e de explicar na defesa."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .errors import CapacityBelowUsage
from .models import CapacityHold, Character, HoldStatus, RejectionReason


@dataclass(frozen=True)
class ValidationDecision:
    approved: bool
    reason: RejectionReason | None = None
    detail: str = ""
    #: True quando já existe reserva ativa para a operação (pedido reenviado com outro messageId):
    #: responde-se de novo "validado" sem reservar capacidade outra vez.
    replay: bool = False

    @classmethod
    def approve(cls, detail: str = "personagem apto", *, replay: bool = False) -> ValidationDecision:
        return cls(True, None, detail, replay)

    @classmethod
    def reject(cls, reason: RejectionReason, detail: str) -> ValidationDecision:
        return cls(False, reason, detail)


def evaluate_validation_request(
    character: Character | None,
    existing_hold: CapacityHold | None,
    *,
    campaign_id: str,
    quantity: int,
    deadline_at: datetime | None,
    now: datetime,
) -> ValidationDecision:
    """Decide se o personagem pode receber ``quantity`` itens na operação.

    A ordem das verificações importa:
    1. Reserva já existente decide primeiro (idempotência por operationId, além do messageId).
    2. Prazo vencido: não adianta reservar para uma Saga que já expirou.
    3. Regras simples de elegibilidade e capacidade.
    """
    if existing_hold is not None:
        if existing_hold.status in (HoldStatus.HELD, HoldStatus.COMMITTED):
            return ValidationDecision.approve("reserva já existente para a operação", replay=True)
        return ValidationDecision.reject(RejectionReason.OPERATION_CLOSED, "operação já encerrada no S2 (reserva liberada)")

    if deadline_at is not None and now >= deadline_at:
        return ValidationDecision.reject(
            RejectionReason.DEADLINE_EXPIRED, f"prazo da operação expirou em {deadline_at.isoformat()}"
        )

    if character is None:
        return ValidationDecision.reject(RejectionReason.CHARACTER_NOT_FOUND, "personagem inexistente")

    if character.campaign_id != campaign_id:
        return ValidationDecision.reject(
            RejectionReason.CAMPAIGN_MISMATCH,
            f"personagem pertence à campanha {character.campaign_id}, não a {campaign_id}",
        )

    if not character.active:
        return ValidationDecision.reject(RejectionReason.CHARACTER_INACTIVE, "personagem inativo")

    if character.slots_available < quantity:
        return ValidationDecision.reject(
            RejectionReason.CAPACITY_EXCEEDED,
            f"capacidade livre {max(character.slots_available, 0)}, solicitado {quantity}",
        )

    return ValidationDecision.approve()


def ensure_max_items_change_allowed(character: Character, new_max_items: int) -> None:
    """Reduzir maxItems abaixo do que já está ocupado/reservado quebraria a invariante."""
    if new_max_items < character.slots_used:
        raise CapacityBelowUsage(new_max_items, character.slots_used)


def merge_stat_map(current: dict[str, int], patch: dict[str, int | None]) -> dict[str, int]:
    """Semântica de JSON Merge Patch (RFC 7396) para atributos/perícias: ``null`` remove a chave."""
    merged = dict(current)
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged
