"""Adaptador RabbitMQ (aio-pika): conexão supervisionada, consumo com ACK manual, retry/DLQ e publicação confirmada.

Decisões:
* **Reconexão explícita (R6/F6):** um laço supervisor conecta com backoff exponencial + jitter; quando a
  conexão ou um canal cai, tudo é recriado e a topologia e os consumidores são declarados de novo.
* **ACK só depois da transação local** (handler síncrono roda em thread via ``asyncio.to_thread``).
* **Publisher confirms** no canal de publicação: a outbox só marca PUBLISHED depois do ack do broker.
* **Retry com contador no header** ``x-retry-count`` e TTL por mensagem na fila ``.retry`` (backoff);
  esgotadas as tentativas, a mensagem vai para ``.dlq`` com o motivo no header ``x-last-error``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import socket
import time
from collections import Counter
from collections.abc import Callable
from datetime import timedelta
from functools import partial
from typing import Any

import aio_pika
from aio_pika import DeliveryMode, ExchangeType, Message
from aio_pika.abc import AbstractChannel, AbstractExchange, AbstractIncomingMessage

from app.application.handlers import HandlingResult
from app.application.ports import OutboxRecord
from app.logging_setup import log_context
from app.tracing import consumer_span, current_carrier, current_trace_id, mark_error, producer_span

from .envelope import Envelope, parse_envelope
from .errors import PoisonMessage
from .faults import FaultInjector
from .retry import RETRY_COUNT_HEADER, RetryAction, RetryPolicy, read_retry_count
from .topology import CONSUMER_QUEUES, QueueSpec

log = logging.getLogger(__name__)

Dispatcher = Callable[[Envelope], HandlingResult]


class NotConnected(Exception):
    pass


class RabbitMQBus:
    def __init__(
        self,
        *,
        url: str,
        exchange_name: str,
        prefetch: int,
        declare_topology: bool,
        reconnect_initial_ms: int,
        reconnect_max_ms: int,
        service_name: str,
        dispatcher: Dispatcher,
        policy: RetryPolicy,
        fault: FaultInjector | None = None,
        queues: tuple[QueueSpec, ...] = CONSUMER_QUEUES,
        simulated_delay_ms: int = 0,
    ) -> None:
        self._url = url
        self._exchange_name = exchange_name
        self._prefetch = prefetch
        self._declare = declare_topology
        self._initial_delay = reconnect_initial_ms / 1000
        self._max_delay = reconnect_max_ms / 1000
        self._service = service_name
        self._instance = socket.gethostname()
        self._dispatch = dispatcher
        self._policy = policy
        self._fault = fault or FaultInjector()
        self._queues = queues
        self._simulated_delay = simulated_delay_ms / 1000
        self._connected = asyncio.Event()
        self._stopping = asyncio.Event()
        self._exchange: AbstractExchange | None = None
        self._connection: aio_pika.abc.AbstractConnection | None = None
        self.stats: dict[str, Any] = {"sessions": 0, "lastError": None, "outcomes": Counter(), "retried": 0, "deadLettered": 0}

    # --- estado ---------------------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._connected.is_set() and self._exchange is not None

    async def wait_connected(self, timeout: float) -> bool:
        try:
            await asyncio.wait_for(self._connected.wait(), timeout)
        except TimeoutError:
            return False
        return True

    def snapshot(self) -> dict[str, Any]:
        return {
            "connected": self.is_connected,
            "sessions": self.stats["sessions"],
            "reconnects": max(self.stats["sessions"] - 1, 0),
            "lastError": self.stats["lastError"],
            "outcomes": dict(self.stats["outcomes"]),
            "retried": self.stats["retried"],
            "deadLettered": self.stats["deadLettered"],
            "queues": [q.name for q in self._queues],
            "faultMode": self._fault.mode,
        }

    # --- ciclo de vida --------------------------------------------------------------------------

    async def run(self) -> None:
        delay = self._initial_delay
        while not self._stopping.is_set():
            started = time.monotonic()
            try:
                await self._session()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — broker fora, credencial errada, canal fechado...
                self.stats["lastError"] = f"{type(exc).__name__}: {exc}"
                log.warning("rabbitmq.disconnected", extra={"error": self.stats["lastError"]})
            finally:
                self._connected.clear()
                self._exchange = None
                await self._close_quietly()
            if self._stopping.is_set():
                break
            if time.monotonic() - started > 30:  # sessão estável: recomeça o backoff
                delay = self._initial_delay
            sleep_for = random.uniform(delay / 2, delay)  # noqa: S311 — jitter, não criptografia
            log.info("rabbitmq.reconnecting", extra={"inSeconds": round(sleep_for, 2)})
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=sleep_for)
            except TimeoutError:
                pass
            delay = min(delay * 2, self._max_delay)

    async def stop(self) -> None:
        self._stopping.set()
        await self._close_quietly()

    async def _close_quietly(self) -> None:
        connection, self._connection = self._connection, None
        if connection is not None and not connection.is_closed:
            try:
                await connection.close()
            except Exception:  # noqa: BLE001, S110 — encerramento best-effort
                pass

    async def _session(self) -> None:
        connection = await aio_pika.connect(
            self._url, timeout=10, client_properties={"connection_name": f"{self._service}@{self._instance}"}
        )
        self._connection = connection
        lost = asyncio.Event()

        def on_close(*_: Any) -> None:
            lost.set()

        connection.close_callbacks.add(on_close)
        publish_channel = await connection.channel(publisher_confirms=True)
        consume_channel = await connection.channel(publisher_confirms=True)
        publish_channel.close_callbacks.add(on_close)
        consume_channel.close_callbacks.add(on_close)
        await consume_channel.set_qos(prefetch_count=self._prefetch)

        exchange = await publish_channel.declare_exchange(
            self._exchange_name, ExchangeType.TOPIC, durable=True, passive=not self._declare
        )
        for spec in self._queues:
            if self._declare:
                await consume_channel.declare_queue(spec.dlq_name, durable=True)
                await consume_channel.declare_queue(spec.retry_name, durable=True, arguments=spec.retry_arguments())
                queue = await consume_channel.declare_queue(spec.name, durable=True, arguments=spec.arguments())
                for routing_key in spec.bindings:
                    await queue.bind(self._exchange_name, routing_key=routing_key)
            else:
                queue = await consume_channel.declare_queue(spec.name, passive=True)
            await queue.consume(partial(self._on_message, spec, consume_channel), no_ack=False)

        self._exchange = exchange
        self.stats["sessions"] += 1
        self._connected.set()
        log.info(
            "rabbitmq.connected",
            extra={"session": self.stats["sessions"], "prefetch": self._prefetch, "queues": [q.name for q in self._queues]},
        )
        stop_wait = asyncio.create_task(self._stopping.wait())
        lost_wait = asyncio.create_task(lost.wait())
        try:
            await asyncio.wait({stop_wait, lost_wait}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            stop_wait.cancel()
            lost_wait.cancel()
        if not self._stopping.is_set():
            raise ConnectionError("conexão ou canal com o RabbitMQ foi fechado")

    # --- consumo --------------------------------------------------------------------------------

    async def _on_message(self, spec: QueueSpec, channel: AbstractChannel, message: AbstractIncomingMessage) -> None:
        retries = read_retry_count(message.headers)
        attributes = {
            "messaging.message.id": message.message_id,
            "messaging.rabbitmq.destination.routing_key": message.routing_key,
            "rpg.retry_count": retries,
            "rpg.redelivered": message.redelivered,
        }
        # O span continua o trace de quem publicou (traceparent nos headers AMQP).
        with consumer_span(spec.name, message.headers, attributes) as span:
            await self._process(spec, channel, message, retries, span)

    async def _process(
        self, spec: QueueSpec, channel: AbstractChannel, message: AbstractIncomingMessage, retries: int, span: Any
    ) -> None:
        started = time.perf_counter()
        try:
            envelope = parse_envelope(message.body)
        except PoisonMessage as exc:
            mark_error(span, exc)
            with log_context(amqpMessageId=message.message_id, queue=spec.name, traceId=current_trace_id()):
                await self._fail(spec, channel, message, exc, retries)
            return

        span.set_attribute("rpg.event_type", envelope.type)
        span.set_attribute("rpg.correlation_id", envelope.correlationId)
        with log_context(
            correlationId=envelope.correlationId,
            messageId=str(envelope.messageId),
            eventType=envelope.type,
            traceId=current_trace_id(),
        ):
            try:
                if self._simulated_delay:  # consumidor lento de propósito: faz a fila crescer na demonstração
                    await asyncio.sleep(self._simulated_delay)
                # to_thread copia os contextvars: o span atual segue para o handler e para as chamadas ao DynamoDB
                result = await asyncio.to_thread(self._dispatch, envelope)
            except Exception as exc:  # noqa: BLE001 — qualquer falha segue a política de retry
                mark_error(span, exc)
                await self._fail(spec, channel, message, exc, retries)
                return
            span.set_attribute("rpg.outcome", result.outcome.value)
            self.stats["outcomes"][result.outcome.value] += 1
            log.info(
                "message.processed",
                extra={
                    "queue": spec.name,
                    "outcome": result.outcome.value,
                    "emitted": result.emitted_type,
                    "retries": retries,
                    "redelivered": message.redelivered,
                    "elapsedMs": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            self._fault.before_ack(envelope)  # F2: crash entre commit e ACK (desligado por padrão)
            try:
                await message.ack()
            except Exception as exc:  # noqa: BLE001
                # canal caiu depois do commit: o broker reentregará e a inbox evitará efeito duplicado
                log.warning("message.ack_failed", extra={"error": str(exc)})

    async def _fail(
        self, spec: QueueSpec, channel: AbstractChannel, message: AbstractIncomingMessage, exc: BaseException, retries: int
    ) -> None:
        decision = self._policy.decide(exc, retries)
        target = spec.retry_name if decision.action is RetryAction.RETRY else spec.dlq_name
        headers = {k: v for k, v in (message.headers or {}).items() if k != "x-death"}
        headers.update(
            {
                RETRY_COUNT_HEADER: decision.next_attempt,
                "x-last-error": decision.reason[:250],
                "x-failed-by": self._instance,
                "x-original-queue": spec.name,
                "x-original-routing-key": message.routing_key or "",
            }
        )
        republished = Message(
            body=message.body,
            headers=headers,
            content_type=message.content_type or "application/json",
            delivery_mode=DeliveryMode.PERSISTENT,
            message_id=message.message_id,
            correlation_id=message.correlation_id,
            type=message.type,
            # TTL mínimo de 1 ms: sem expiração a mensagem ficaria parada na fila .retry
            expiration=timedelta(milliseconds=max(decision.delay_ms, 1)) if decision.action is RetryAction.RETRY else None,
        )
        try:
            await channel.default_exchange.publish(republished, routing_key=target)
            await message.ack()
        except Exception as publish_exc:  # noqa: BLE001
            log.error("message.retry_publish_failed", extra={"error": str(publish_exc), "target": target})
            try:
                await message.nack(requeue=True)
            except Exception:  # noqa: BLE001, S110 — canal já fechado: o broker reentrega sozinho
                pass
            return
        if decision.action is RetryAction.RETRY:
            self.stats["retried"] += 1
            log.warning(
                "message.retry_scheduled",
                extra={
                    "queue": spec.name,
                    "attempt": decision.next_attempt,
                    "maxRetries": self._policy.max_retries,
                    "delayMs": decision.delay_ms,
                    "error": decision.reason,
                },
            )
        else:
            self.stats["deadLettered"] += 1
            log.error(
                "message.dead_lettered",
                extra={"queue": spec.name, "dlq": spec.dlq_name, "retries": retries, "error": decision.reason},
            )

    # --- publicação -----------------------------------------------------------------------------

    async def publish(self, record: OutboxRecord) -> None:
        exchange = self._exchange
        if exchange is None or not self._connected.is_set():
            raise NotConnected("RabbitMQ indisponível")
        attributes = {"messaging.message.id": record.message_id, "rpg.event_type": record.type}
        with producer_span(record.routing_key, record.trace_context, attributes) as span:
            # traceparent do span de publicação: o consumidor do outro serviço vira filho dele
            headers: dict[str, Any] = {"x-producer": self._service, **current_carrier()}
            message = Message(
                body=json.dumps(record.envelope, ensure_ascii=False).encode("utf-8"),
                content_type="application/json",
                content_encoding="utf-8",
                delivery_mode=DeliveryMode.PERSISTENT,
                message_id=record.message_id,
                correlation_id=record.correlation_id,
                type=record.type,
                timestamp=record.created_at,
                app_id=self._service,
                headers=headers,
            )
            try:
                await exchange.publish(message, routing_key=record.routing_key, timeout=10)
            except Exception as exc:
                mark_error(span, exc)
                raise
