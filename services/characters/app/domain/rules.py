"""Regras de negócio puras (determinísticas, sem I/O) — fáceis de testar e de explicar na defesa."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .errors import CapacityBelowUsage
from .models import (
    CapacityHold,
    Character,
    HoldStatus,
    MoneyEntry,
    MoneyRejectionReason,
    MoneyStatus,
    RejectionReason,
)


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


# --- Dinheiro (Saga de compra) ---------------------------------------------------------------------


@dataclass(frozen=True)
class MoneyDecision:
    approved: bool
    reason: MoneyRejectionReason | None = None
    detail: str = ""
    #: Débito já feito para a operação (pedido reenviado com outro messageId): confirma de novo sem cobrar.
    replay: bool = False

    @classmethod
    def approve(cls, detail: str = "saldo debitado", *, replay: bool = False) -> MoneyDecision:
        return cls(True, None, detail, replay)

    @classmethod
    def reject(cls, reason: MoneyRejectionReason, detail: str) -> MoneyDecision:
        return cls(False, reason, detail)


def evaluate_debit_request(
    character: Character | None,
    existing: MoneyEntry | None,
    *,
    user_id: str,
    campaign_id: str,
    amount: int,
    deadline_at: datetime | None,
    now: datetime,
) -> MoneyDecision:
    """Decide se o personagem paga ``amount`` na operação. Mesma ordem da validação de capacidade."""
    if existing is not None:
        if existing.status is MoneyStatus.DEBITED:
            return MoneyDecision.approve("débito já feito para a operação", replay=True)
        return MoneyDecision.reject(MoneyRejectionReason.OPERATION_CLOSED, "operação já encerrada no S2 (valor reembolsado)")

    if deadline_at is not None and now >= deadline_at:
        return MoneyDecision.reject(
            MoneyRejectionReason.DEADLINE_EXPIRED, f"prazo da operação expirou em {deadline_at.isoformat()}"
        )

    if character is None:
        return MoneyDecision.reject(MoneyRejectionReason.CHARACTER_NOT_FOUND, "personagem inexistente")

    if character.owner_id != user_id:
        return MoneyDecision.reject(MoneyRejectionReason.NOT_OWNER, "o personagem não pertence a quem está comprando")

    if character.campaign_id != campaign_id:
        return MoneyDecision.reject(
            MoneyRejectionReason.CAMPAIGN_MISMATCH,
            f"personagem pertence à campanha {character.campaign_id}, não a {campaign_id}",
        )

    if not character.active:
        return MoneyDecision.reject(MoneyRejectionReason.CHARACTER_INACTIVE, "personagem inativo")

    if character.currency_amount < amount:
        return MoneyDecision.reject(MoneyRejectionReason.INSUFFICIENT_FUNDS, f"saldo {character.currency_amount}, preço {amount}")

    return MoneyDecision.approve()


# --- Modelos de ficha ------------------------------------------------------------------------------


def template_sheet(sheet: dict | None) -> dict | None:
    """Tira da organização da ficha o que é dado de um personagem e deixa só estrutura e valores iniciais.

    * texto (anotações) e lista: conteúdo pessoal, sai vazio;
    * contador: fica o máximo, e o atual volta ao máximo;
    * rolagens: são estrutura (fórmulas), ficam;
    * cabeçalho (nível, defesa…): valores do personagem, sai vazio.
    """
    if sheet is None:
        return None
    columns = []
    for column in sheet.get("columns", []):
        blocks = []
        for block in column:
            data = dict(block.get("data") or {})
            kind = block.get("type")
            if kind == "text":
                data = {}
            elif kind == "list":
                data = {"items": []}
            elif kind == "counter":
                maximum = data.get("max")
                data = {"max": maximum, "current": maximum} if maximum is not None else {}
            elif kind != "dice":
                data = {}
            blocks.append({**block, "data": data})
        columns.append(blocks)
    return {"template": sheet.get("template"), "header": {}, "columns": columns}
