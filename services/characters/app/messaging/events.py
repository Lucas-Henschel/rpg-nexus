"""Catálogo dos eventos que o S2 consome/produz e seus payloads tipados.

Princípio do *leitor tolerante*: payloads consumidos ignoram campos extras (``extra="ignore"``),
permitindo que o produtor evolua de forma compatível. Payloads produzidos são estritos
(``extra="forbid"``) e ainda são validados contra o JSON Schema antes de entrar na outbox.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints

from app.domain.models import MoneyRejectionReason, RejectionReason

Id = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Quantity = Annotated[int, Field(ge=1, le=100)]


@dataclass(frozen=True)
class EventSpec:
    name: str
    type: str
    version: int
    routing_key: str
    schema_file: str | None  # relativo a contracts/; None quando o schema é de outro dono


CHARACTER_VALIDATION_REQUESTED = EventSpec(
    "CharacterValidationRequested",
    "rpg.character.validation-requested.v1",
    1,
    "character.validation.requested.v1",
    "events/character-validation-requested.v1.schema.json",
)
# Versão 2 do mesmo evento, convivendo com a v1 (tipo, routing key e schema próprios).
CHARACTER_VALIDATION_REQUESTED_V2 = EventSpec(
    "CharacterValidationRequested",
    "rpg.character.validation-requested.v2",
    2,
    "character.validation.requested.v2",
    "events/character-validation-requested.v2.schema.json",
)
CHARACTER_VALIDATED = EventSpec(
    "CharacterValidated",
    "rpg.character.validated.v1",
    1,
    "character.validated.v1",
    "events/character-validated.v1.schema.json",
)
CHARACTER_REJECTED = EventSpec(
    "CharacterRejected",
    "rpg.character.rejected.v1",
    1,
    "character.rejected.v1",
    "events/character-rejected.v1.schema.json",
)
# Eventos de propriedade do S3 Inventário (P3). O S2 apenas consome.
ITEM_ACQUIRED = EventSpec("ItemAcquired", "rpg.item.acquired.v1", 1, "item.acquired.v1", "events/item-acquired.v1.schema.json")
ACQUISITION_CANCELLED = EventSpec(
    "AcquisitionCancelled",
    "rpg.acquisition.cancelled.v1",
    1,
    "acquisition.cancelled.v1",
    "events/acquisition-cancelled.v1.schema.json",
)

# Dinheiro na Saga de compra da loja: o S3 Inventário pede, o S2 debita/reembolsa e responde.
MONEY_DEBIT_REQUESTED = EventSpec(
    "MoneyDebitRequested",
    "rpg.money.debit-requested.v1",
    1,
    "money.debit.requested.v1",
    "events/money-debit-requested.v1.schema.json",
)
MONEY_REFUND_REQUESTED = EventSpec(
    "MoneyRefundRequested",
    "rpg.money.refund-requested.v1",
    1,
    "money.refund.requested.v1",
    "events/money-refund-requested.v1.schema.json",
)
MONEY_DEBITED = EventSpec("MoneyDebited", "rpg.money.debited.v1", 1, "money.debited.v1", "events/money-debited.v1.schema.json")
MONEY_DEBIT_REJECTED = EventSpec(
    "MoneyDebitRejected",
    "rpg.money.debit-rejected.v1",
    1,
    "money.debit.rejected.v1",
    "events/money-debit-rejected.v1.schema.json",
)
MONEY_REFUNDED = EventSpec(
    "MoneyRefunded", "rpg.money.refunded.v1", 1, "money.refunded.v1", "events/money-refunded.v1.schema.json"
)

CONSUMED_EVENTS = (
    CHARACTER_VALIDATION_REQUESTED,
    CHARACTER_VALIDATION_REQUESTED_V2,
    ITEM_ACQUIRED,
    ACQUISITION_CANCELLED,
    MONEY_DEBIT_REQUESTED,
    MONEY_REFUND_REQUESTED,
)
PRODUCED_EVENTS = (CHARACTER_VALIDATED, CHARACTER_REJECTED, MONEY_DEBITED, MONEY_DEBIT_REJECTED, MONEY_REFUNDED)


class _Consumed(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class _Produced(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ValidationRequestedPayload(_Consumed):
    operationId: Id
    campaignId: Id
    characterId: Id
    itemId: Id
    quantity: Quantity
    deadlineAt: AwareDatetime | None = None


class ValidationRequestedPayloadV2(_Consumed):
    """Payload da v2: o prazo é obrigatório e se chama ``expiresAt`` (na v1 era ``deadlineAt``, opcional)."""

    operationId: Id
    campaignId: Id
    characterId: Id
    itemId: Id
    quantity: Quantity
    expiresAt: AwareDatetime

    def upcast(self) -> ValidationRequestedPayload:
        """Converte para a forma interna única; as regras de negócio não conhecem versões de evento."""
        return ValidationRequestedPayload(
            operationId=self.operationId,
            campaignId=self.campaignId,
            characterId=self.characterId,
            itemId=self.itemId,
            quantity=self.quantity,
            deadlineAt=self.expiresAt,
        )


class AcquisitionOutcomePayload(_Consumed):
    """Mínimo que o S2 precisa de ItemAcquired / AcquisitionCancelled (ver contracts-consumed/)."""

    operationId: Id
    characterId: Id
    quantity: Annotated[int, Field(ge=1)] | None = None


class CharacterValidatedPayload(_Produced):
    operationId: Id
    campaignId: Id
    characterId: Id
    itemId: Id
    quantity: Quantity
    slotsRemaining: Annotated[int, Field(ge=0)]


class CharacterRejectedPayload(_Produced):
    operationId: Id
    campaignId: Id
    characterId: Id
    itemId: Id
    quantity: Quantity
    reason: RejectionReason
    detail: Annotated[str, StringConstraints(max_length=500)] = ""


# --- Dinheiro -------------------------------------------------------------------------------------

Amount = Annotated[int, Field(ge=1, le=1_000_000)]
Balance = Annotated[int, Field(ge=0)]


class MoneyDebitRequestedPayload(_Consumed):
    operationId: Id
    campaignId: Id
    characterId: Id
    #: Quem está comprando (``sub`` do token do S4): o S2 confere que é o dono da ficha.
    userId: Id
    amount: Amount
    itemId: Id | None = None
    deadlineAt: AwareDatetime | None = None


class MoneyRefundRequestedPayload(_Consumed):
    operationId: Id
    campaignId: Id
    characterId: Id
    #: Informativo: o S2 devolve o valor que ele mesmo debitou para a operação.
    amount: Annotated[int, Field(ge=0)] | None = None


class MoneyDebitedPayload(_Produced):
    operationId: Id
    campaignId: Id
    characterId: Id
    userId: Id
    amount: Amount
    balance: Balance


class MoneyDebitRejectedPayload(_Produced):
    operationId: Id
    campaignId: Id
    characterId: Id
    userId: Id
    amount: Amount
    reason: MoneyRejectionReason
    detail: Annotated[str, StringConstraints(max_length=500)] = ""


class MoneyRefundedPayload(_Produced):
    operationId: Id
    campaignId: Id
    characterId: Id
    #: Valor devolvido; 0 quando não havia débito para a operação (reembolso antes do débito).
    amount: Annotated[int, Field(ge=0)]
    balance: Balance
