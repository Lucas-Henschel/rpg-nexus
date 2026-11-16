"""Casos de uso HTTP: CRUD de fichas e retratos no S3."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable

from app.clock import Clock, utcnow
from app.domain.errors import (
    CharacterNotFound,
    DependencyUnavailable,
    IdempotencyKeyReused,
    InvalidPortrait,
    PortraitNotFound,
    VersionConflict,
)
from app.domain.models import CapacityHold, Character, HitPoints, Portrait
from app.domain.rules import ensure_max_items_change_allowed, merge_stat_map

from .dto import CharacterCreate, CharacterPatch
from .ports import CharacterAlreadyExists, CharacterStore, ConcurrencyConflict, ObjectStorage, Page, PresignedRequest

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

    def create(self, data: CharacterCreate, idempotency_key: str | None = None) -> tuple[Character, bool]:
        """Cria a ficha. Com Idempotency-Key, o ID é derivado da chave: repetir a requisição devolve a mesma ficha."""
        now = self._clock()
        character_id = str(uuid.uuid5(IDEMPOTENCY_NAMESPACE, idempotency_key)) if idempotency_key else self._new_id()
        character = Character(
            id=character_id,
            campaign_id=data.campaignId,
            name=data.name,
            owner_id=data.ownerId,
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
        )
        try:
            self._store.create_character(character)
        except CharacterAlreadyExists:
            if not idempotency_key:
                raise
            existing = self.get(character_id)
            if (existing.campaign_id, existing.name, existing.owner_id) != (data.campaignId, data.name, data.ownerId):
                raise IdempotencyKeyReused() from None
            log.info("character.create.idempotent_replay", extra={"characterId": character_id})
            return existing, False
        log.info("character.created", extra={"characterId": character_id, "campaignId": data.campaignId})
        self._changed(character_id)
        return character, True

    def get(self, character_id: str) -> Character:
        character = self._store.get_character(character_id)
        if character is None:
            raise CharacterNotFound(character_id)
        return character

    def list_by_campaign(self, campaign_id: str, limit: int = 50, cursor: str | None = None) -> Page:
        return self._store.list_characters(campaign_id, limit, cursor)

    def update(self, character_id: str, patch: CharacterPatch, expected_version: int | None = None) -> Character:
        """Atualização com concorrência otimista.

        Com ``If-Match`` (expected_version) o cliente recebe 409 se outra edição venceu. Sem ele,
        o serviço relê e reaplica o patch automaticamente (última escrita vence campo a campo).
        """
        for _ in range(self.MAX_OPTIMISTIC_RETRIES):
            current = self.get(character_id)
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

    def holds(self, character_id: str) -> list[CapacityHold]:
        self.get(character_id)
        return self._store.list_holds(character_id)

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

    def request_portrait_upload(self, character_id: str, content_type: str) -> PresignedRequest:
        self.get(character_id)
        storage = self._require_storage()
        return storage.presign_upload(self.portrait_key(character_id), content_type, self._presign_expires)

    def confirm_portrait(self, character_id: str) -> Character:
        """Depois do upload direto ao S3 (URL pré-assinada), o S2 confere o objeto e grava a referência."""
        self.get(character_id)
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

    def upload_portrait(self, character_id: str, data: bytes, content_type: str) -> Character:
        """Upload passando pelo backend — alternativa quando a URL pré-assinada não é acessível pelo navegador."""
        self.get(character_id)
        storage = self._require_storage()
        content_type = (content_type or "").split(";")[0].strip().lower()
        self._check_portrait(data[:16], len(data), content_type)
        key = self.portrait_key(character_id)
        storage.put(key, data, content_type)
        return self._set_portrait(character_id, Portrait(key, content_type, len(data), self._clock()))

    def portrait_download_url(self, character_id: str) -> tuple[str, str]:
        character = self.get(character_id)
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
