"""DTOs de entrada/saída da API (Pydantic puro, sem FastAPI — testáveis isoladamente).

Os nomes dos campos seguem camelCase, como nos contratos JSON do grupo.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.application.read_model import CharacterSummary
from app.domain.models import CapacityHold, Character, CharacterTemplate, MoneyEntry

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


CurrencyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
MAX_MONEY = 1_000_000


class CurrencyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CurrencyName = "Moedas"
    amount: Annotated[int, Field(ge=0, le=MAX_MONEY)] = 0


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
    #: Saldo inicial. Depois de criada, o saldo só muda por ajuste (/money/adjustments) ou compra.
    currency: CurrencyIn | None = None

    @field_validator("attributes", "skills")
    @classmethod
    def check_stat_limits(cls, value: dict) -> dict:
        return _limit_entries(value)


class CharacterFromTemplate(BaseModel):
    """Ficha nova copiando um modelo. O resto (atributos, blocos, vida, mochila, dinheiro) vem dele."""

    model_config = ConfigDict(extra="forbid")

    campaignId: Id
    name: Name
    #: Versão do modelo a copiar; sem ela, a atual.
    version: Annotated[int, Field(ge=1)] | None = None


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
    #: Só o nome da moeda. O saldo muda por /money/adjustments ou pela compra na loja, nunca por PATCH:
    #: um PATCH com a ficha antiga desfaria um débito feito nesse meio-tempo.
    currencyName: CurrencyName | None = None

    @field_validator("attributes", "skills")
    @classmethod
    def check_stat_limits(cls, value: dict | None) -> dict | None:
        return value if value is None else _limit_entries(value)

    @model_validator(mode="after")
    def check_not_empty(self) -> CharacterPatch:
        if not self.model_fields_set:
            raise ValueError("informe ao menos um campo para alterar")
        for name in ("name", "hp", "active", "attributes", "skills", "maxItems", "currencyName"):
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


class CurrencyOut(BaseModel):
    name: str
    amount: int


class SourceTemplateOut(BaseModel):
    templateId: str
    version: int


class AccessOut(BaseModel):
    """O que quem fez a requisição pode fazer nesta ficha (o front mostra ou esconde as ações)."""

    edit: bool
    adjustMoney: bool


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
    currency: CurrencyOut
    #: Modelo e versão de onde a ficha foi copiada; null se foi criada sem modelo.
    sourceTemplate: SourceTemplateOut | None
    createdAt: datetime
    updatedAt: datetime
    access: AccessOut | None = None

    @classmethod
    def from_domain(cls, c: Character, access: dict[str, bool] | None = None) -> CharacterOut:
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
            currency=CurrencyOut(name=c.currency_name, amount=c.currency_amount),
            sourceTemplate=(
                SourceTemplateOut(templateId=c.source_template_id, version=c.source_template_version)
                if c.source_template_id and c.source_template_version
                else None
            ),
            createdAt=c.created_at,
            updatedAt=c.updated_at,
            access=AccessOut(**access) if access is not None else None,
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


# --- Modelo de leitura (CQRS) ---------------------------------------------------------------------


class CharacterSummaryOut(BaseModel):
    characterId: str
    name: str
    active: bool
    hp: dict[str, int]
    capacity: dict[str, int]
    holds: dict[str, int]
    hasPortrait: bool
    profileVersion: int
    updatedAt: datetime
    projectedAt: datetime

    @classmethod
    def from_summary(cls, s: CharacterSummary) -> CharacterSummaryOut:
        return cls(
            characterId=s.character_id,
            name=s.name,
            active=s.active,
            hp={"current": s.hp_current, "max": s.hp_max},
            capacity={"maxItems": s.max_items, "slotsUsed": s.slots_used, "slotsAvailable": s.slots_available},
            holds={"held": s.holds_held, "committed": s.holds_committed, "released": s.holds_released},
            hasPortrait=s.has_portrait,
            profileVersion=s.profile_version,
            updatedAt=s.updated_at,
            projectedAt=s.projected_at,
        )


class RosterOut(BaseModel):
    """Painel da campanha, lido do modelo de leitura (consistência eventual em relação à escrita)."""

    campaignId: str
    source: str = "read-model"
    totals: dict[str, int]
    items: list[CharacterSummaryOut]


# --- Dinheiro ------------------------------------------------------------------------------------


class MoneyAdjustmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Positivo credita, negativo debita. O saldo nunca fica negativo.
    delta: Annotated[int, Field(ge=-MAX_MONEY, le=MAX_MONEY)]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""

    @field_validator("delta")
    @classmethod
    def check_not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("delta não pode ser 0")
        return value


class MoneyEntryOut(BaseModel):
    operationId: str
    kind: str
    amount: int
    status: str | None
    campaignId: str | None
    reason: str | None
    tombstone: bool
    createdAt: datetime
    updatedAt: datetime

    @classmethod
    def from_domain(cls, m: MoneyEntry) -> MoneyEntryOut:
        return cls(
            operationId=m.operation_id,
            kind=m.kind,
            amount=m.amount,
            status=m.status.value if m.status else None,
            campaignId=m.campaign_id,
            reason=m.reason,
            tombstone=m.tombstone,
            createdAt=m.created_at,
            updatedAt=m.updated_at,
        )


# --- Modelos de ficha ----------------------------------------------------------------------------


class TemplateInitialValues(BaseModel):
    """Valores com que uma ficha nova começa. Vida atual, retrato e anotações não entram no modelo."""

    model_config = ConfigDict(extra="forbid")

    attributes: dict[StatKey, StatValue] = Field(default_factory=dict)
    skills: dict[StatKey, StatValue] = Field(default_factory=dict)
    hpMax: Annotated[int, Field(ge=1, le=100_000)] = 10
    maxItems: Annotated[int, Field(ge=0, le=1000)] = 10
    currency: CurrencyIn = Field(default_factory=CurrencyIn)

    @field_validator("attributes", "skills")
    @classmethod
    def check_stat_limits(cls, value: dict) -> dict:
        return _limit_entries(value)


class TemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: Description | None = None
    #: Organização da ficha. Conteúdo pessoal dos blocos (anotações, listas) é descartado pelo serviço.
    sheetDefinition: SheetLayout | None = None
    initialValues: TemplateInitialValues = Field(default_factory=TemplateInitialValues)


class TemplatePatch(BaseModel):
    """Cada PATCH grava uma versão nova; os campos enviados substituem os da versão atual."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: Description | None = None
    sheetDefinition: SheetLayout | None = None
    initialValues: TemplateInitialValues | None = None

    @model_validator(mode="after")
    def check_not_empty(self) -> TemplatePatch:
        if not self.model_fields_set:
            raise ValueError("informe ao menos um campo para alterar")
        for name in ("name", "initialValues"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} não aceita null")
        return self


class TemplateOut(BaseModel):
    templateId: str
    ownerId: str
    name: str
    description: str | None
    version: int
    visibility: str
    sheetDefinition: dict[str, Any] | None
    initialValues: dict[str, Any]
    createdAt: datetime
    updatedAt: datetime

    @classmethod
    def from_domain(cls, t: CharacterTemplate) -> TemplateOut:
        d = t.definition
        return cls(
            templateId=t.id,
            ownerId=t.owner_id,
            name=t.name,
            description=t.description,
            version=t.version,
            visibility=t.visibility,
            sheetDefinition=d.sheet,
            initialValues={
                "attributes": d.attributes,
                "skills": d.skills,
                "hpMax": d.hp_max,
                "maxItems": d.max_items,
                "currency": {"name": d.currency_name, "amount": d.currency_amount},
            },
            createdAt=t.created_at,
            updatedAt=t.updated_at,
        )
