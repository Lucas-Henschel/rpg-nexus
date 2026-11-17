"""Catálogo dos eventos que o S2 consome/produz e seus payloads tipados.

Princípio do *leitor tolerante*: payloads consumidos ignoram campos extras (``extra="ignore"``),
permitindo que o produtor evolua de forma compatível. Payloads produzidos são estritos
(``extra="forbid"``) e ainda são validados contra o JSON Schema antes de entrar na outbox.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints

from app.domain.models import RejectionReason

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

CONSUMED_EVENTS = (CHARACTER_VALIDATION_REQUESTED, CHARACTER_VALIDATION_REQUESTED_V2, ITEM_ACQUIRED, ACQUISITION_CANCELLED)
PRODUCED_EVENTS = (CHARACTER_VALIDATED, CHARACTER_REJECTED)


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
