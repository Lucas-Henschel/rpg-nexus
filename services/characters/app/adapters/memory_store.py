"""Implementação em memória das portas, com a MESMA semântica condicional do DynamoDB.

Usada nos testes unitários e no modo ``STORE_BACKEND=memory`` (desenvolvimento sem AWS). Cada
método transacional segura um único lock: todas as condições são verificadas antes de qualquer
escrita, reproduzindo o "tudo ou nada" de ``TransactWriteItems``.
"""

from __future__ import annotations

import base64
import copy
import json
import threading
from dataclasses import replace
from datetime import datetime, timedelta

from app.application.ports import (
    CharacterAlreadyExists,
    ConcurrencyConflict,
    DuplicateMessage,
    InboxRecord,
    ObjectInfo,
    OutboxRecord,
    OutboxStats,
    Page,
    PresignedRequest,
)
from app.application.read_model import CharacterSummary
from app.domain.models import CapacityHold, Character, HoldStatus


class InMemoryCharacterStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._characters: dict[str, Character] = {}
        self._holds: dict[tuple[str, str], CapacityHold] = {}
        self._inbox: dict[str, InboxRecord] = {}
        self._outbox: dict[str, OutboxRecord] = {}
        self._leases: dict[str, tuple[str, datetime]] = {}

    # --- utilitários de teste -----------------------------------------------------------------

    @property
    def outbox(self) -> list[OutboxRecord]:
        with self._lock:
            return sorted(self._outbox.values(), key=lambda r: r.created_at)

    @property
    def inbox(self) -> dict[str, InboxRecord]:
        with self._lock:
            return dict(self._inbox)

    # --- saúde --------------------------------------------------------------------------------

    def ping(self) -> None:
        return None

    # --- fichas -------------------------------------------------------------------------------

    def create_character(self, character: Character) -> None:
        with self._lock:
            if character.id in self._characters:
                raise CharacterAlreadyExists(character.id)
            self._characters[character.id] = copy.deepcopy(character)

    def get_character(self, character_id: str) -> Character | None:
        with self._lock:
            found = self._characters.get(character_id)
            return copy.deepcopy(found) if found else None

    def list_characters(self, campaign_id: str, limit: int, cursor: str | None) -> Page:
        with self._lock:
            matching = sorted(
                (c for c in self._characters.values() if c.campaign_id == campaign_id),
                key=lambda c: (c.created_at, c.id),
            )
        start = int(json.loads(base64.urlsafe_b64decode(cursor))["offset"]) if cursor else 0
        page = matching[start : start + limit]
        next_offset = start + limit
        next_cursor = (
            base64.urlsafe_b64encode(json.dumps({"offset": next_offset}).encode()).decode()
            if next_offset < len(matching)
            else None
        )
        return Page([copy.deepcopy(c) for c in page], next_cursor)

    def save_profile(self, character: Character, expected_version: int, max_items_delta: int) -> None:
        with self._lock:
            current = self._characters.get(character.id)
            if current is None or current.version != expected_version:
                raise ConcurrencyConflict("versão divergente")
            if max_items_delta < 0 and current.slots_available < -max_items_delta:
                raise ConcurrencyConflict("capacidade livre insuficiente para reduzir maxItems")
            # contadores de capacidade são preservados do estado atual (não vêm do chamador)
            self._characters[character.id] = copy.deepcopy(
                character.evolve(slots_used=current.slots_used, max_items=current.max_items + max_items_delta)
            )

    # --- reservas -----------------------------------------------------------------------------

    def get_hold(self, character_id: str, operation_id: str) -> CapacityHold | None:
        with self._lock:
            return self._holds.get((character_id, operation_id))

    def list_holds(self, character_id: str) -> list[CapacityHold]:
        with self._lock:
            return sorted((h for (cid, _), h in self._holds.items() if cid == character_id), key=lambda h: h.created_at)

    # --- inbox --------------------------------------------------------------------------------

    def get_inbox(self, message_id: str) -> InboxRecord | None:
        with self._lock:
            return self._inbox.get(message_id)

    def _check_inbox(self, inbox: InboxRecord) -> None:
        if inbox.message_id in self._inbox:
            raise DuplicateMessage(inbox.message_id)

    def _write_common(self, inbox: InboxRecord, outbox: OutboxRecord | None) -> None:
        self._inbox[inbox.message_id] = inbox
        if outbox is not None:
            self._outbox[outbox.message_id] = outbox

    # --- transações ---------------------------------------------------------------------------

    def reserve_capacity(self, inbox: InboxRecord, hold: CapacityHold, outbox: OutboxRecord) -> None:
        with self._lock:
            self._check_inbox(inbox)
            key = (hold.character_id, hold.operation_id)
            character = self._characters.get(hold.character_id)
            if key in self._holds:
                raise ConcurrencyConflict("reserva já existe")
            if (
                character is None
                or not character.active
                or character.campaign_id != hold.campaign_id
                or character.slots_available < hold.quantity
            ):
                raise ConcurrencyConflict("condição do personagem falhou")
            self._characters[character.id] = character.evolve(slots_used=character.slots_used + hold.quantity)
            self._holds[key] = hold
            self._write_common(inbox, outbox)

    def record_outcome(self, inbox: InboxRecord, outbox: OutboxRecord | None) -> None:
        with self._lock:
            self._check_inbox(inbox)
            self._write_common(inbox, outbox)

    def commit_hold(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        with self._lock:
            self._check_inbox(inbox)
            key = (hold.character_id, hold.operation_id)
            current = self._holds.get(key)
            if current is None or current.status is not HoldStatus.HELD:
                raise ConcurrencyConflict("reserva não está HELD")
            self._holds[key] = hold.evolve(status=HoldStatus.COMMITTED)
            self._write_common(inbox, None)

    def release_hold(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        with self._lock:
            self._check_inbox(inbox)
            key = (hold.character_id, hold.operation_id)
            current = self._holds.get(key)
            character = self._characters.get(hold.character_id)
            if current is None or current.status is not HoldStatus.HELD or character is None:
                raise ConcurrencyConflict("reserva não está HELD")
            self._characters[character.id] = character.evolve(slots_used=character.slots_used - current.quantity)
            self._holds[key] = hold.evolve(status=HoldStatus.RELEASED)
            self._write_common(inbox, None)

    def create_tombstone(self, inbox: InboxRecord, hold: CapacityHold) -> None:
        with self._lock:
            self._check_inbox(inbox)
            key = (hold.character_id, hold.operation_id)
            if key in self._holds:
                raise ConcurrencyConflict("reserva já existe")
            self._holds[key] = hold
            self._write_common(inbox, None)

    # --- outbox -------------------------------------------------------------------------------

    def claim_outbox(self, limit: int, lease_seconds: int, owner: str, now: datetime) -> list[OutboxRecord]:
        claimed: list[OutboxRecord] = []
        with self._lock:
            for record in sorted(self._outbox.values(), key=lambda r: r.created_at):
                if len(claimed) >= limit:
                    break
                if record.status != "PENDING":
                    continue
                lease = self._leases.get(record.message_id)
                if lease and lease[1] > now:
                    continue
                self._leases[record.message_id] = (owner, now + timedelta(seconds=lease_seconds))
                updated = replace(record, attempts=record.attempts + 1)
                self._outbox[record.message_id] = updated
                claimed.append(updated)
        return claimed

    def mark_outbox_published(self, message_id: str, owner: str, now: datetime) -> None:
        with self._lock:
            lease = self._leases.get(message_id)
            record = self._outbox.get(message_id)
            if record is None or lease is None or lease[0] != owner:
                return
            self._outbox[message_id] = replace(record, status="PUBLISHED", published_at=now)
            self._leases.pop(message_id, None)

    def release_outbox_claim(self, message_id: str, owner: str) -> None:
        with self._lock:
            lease = self._leases.get(message_id)
            if lease and lease[0] == owner:
                self._leases.pop(message_id, None)

    def outbox_stats(self) -> OutboxStats:
        with self._lock:
            pending = [r for r in self._outbox.values() if r.status == "PENDING"]
            published = sum(1 for r in self._outbox.values() if r.status == "PUBLISHED")
        oldest = min((r.created_at for r in pending), default=None)
        return OutboxStats(pending=len(pending), oldest_pending_at=oldest, extra={"published": published})


class InMemoryReadModel:
    """Modelo de leitura (CQRS) em memória; mesma regra do DynamoDB: projeção mais antiga não sobrescreve."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._summaries: dict[tuple[str, str], CharacterSummary] = {}

    def ping(self) -> None:
        return None

    def put_summary(self, summary: CharacterSummary) -> bool:
        key = (summary.campaign_id, summary.character_id)
        with self._lock:
            current = self._summaries.get(key)
            if current is not None and current.projected_at > summary.projected_at:
                return False
            self._summaries[key] = summary
            return True

    def list_campaign(self, campaign_id: str) -> list[CharacterSummary]:
        with self._lock:
            return [s for (campaign, _), s in self._summaries.items() if campaign == campaign_id]


class InMemoryObjectStorage:
    def __init__(self, public_base_url: str = "http://localhost:8000/_memory-s3") -> None:
        self._lock = threading.Lock()
        self._objects: dict[str, tuple[bytes, str]] = {}
        self._base = public_base_url.rstrip("/")

    def ping(self) -> None:
        return None

    def presign_upload(self, key: str, content_type: str, expires_in: int) -> PresignedRequest:
        return PresignedRequest(
            f"{self._base}/{key}?expires={expires_in}", "PUT", {"Content-Type": content_type}, expires_in, key
        )

    def presign_download(self, key: str, expires_in: int) -> str:
        return f"{self._base}/{key}?expires={expires_in}"

    def put(self, key: str, data: bytes, content_type: str) -> None:
        with self._lock:
            self._objects[key] = (bytes(data), content_type)

    def head(self, key: str) -> ObjectInfo | None:
        with self._lock:
            found = self._objects.get(key)
        return ObjectInfo(key, len(found[0]), found[1]) if found else None

    def read_prefix(self, key: str, length: int) -> bytes:
        with self._lock:
            return self._objects[key][0][:length]

    def get(self, key: str) -> tuple[bytes, str]:
        with self._lock:
            return self._objects[key]

    def delete(self, key: str) -> None:
        with self._lock:
            self._objects.pop(key, None)
