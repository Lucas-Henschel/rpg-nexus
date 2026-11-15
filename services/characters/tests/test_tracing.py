"""Tracing distribuído: o trace atravessa consumo, outbox e publicação pelos headers AMQP (W3C traceparent)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode

from app.application.handlers import HandlingResult, MessageHandlers, Outcome
from app.messaging.outbox_relay import OutboxRelay
from app.messaging.rabbitmq import RabbitMQBus
from app.messaging.retry import RetryPolicy
from app.messaging.topology import VALIDATION_QUEUE
from app.tracing import current_carrier, extract

from .conftest import make_character, validation_request

EXPORTER = InMemorySpanExporter()
_provider = TracerProvider()
_provider.add_span_processor(SimpleSpanProcessor(EXPORTER))
trace.set_tracer_provider(_provider)

TRACE_ID = "ab" * 16
PARENT_SPAN_ID = "cd" * 8
TRACEPARENT = f"00-{TRACE_ID}-{PARENT_SPAN_ID}-01"


@pytest.fixture(autouse=True)
def _clean_spans():
    EXPORTER.clear()
    yield


def _trace_id_of(traceparent: str) -> str:
    return traceparent.split("-")[1]


def _span_id_of(traceparent: str) -> str:
    return traceparent.split("-")[2]


class FakeExchange:
    def __init__(self) -> None:
        self.sent: list[tuple[Any, str]] = []

    async def publish(self, message, routing_key: str, timeout: float | None = None) -> None:
        self.sent.append((message, routing_key))


class FakeIncoming:
    def __init__(self, body: bytes, headers: dict[str, Any]) -> None:
        self.body = body
        self.headers = headers
        self.message_id = "amqp-1"
        self.routing_key = "character.validation.requested.v1"
        self.redelivered = False
        self.content_type = "application/json"
        self.correlation_id = None
        self.type = None
        self.acked = False

    async def ack(self) -> None:
        self.acked = True

    async def nack(self, requeue: bool = True) -> None:
        pass


def _bus(dispatcher, exchange: FakeExchange | None = None) -> RabbitMQBus:
    bus = RabbitMQBus(
        url="amqp://unused",
        exchange_name="rpg.events",
        prefetch=1,
        declare_topology=False,
        reconnect_initial_ms=100,
        reconnect_max_ms=200,
        service_name="characters",
        dispatcher=dispatcher,
        policy=RetryPolicy(max_retries=3, base_delay_ms=10, max_delay_ms=20),
    )
    if exchange is not None:
        bus._exchange = exchange
        bus._connected.set()
    return bus


def _spans(kind: SpanKind):
    return [s for s in EXPORTER.get_finished_spans() if s.kind is kind]


def test_carrier_vazio_sem_span_ativo():
    assert current_carrier() == {}


def test_extract_aceita_header_em_bytes():
    span_context = trace.get_current_span(extract({"traceparent": TRACEPARENT.encode()})).get_span_context()
    assert format(span_context.trace_id, "032x") == TRACE_ID


def test_consumidor_continua_o_trace_de_quem_publicou():
    seen: dict[str, str] = {}

    def dispatcher(envelope):
        # roda em outra thread (asyncio.to_thread): o contexto do span precisa chegar até aqui
        seen["trace_id"] = format(trace.get_current_span().get_span_context().trace_id, "032x")
        return HandlingResult(Outcome.APPROVED)

    message = FakeIncoming(validation_request().model_dump_json().encode(), {"traceparent": TRACEPARENT})
    asyncio.run(_bus(dispatcher)._on_message(VALIDATION_QUEUE, SimpleNamespace(), message))

    (span,) = _spans(SpanKind.CONSUMER)
    assert span.name == "characters.validation-requested.v1 process"
    assert format(span.context.trace_id, "032x") == TRACE_ID
    assert format(span.parent.span_id, "016x") == PARENT_SPAN_ID
    assert span.attributes["rpg.outcome"] == "APPROVED"
    assert seen["trace_id"] == TRACE_ID
    assert message.acked


def test_mensagem_venenosa_marca_erro_e_retry_mantem_o_trace():
    exchange = FakeExchange()
    channel = SimpleNamespace(default_exchange=exchange)
    message = FakeIncoming(b"{nao e json", {"traceparent": TRACEPARENT})
    asyncio.run(_bus(lambda e: None)._on_message(VALIDATION_QUEUE, channel, message))

    (span,) = _spans(SpanKind.CONSUMER)
    assert span.status.status_code is StatusCode.ERROR
    republished, target = exchange.sent[0]
    assert target == VALIDATION_QUEUE.retry_name
    assert republished.headers["traceparent"] == TRACEPARENT  # a nova tentativa continua no mesmo trace


def test_evento_da_outbox_guarda_o_trace_do_processamento(store, clock, handlers):
    make_character(store, clock)
    with trace.get_tracer("teste").start_as_current_span("consumo") as span:
        handlers.dispatch(validation_request())
    stored = store.outbox[-1].trace_context["traceparent"]
    assert _trace_id_of(stored) == format(span.get_span_context().trace_id, "032x")


def test_relay_publica_continuando_o_trace_guardado(store, clock):
    make_character(store, clock)
    handlers = MessageHandlers(store, clock=clock)
    with trace.get_tracer("teste").start_as_current_span("consumo") as origin:
        handlers.dispatch(validation_request())
    origin_trace = format(origin.get_span_context().trace_id, "032x")
    EXPORTER.clear()

    exchange = FakeExchange()
    relay = OutboxRelay(store, _bus(lambda e: None, exchange), batch_size=10, clock=clock)
    assert asyncio.run(relay.run_once()) == 1  # o relay roda sem contexto, em outro momento

    (producer,) = _spans(SpanKind.PRODUCER)
    assert producer.name == "character.validated.v1 publish"
    assert format(producer.context.trace_id, "032x") == origin_trace
    message, _ = exchange.sent[0]
    # o próximo serviço recebe o traceparent do span de publicação e vira filho dele
    assert _trace_id_of(message.headers["traceparent"]) == origin_trace
    assert _span_id_of(message.headers["traceparent"]) == format(producer.context.span_id, "016x")
    assert message.headers["x-producer"] == "characters"


def test_evento_antigo_sem_trace_publica_em_trace_novo(store, clock):
    make_character(store, clock)
    MessageHandlers(store, clock=clock).dispatch(validation_request())  # sem span ativo
    assert store.outbox[-1].trace_context == {}

    exchange = FakeExchange()
    asyncio.run(OutboxRelay(store, _bus(lambda e: None, exchange), batch_size=10, clock=clock).run_once())
    (producer,) = _spans(SpanKind.PRODUCER)
    assert producer.parent is None
    assert "traceparent" in exchange.sent[0][0].headers
