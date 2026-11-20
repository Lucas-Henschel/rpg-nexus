"""Casos de uso HTTP: CRUD de fichas, dinheiro, criação a partir de modelo e retratos no S3.

Quem pode mexer numa ficha: só o dono (``owner_id`` = ``sub`` do token do S4). Os métodos recebem
``user_id``; com ``None`` (chamada interna, ou autenticação desligada em desenvolvimento) não há checagem.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable

from app.clock import Clock, utcnow
from app.domain.errors import (
    CharacterNotFound,
    DependencyUnavailable,
    DomainError,
    IdempotencyKeyReused,
    InsufficientFunds,
    InvalidPortrait,
    NotCharacterOwner,
    PortraitNotFound,
    VersionConflict,
)
from app.domain.models import CapacityHold, Character, CharacterTemplate, HitPoints, MoneyEntry, Portrait
from app.domain.rules import ensure_max_items_change_allowed, merge_stat_map

from .dto import CharacterCreate, CharacterFromTemplate, CharacterPatch
from .ports import (
    AdjustmentAlreadyApplied,
    CharacterAlreadyExists,
    CharacterStore,
    ConcurrencyConflict,
    ObjectStorage,
    Page,
    PresignedRequest,
)

log = logging.getLogger(__name__)

#: Namespace fixo para derivar IDs determinísticos a partir da Idempotency-Key (UUIDv5).
IDEMPOTENCY_NAMESPACE = uuid.UUID("6c1d6f0e-9d0b-4b8e-9a3e-6f2f1f6b2a10")

ALLOWED_PORTRAIT_TYPES = ("image/png", "image/jpeg", "image/webp")


def detect_image_type(head: bytes) -> str | None:
    """Confere a assinatura binária (magic bytes); não confia só no Content-Type declarado."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


class OwnerImmutable(DomainError):
    code = "OWNER_IMMUTABLE"
    http_status = 422

    def __init__(self) -> None:
        super().__init__("o dono da ficha é quem a criou; ele não muda por aqui")


class CharacterService:
    MAX_OPTIMISTIC_RETRIES = 5

    def __init__(
        self,
        store: CharacterStore,
        storage: ObjectStorage | None,
        *,
        default_max_items: int = 10,
        portrait_prefix: str = "characters/",
        portrait_max_bytes: int = 2 * 1024 * 1024,
        presign_expires_seconds: int = 300,
        clock: Clock = utcnow,
        id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
        on_change: Callable[[str], None] | None = None,
    ) -> None:
        self._store = store
        self._storage = storage
        self._default_max_items = default_max_items
        self._prefix = portrait_prefix if portrait_prefix.endswith("/") else portrait_prefix + "/"
        self._portrait_max_bytes = portrait_max_bytes
        self._presign_expires = presign_expires_seconds
        self._clock = clock
        self._new_id = id_factory
        #: Avisado depois de cada escrita confirmada; é por aqui que o modelo de leitura (CQRS) é atualizado.
        self._changed = on_change or (lambda _character_id: None)

    # --- Fichas ------------------------------------------------------------------------------

    def create(
        self, data: CharacterCreate, idempotency_key: str | None = None, *, user_id: str | None = None
    ) -> tuple[Character, bool]:
        """Cria a ficha. Com Idempotency-Key, o ID é derivado da chave: repetir a requisição devolve a mesma ficha."""
        if user_id is not None and data.ownerId not in (None, user_id):
            raise OwnerImmutable()
        owner_id = user_id if user_id is not None else data.ownerId
        now = self._clock()
        character = Character(
            id=self._character_id(idempotency_key, owner_id),
            campaign_id=data.campaignId,
            name=data.name,
            owner_id=owner_id,
            description=data.description,
            sheet=data.sheet.model_dump() if data.sheet else None,
            attributes=dict(data.attributes),
            skills=dict(data.skills),
            hp=HitPoints(current=data.hp.current, max=data.hp.max),
            max_items=self._default_max_items if data.maxItems is None else data.maxItems,
            slots_used=0,
            active=data.active,
            version=1,
            created_at=now,
            updated_at=now,
            currency_name=data.currency.name if data.currency else "Moedas",
            currency_amount=data.currency.amount if data.currency else 0,
        )
        return self._insert(character, idempotency_key)

    def create_from_template(
        self,
        data: CharacterFromTemplate,
        template: CharacterTemplate,
        idempotency_key: str | None = None,
        *,
        user_id: str | None = None,
    ) -> tuple[Character, bool]:
        """Cria a ficha copiando a versão do modelo. A cópia é fixa: editar o modelo depois não muda esta ficha."""
        owner_id = user_id if user_id is not None else template.owner_id
        d = template.definition
        now = self._clock()
        character = Character(
            id=self._character_id(idempotency_key, owner_id),
            campaign_id=data.campaignId,
            name=data.name,
            owner_id=owner_id,
            description=None,
            sheet=d.sheet,
            attributes=dict(d.attributes),
            skills=dict(d.skills),
            hp=HitPoints(current=d.hp_max, max=d.hp_max),
            max_items=d.max_items,
            slots_used=0,
            active=True,
            version=1,
            created_at=now,
            updated_at=now,
            currency_name=d.currency_name,
            currency_amount=d.currency_amount,
            source_template_id=template.id,
            source_template_version=template.version,
        )
        return self._insert(character, idempotency_key)

    def _character_id(self, idempotency_key: str | None, owner_id: str | None) -> str:
        if not idempotency_key:
            return self._new_id()
        # a chave é por usuário: duas pessoas usando a mesma chave não colidem
        scoped = f"{owner_id}:{idempotency_key}" if owner_id else idempotency_key
        return str(uuid.uuid5(IDEMPOTENCY_NAMESPACE, scoped))

    def _insert(self, character: Character, idempotency_key: str | None) -> tuple[Character, bool]:
        character_id = character.id
        try:
            self._store.create_character(character)
        except CharacterAlreadyExists:
            if not idempotency_key:
                raise
            existing = self.get(character_id)
            same = (existing.campaign_id, existing.name, existing.owner_id, existing.source_template_id) == (
                character.campaign_id,
                character.name,
                character.owner_id,
                character.source_template_id,
            )
            if not same:
                raise IdempotencyKeyReused() from None
            log.info("character.create.idempotent_replay", extra={"characterId": character_id})
            return existing, False
        log.info("character.created", extra={"characterId": character_id, "campaignId": character.campaign_id})
        self._changed(character_id)
        return character, True

    def get(self, character_id: str, *, user_id: str | None = None) -> Character:
        character = self._store.get_character(character_id)
        if character is None:
            raise CharacterNotFound(character_id)
        if user_id is not None and character.owner_id != user_id:
            # fichas criadas antes do login não têm dono e ficam inacessíveis pela API
            raise NotCharacterOwner(character_id)
        return character

    def list_by_campaign(
        self, campaign_id: str, limit: int = 50, cursor: str | None = None, *, user_id: str | None = None
    ) -> Page:
        """Fichas da campanha; com ``user_id``, só as do usuário."""
        return self._store.list_characters(campaign_id, limit, cursor, owner_id=user_id)

    def update(
        self,
        character_id: str,
        patch: CharacterPatch,
        expected_version: int | None = None,
        *,
        user_id: str | None = None,
    ) -> Character:
        """Atualização com concorrência otimista.

        Com ``If-Match`` (expected_version) o cliente recebe 409 se outra edição venceu. Sem ele,
        o serviço relê e reaplica o patch automaticamente (última escrita vence campo a campo).
        """
        if user_id is not None and "ownerId" in patch.model_fields_set and patch.ownerId != user_id:
            raise OwnerImmutable()
        for _ in range(self.MAX_OPTIMISTIC_RETRIES):
            current = self.get(character_id, user_id=user_id)
            if expected_version is not None and current.version != expected_version:
                raise VersionConflict(expected_version, current.version)
            updated, delta = self._apply_patch(current, patch)
            try:
                self._store.save_profile(updated, current.version, delta)
            except ConcurrencyConflict:
                continue  # versão mudou ou reserva concorrente consumiu capacidade: reavaliar
            log.info("character.updated", extra={"characterId": character_id, "version": updated.version})
            self._changed(character_id)
            return self.get(character_id)
        latest = self.get(character_id)
        raise VersionConflict(expected_version or latest.version, latest.version)

    def holds(self, character_id: str, *, user_id: str | None = None) -> list[CapacityHold]:
        self.get(character_id, user_id=user_id)
        return self._store.list_holds(character_id)

    # --- Dinheiro --------------------------------------------------------------------------------

    def money_entries(self, character_id: str, *, user_id: str | None = None) -> list[MoneyEntry]:
        self.get(character_id, user_id=user_id)
        return self._store.list_money_entries(character_id)

    def adjust_money(
        self,
        character_id: str,
        delta: int,
        reason: str,
        idempotency_key: str | None = None,
        *,
        user_id: str | None = None,
    ) -> Character:
        """Ajuste manual do saldo pelo dono da ficha (ex.: o mestre deu moedas). Nunca deixa o saldo negativo.

        Com Idempotency-Key, repetir a requisição não ajusta de novo.
        """
        current = self.get(character_id, user_id=user_id)
        now = self._clock()
        entry = MoneyEntry(
            operation_id=f"ADJ-{idempotency_key}" if idempotency_key else f"ADJ-{self._new_id()}",
            character_id=character_id,
            kind="ADJUSTMENT",
            amount=delta,
            status=None,
            user_id=user_id,
            campaign_id=current.campaign_id,
            reason=reason or None,
            created_at=now,
            updated_at=now,
        )
        try:
            self._store.adjust_money(entry)
        except AdjustmentAlreadyApplied:
            log.info("money.adjust.idempotent_replay", extra={"characterId": character_id})
            return self.get(character_id)
        except ConcurrencyConflict:
            raise InsufficientFunds(self.get(character_id).currency_amount, delta) from None
        log.info("money.adjusted", extra={"characterId": character_id, "delta": delta})
        self._changed(character_id)
        return self.get(character_id)

    def _apply_patch(self, current: Character, patch: CharacterPatch) -> tuple[Character, int]:
        fields = patch.model_fields_set
        changes: dict[str, object] = {}
        delta = 0
        if "name" in fields:
            changes["name"] = patch.name
        if "ownerId" in fields:
            changes["owner_id"] = patch.ownerId
        if "description" in fields:
            changes["description"] = patch.description
        if "sheet" in fields:
            changes["sheet"] = patch.sheet.model_dump() if patch.sheet else None
        if "active" in fields:
            changes["active"] = patch.active
        if "currencyName" in fields and patch.currencyName is not None:
            changes["currency_name"] = patch.currencyName
        if "hp" in fields and patch.hp is not None:
            changes["hp"] = HitPoints(current=patch.hp.current, max=patch.hp.max)
        if "attributes" in fields and patch.attributes is not None:
            changes["attributes"] = merge_stat_map(current.attributes, patch.attributes)
        if "skills" in fields and patch.skills is not None:
            changes["skills"] = merge_stat_map(current.skills, patch.skills)
        if "maxItems" in fields and patch.maxItems is not None:
            ensure_max_items_change_allowed(current, patch.maxItems)
            delta = patch.maxItems - current.max_items
            changes["max_items"] = patch.maxItems
        changes["version"] = current.version + 1
        changes["updated_at"] = self._clock()
        return current.evolve(**changes), delta

    # --- Retratos (S3) -------------------------------------------------------------------------

    def portrait_key(self, character_id: str) -> str:
        return f"{self._prefix}{character_id}/portrait"

    def request_portrait_upload(self, character_id: str, content_type: str, *, user_id: str | None = None) -> PresignedRequest:
        self.get(character_id, user_id=user_id)
        storage = self._require_storage()
        return storage.presign_upload(self.portrait_key(character_id), content_type, self._presign_expires)

    def confirm_portrait(self, character_id: str, *, user_id: str | None = None) -> Character:
        """Depois do upload direto ao S3 (URL pré-assinada), o S2 confere o objeto e grava a referência."""
        self.get(character_id, user_id=user_id)
        storage = self._require_storage()
        key = self.portrait_key(character_id)
        info = storage.head(key)
        if info is None:
            raise PortraitNotFound("nenhum upload encontrado para este personagem", key=key)
        try:
            self._check_portrait(storage.read_prefix(key, 16), info.size, info.content_type)
        except InvalidPortrait:
            storage.delete(key)
            raise
        return self._set_portrait(character_id, Portrait(key, info.content_type, info.size, self._clock()))

    def upload_portrait(self, character_id: str, data: bytes, content_type: str, *, user_id: str | None = None) -> Character:
        """Upload passando pelo backend — alternativa quando a URL pré-assinada não é acessível pelo navegador."""
        self.get(character_id, user_id=user_id)
        storage = self._require_storage()
        content_type = (content_type or "").split(";")[0].strip().lower()
        self._check_portrait(data[:16], len(data), content_type)
        key = self.portrait_key(character_id)
        storage.put(key, data, content_type)
        return self._set_portrait(character_id, Portrait(key, content_type, len(data), self._clock()))

    def portrait_download_url(self, character_id: str, *, user_id: str | None = None) -> tuple[str, str]:
        character = self.get(character_id, user_id=user_id)
        if character.portrait is None:
            raise PortraitNotFound("personagem não possui retrato")
        url = self._require_storage().presign_download(character.portrait.key, self._presign_expires)
        return url, character.portrait.content_type

    def portrait_content(self, character_id: str) -> tuple[bytes, str]:
        character = self.get(character_id)
        if character.portrait is None:
            raise PortraitNotFound("personagem não possui retrato")
        return self._require_storage().get(character.portrait.key)

    @property
    def presign_expires_seconds(self) -> int:
        return self._presign_expires

    def _check_portrait(self, head: bytes, size: int, content_type: str) -> None:
        if content_type not in ALLOWED_PORTRAIT_TYPES:
            raise InvalidPortrait(f"tipo {content_type!r} não permitido", allowed=list(ALLOWED_PORTRAIT_TYPES))
        if size <= 0:
            raise InvalidPortrait("arquivo vazio")
        if size > self._portrait_max_bytes:
            raise InvalidPortrait(f"arquivo excede {self._portrait_max_bytes} bytes", sizeBytes=size)
        detected = detect_image_type(head)
        if detected != content_type:
            raise InvalidPortrait("conteúdo não corresponde ao tipo declarado", declared=content_type, detected=detected)

    def _set_portrait(self, character_id: str, portrait: Portrait) -> Character:
        for _ in range(self.MAX_OPTIMISTIC_RETRIES):
            current = self.get(character_id)
            updated = current.evolve(portrait=portrait, version=current.version + 1, updated_at=self._clock())
            try:
                self._store.save_profile(updated, current.version, 0)
            except ConcurrencyConflict:
                continue
            log.info("character.portrait_saved", extra={"characterId": character_id, "key": portrait.key})
            self._changed(character_id)
            return self.get(character_id)
        raise DependencyUnavailable("não foi possível registrar o retrato após várias tentativas")

    def _require_storage(self) -> ObjectStorage:
        if self._storage is None:
            raise DependencyUnavailable("armazenamento de objetos não configurado")
        return self._storage
