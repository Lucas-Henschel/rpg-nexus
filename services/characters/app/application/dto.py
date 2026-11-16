"""DTOs de entrada/saída da API (Pydantic puro, sem FastAPI — testáveis isoladamente).

Os nomes dos campos seguem camelCase, como nos contratos JSON do grupo.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.domain.models import CapacityHold, Character

Id = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
StatKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")]
StatValue = Annotated[int, Field(ge=-1000, le=1000)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
MAX_STATS = 64


def _limit_entries(value: dict) -> dict:
    if len(value) > MAX_STATS:
        raise ValueError(f"no máximo {MAX_STATS} entradas")
    return value


SHEET_MAX_BYTES = 60_000
SHEET_MAX_BLOCKS = 60
BlockType = Literal["attributes", "skills", "hp", "backpack", "text", "counter", "dice", "list"]


class SheetBlock(BaseModel):
    """Um bloco da ficha. ``data`` é livre: cada tipo de bloco guarda ali o que precisa (texto, contador, rolagens…)."""

    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
    type: BlockType
    title: Annotated[str, StringConstraints(max_length=80)] = ""
    data: dict[str, Any] = Field(default_factory=dict)


class SheetLayout(BaseModel):
    """Organização livre da ficha: até três colunas de blocos, montadas por quem joga.

    O serviço não interpreta os blocos; só garante formato e tamanho (o item inteiro precisa caber
    com folga no limite de 400 KB do DynamoDB).
    """

    model_config = ConfigDict(extra="forbid")

    template: Annotated[str, StringConstraints(max_length=40)] | None = None
    header: dict[str, Any] = Field(default_factory=dict)
    columns: Annotated[list[list[SheetBlock]], Field(min_length=1, max_length=3)]

    @model_validator(mode="after")
    def check_limits(self) -> SheetLayout:
        blocks = [block for column in self.columns for block in column]
        if len(blocks) > SHEET_MAX_BLOCKS:
            raise ValueError(f"a ficha comporta até {SHEET_MAX_BLOCKS} blocos")
        ids = [block.id for block in blocks]
        if len(ids) != len(set(ids)):
            raise ValueError("há blocos com o mesmo id")
        if len(json.dumps(self.model_dump(), ensure_ascii=False).encode("utf-8")) > SHEET_MAX_BYTES:
            raise ValueError(f"a organização da ficha excede {SHEET_MAX_BYTES} bytes")
        return self


class HitPointsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current: Annotated[int, Field(ge=0, le=100_000)]
    max: Annotated[int, Field(ge=1, le=100_000)]

    @model_validator(mode="after")
    def check_current_not_above_max(self) -> HitPointsIn:
        if self.current > self.max:
            raise ValueError("hp.current não pode exceder hp.max")
        return self


class CharacterCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "campaignId": "c1",
                "name": "Lyra Ventobravo",
                "ownerId": "user-ana",
                "attributes": {"forca": 15, "destreza": 12},
                "skills": {"furtividade": 3},
                "hp": {"current": 22, "max": 22},
                "maxItems": 10,
            }
        },
    )

    campaignId: Id
    name: Name
    ownerId: Id | None = None
    description: Description | None = None
    attributes: dict[StatKey, StatValue] = Field(default_factory=dict)
    skills: dict[StatKey, StatValue] = Field(default_factory=dict)
    hp: HitPointsIn
    maxItems: Annotated[int, Field(ge=0, le=1000)] | None = None
    active: bool = True
    sheet: SheetLayout | None = None

    @field_validator("attributes", "skills")
    @classmethod
    def check_stat_limits(cls, value: dict) -> dict:
        return _limit_entries(value)


class CharacterPatch(BaseModel):
    """PATCH com semântica de JSON Merge Patch: em ``attributes``/``skills``, ``null`` remove a chave.

    ``campaignId`` não é alterável: mover a ficha de campanha invalidaria reservas em andamento.
    """

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    ownerId: Id | None = None
    description: Description | None = None
    attributes: dict[StatKey, StatValue | None] | None = None
    skills: dict[StatKey, StatValue | None] | None = None
    hp: HitPointsIn | None = None
    maxItems: Annotated[int, Field(ge=0, le=1000)] | None = None
    active: bool | None = None
    #: Substitui a organização inteira da ficha; null volta para a ficha padrão.
    sheet: SheetLayout | None = None

    @field_validator("attributes", "skills")
    @classmethod
    def check_stat_limits(cls, value: dict | None) -> dict | None:
        return value if value is None else _limit_entries(value)

    @model_validator(mode="after")
    def check_not_empty(self) -> CharacterPatch:
        if not self.model_fields_set:
            raise ValueError("informe ao menos um campo para alterar")
        for name in ("name", "hp", "active", "attributes", "skills", "maxItems"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} não aceita null")
        return self


class PortraitUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contentType: Annotated[str, StringConstraints(pattern=r"^image/(png|jpeg|webp)$")]


# --- Saída ---------------------------------------------------------------------------------------


class HitPointsOut(BaseModel):
    current: int
    max: int


class PortraitOut(BaseModel):
    key: str
    contentType: str
    sizeBytes: int
    uploadedAt: datetime


class CapacityOut(BaseModel):
    maxItems: int
    slotsUsed: int
    slotsAvailable: int


class CharacterOut(BaseModel):
    id: str
    campaignId: str
    name: str
    ownerId: str | None
    description: str | None
    attributes: dict[str, int]
    skills: dict[str, int]
    hp: HitPointsOut
    active: bool
    capacity: CapacityOut
    portrait: PortraitOut | None
    sheet: dict[str, Any] | None
    version: int
    createdAt: datetime
    updatedAt: datetime

    @classmethod
    def from_domain(cls, c: Character) -> CharacterOut:
        return cls(
            id=c.id,
            campaignId=c.campaign_id,
            name=c.name,
            ownerId=c.owner_id,
            description=c.description,
            attributes=c.attributes,
            skills=c.skills,
            hp=HitPointsOut(current=c.hp.current, max=c.hp.max),
            active=c.active,
            capacity=CapacityOut(maxItems=c.max_items, slotsUsed=c.slots_used, slotsAvailable=c.slots_available),
            portrait=(
                PortraitOut(
                    key=c.portrait.key,
                    contentType=c.portrait.content_type,
                    sizeBytes=c.portrait.size_bytes,
                    uploadedAt=c.portrait.uploaded_at,
                )
                if c.portrait
                else None
            ),
            sheet=c.sheet,
            version=c.version,
            createdAt=c.created_at,
            updatedAt=c.updated_at,
        )


class CharacterPageOut(BaseModel):
    items: list[CharacterOut]
    nextCursor: str | None


class HoldOut(BaseModel):
    operationId: str
    quantity: int
    status: str
    itemId: str | None
    campaignId: str | None
    tombstone: bool
    createdAt: datetime
    updatedAt: datetime

    @classmethod
    def from_domain(cls, h: CapacityHold) -> HoldOut:
        return cls(
            operationId=h.operation_id,
            quantity=h.quantity,
            status=h.status.value,
            itemId=h.item_id,
            campaignId=h.campaign_id,
            tombstone=h.tombstone,
            createdAt=h.created_at,
            updatedAt=h.updated_at,
        )


class PresignedUploadOut(BaseModel):
    uploadUrl: str
    method: str
    headers: dict[str, str]
    key: str
    expiresIn: int
    confirmUrl: str


class PortraitUrlOut(BaseModel):
    url: str
    expiresIn: int
    contentType: str
