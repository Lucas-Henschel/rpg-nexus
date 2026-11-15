"""Utilitários assíncronos de RabbitMQ compartilhados pelos scripts de demonstração."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import aio_pika
from aio_pika import DeliveryMode, Message

from app.messaging.envelope import build_envelope
from app.messaging.events import ACQUISITION_CANCELLED, CHARACTER_VALIDATION_REQUESTED, ITEM_ACQUIRED, EventSpec

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
EXCHANGE = os.getenv("RABBITMQ_EXCHANGE", "rpg.events")


def validation_request(
    character_id: str, campaign_id: str, operation_id: str | None = None, deadline_seconds: int | None = None
) -> dict[str, Any]:
    op = operation_id or str(uuid.uuid4())
    payload: dict[str, Any] = {
        "operationId": op,
        "campaignId": campaign_id,
        "characterId": character_id,
        "itemId": "demo-sword",
        "quantity": 1,
    }
    if deadline_seconds is not None:
        payload["deadlineAt"] = (datetime.now(UTC) + timedelta(seconds=deadline_seconds)).isoformat().replace("+00:00", "Z")
    return _envelope(CHARACTER_VALIDATION_REQUESTED, op, payload)


def outcome(kind: str, character_id: str, operation_id: str) -> dict[str, Any]:
    spec = ITEM_ACQUIRED if kind == "acquired" else ACQUISITION_CANCELLED
    payload = {"operationId": operation_id, "characterId": character_id, "itemId": "demo-sword", "quantity": 1}
    return _envelope(spec, operation_id, payload)


def _envelope(spec: EventSpec, correlation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return build_envelope(
        event_type=spec.type, version=spec.version, correlation_id=correlation_id, payload=payload, occurred_at=datetime.now(UTC)
    )


def routing_key_for(envelope: dict[str, Any]) -> str:
    for spec in (CHARACTER_VALIDATION_REQUESTED, ITEM_ACQUIRED, ACQUISITION_CANCELLED):
        if envelope.get("type") == spec.type:
            return spec.routing_key
    return CHARACTER_VALIDATION_REQUESTED.routing_key


async def publish(bodies: list[bytes | dict[str, Any]], routing_key: str | None = None) -> None:
    connection = await aio_pika.connect(RABBITMQ_URL, timeout=10)
    async with connection:
        channel = await connection.channel(publisher_confirms=True)
        exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True, passive=True)
        for body in bodies:
            if isinstance(body, dict):
                raw = json.dumps(body).encode()
                key = routing_key or routing_key_for(body)
                message_id, msg_type = body.get("messageId"), body.get("type")
            else:
                raw, key, message_id, msg_type = body, routing_key or CHARACTER_VALIDATION_REQUESTED.routing_key, None, None
            await exchange.publish(
                Message(
                    raw,
                    content_type="application/json",
                    delivery_mode=DeliveryMode.PERSISTENT,
                    message_id=message_id,
                    type=msg_type,
                ),
                routing_key=key,
            )


class EventListener:
    """Fila exclusiva e temporária ligada às routing keys de interesse (não interfere nas filas reais)."""

    def __init__(self, routing_keys: list[str]) -> None:
        self._keys = routing_keys
        self.events: list[dict[str, Any]] = []
        self._connection: aio_pika.abc.AbstractConnection | None = None
        self._arrived = asyncio.Event()

    async def __aenter__(self) -> EventListener:
        connection = await aio_pika.connect(RABBITMQ_URL, timeout=10)
        self._connection = connection
        channel = await connection.channel()
        queue = await channel.declare_queue("", exclusive=True, auto_delete=True)
        for key in self._keys:
            await queue.bind(EXCHANGE, routing_key=key)
        await queue.consume(self._on_message, no_ack=True)
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._connection:
            await self._connection.close()

    async def _on_message(self, message: aio_pika.abc.AbstractIncomingMessage) -> None:
        try:
            self.events.append(json.loads(message.body))
        except json.JSONDecodeError:
            self.events.append({"raw": message.body.decode(errors="replace")})
        self._arrived.set()

    async def wait_for(self, predicate, timeout: float = 15.0) -> list[dict[str, Any]]:
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            found = [e for e in self.events if predicate(e)]
            if found:
                return found
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return []
            self._arrived.clear()
            try:
                await asyncio.wait_for(self._arrived.wait(), timeout=remaining)
            except TimeoutError:
                return [e for e in self.events if predicate(e)]


async def queue_depth(name: str) -> int:
    connection = await aio_pika.connect(RABBITMQ_URL, timeout=10)
    async with connection:
        channel = await connection.channel()
        queue = await channel.declare_queue(name, passive=True)
        return int(queue.declaration_result.message_count or 0)
