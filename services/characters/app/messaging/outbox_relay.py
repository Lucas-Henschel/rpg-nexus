"""Relay da outbox transacional: lê eventos PENDING do DynamoDB e publica no RabbitMQ.

1. reivindica um lote com *lease* (várias réplicas podem rodar o relay sem publicar o mesmo evento
   em paralelo);
2. publica com publisher confirms;
3. marca PUBLISHED.

Se o processo cair entre (2) e (3), o lease expira e o evento é publicado de novo: entrega
*at-least-once*. O consumidor deduplica pelo messageId (inbox). Se o broker estiver fora (F6), os
eventos simplesmente acumulam como PENDING e escoam quando a conexão volta — nada se perde.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import uuid
from typing import Protocol

from app.application.ports import CharacterStore, OutboxRecord
from app.clock import Clock, utcnow
from app.logging_setup import log_context

log = logging.getLogger(__name__)


class Publisher(Protocol):
    @property
    def is_connected(self) -> bool: ...

    async def wait_connected(self, timeout: float) -> bool: ...

    async def publish(self, record: OutboxRecord) -> None: ...


class OutboxRelay:
    def __init__(
        self,
        store: CharacterStore,
        publisher: Publisher,
        *,
        batch_size: int = 25,
        poll_interval_ms: int = 500,
        lease_seconds: int = 30,
        clock: Clock = utcnow,
    ) -> None:
        self._store = store
        self._publisher = publisher
        self._batch = batch_size
        self._interval = poll_interval_ms / 1000
        self._lease = lease_seconds
        self._clock = clock
        self._owner = f"{socket.gethostname()}:{uuid.uuid4().hex[:8]}"
        self._wake = asyncio.Event()
        self._stopping = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self.published = 0

    def notify(self) -> None:
        """Chamado (de qualquer thread) após gravar na outbox: publica já, sem esperar o próximo ciclo."""
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._wake.set)

    async def stop(self) -> None:
        self._stopping.set()
        self._wake.set()

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        log.info("outbox.relay_started", extra={"owner": self._owner})
        while not self._stopping.is_set():
            if not self._publisher.is_connected:
                await self._publisher.wait_connected(timeout=self._interval * 4)
                continue
            try:
                drained = await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — banco instável: tenta no próximo ciclo
                log.warning("outbox.cycle_failed", extra={"error": f"{type(exc).__name__}: {exc}"})
                drained = 0
            if drained >= self._batch:
                continue  # ainda há fila: segue sem dormir
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self._interval)
            except TimeoutError:
                pass

    async def run_once(self) -> int:
        records = await asyncio.to_thread(self._store.claim_outbox, self._batch, self._lease, self._owner, self._clock())
        for record in records:
            with log_context(correlationId=record.correlation_id, messageId=record.message_id, eventType=record.type):
                try:
                    await self._publisher.publish(record)
                except Exception as exc:  # noqa: BLE001
                    log.warning(
                        "outbox.publish_failed", extra={"error": f"{type(exc).__name__}: {exc}", "attempts": record.attempts}
                    )
                    await asyncio.to_thread(self._store.release_outbox_claim, record.message_id, self._owner)
                    for pending in records[records.index(record) + 1 :]:
                        await asyncio.to_thread(self._store.release_outbox_claim, pending.message_id, self._owner)
                    return 0
                await asyncio.to_thread(self._store.mark_outbox_published, record.message_id, self._owner, self._clock())
                self.published += 1
                log.info("outbox.published", extra={"routingKey": record.routing_key, "attempts": record.attempts})
        return len(records)
