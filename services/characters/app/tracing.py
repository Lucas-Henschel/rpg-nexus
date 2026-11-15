"""Tracing distribuído com OpenTelemetry (W3C Trace Context).

Como o trace atravessa o RabbitMQ:

* **Entrada:** o consumidor lê ``traceparent``/``tracestate`` dos *headers AMQP* da mensagem e abre o span
  de processamento como filho do span de quem publicou.
* **Saída pela outbox:** o evento de resposta é gravado na outbox dentro do span de processamento; junto
  com ele vai o ``traceparent`` daquele momento (``OutboxRecord.trace_context``). O relay publica depois,
  em outro momento e sem contexto, por isso ele reabre o contexto guardado e injeta um ``traceparent``
  novo (o do span de publicação) nos headers da mensagem que sai.

O contexto NÃO vai no envelope: o envelope do trabalho tem exatamente seis campos. Ele vai nos headers
AMQP, que é onde as instrumentações automáticas de Node (amqplib) e Java (agente) também procuram.

Com ``TRACING_ENABLED=false`` (padrão fora do Docker e nos testes), a API do OpenTelemetry é no-op:
nenhum span é exportado e o código funciona igual.
"""

from __future__ import annotations

import atexit
import logging
import socket
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from opentelemetry import context as otel_context
from opentelemetry import propagate, trace
from opentelemetry.trace import SpanKind, Status, StatusCode

log = logging.getLogger(__name__)

#: Headers do W3C Trace Context propagados nas mensagens.
TRACE_HEADERS = ("traceparent", "tracestate")

_tracer = trace.get_tracer("rpg-nexus.characters")
_provider: Any | None = None


def init_tracing(service_name: str, *, enabled: bool) -> bool:
    """Configura o SDK e o exportador OTLP (endpoint em ``OTEL_EXPORTER_OTLP_ENDPOINT``). Idempotente."""
    global _provider
    if not enabled or _provider is not None:
        return _provider is not None
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(
        resource=Resource.create({"service.name": service_name, "service.instance.id": socket.gethostname()})
    )
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    BotocoreInstrumentor().instrument()  # chamadas ao DynamoDB/S3 aparecem como spans filhos
    _provider = provider
    atexit.register(shutdown_tracing)  # exporta o que sobrar quando o processo terminar
    log.info("tracing.enabled", extra={"serviceName": service_name})
    return True


def instrument_fastapi(app: Any) -> None:
    if _provider is None:
        return
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    # sem os spans internos "http receive"/"http send" do ASGI: só poluem a tela do Jaeger
    FastAPIInstrumentor.instrument_app(
        app, excluded_urls="health,ready", tracer_provider=_provider, exclude_spans=["receive", "send"]
    )


def flush_tracing() -> None:
    """Exporta já os spans em memória, sem desligar o tracing (o processo pode publicar de novo)."""
    if _provider is not None:
        _provider.force_flush()


def shutdown_tracing() -> None:
    """Exporta o que ainda está em memória e desliga o tracing. Só uma vez por processo."""
    global _provider
    if _provider is not None:
        _provider.shutdown()
        _provider = None


def current_carrier() -> dict[str, str]:
    """``traceparent`` (e ``tracestate``) do span atual; vazio se não houver span ativo."""
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    return carrier


def extract(headers: Mapping[str, Any] | None) -> otel_context.Context:
    carrier = {}
    for key in TRACE_HEADERS:
        value = (headers or {}).get(key)
        if isinstance(value, bytes):
            value = value.decode("ascii", errors="ignore")
        if isinstance(value, str) and value:
            carrier[key] = value
    return propagate.extract(carrier)


def current_trace_id() -> str | None:
    span_context = trace.get_current_span().get_span_context()
    return format(span_context.trace_id, "032x") if span_context.is_valid else None


@contextmanager
def consumer_span(queue: str, headers: Mapping[str, Any] | None, attributes: dict[str, Any]) -> Iterator[Any]:
    """Span de processamento de uma mensagem, filho do span de quem a publicou."""
    with _tracer.start_as_current_span(
        f"{queue} process",
        context=extract(headers),
        kind=SpanKind.CONSUMER,
        attributes={
            "messaging.system": "rabbitmq",
            "messaging.operation": "process",
            "messaging.destination.name": queue,
            **{k: v for k, v in attributes.items() if v is not None},
        },
    ) as span:
        yield span


@contextmanager
def producer_span(routing_key: str, stored_context: Mapping[str, str] | None, attributes: dict[str, Any]) -> Iterator[Any]:
    """Span de publicação, continuando o trace guardado na outbox (ou o contexto atual, se não houver)."""
    parent = extract(stored_context) if stored_context else None
    with _tracer.start_as_current_span(
        f"{routing_key} publish",
        context=parent,
        kind=SpanKind.PRODUCER,
        attributes={
            "messaging.system": "rabbitmq",
            "messaging.operation": "publish",
            "messaging.destination.name": routing_key,
            **{k: v for k, v in attributes.items() if v is not None},
        },
    ) as span:
        yield span


def mark_error(span: Any, exc: BaseException) -> None:
    span.record_exception(exc)
    span.set_status(Status(StatusCode.ERROR, f"{type(exc).__name__}: {exc}"[:200]))


@contextmanager
def untraced() -> Iterator[None]:
    """Desliga a instrumentação automática no bloco (ex.: polling da outbox a cada 500 ms, que inundaria o Jaeger)."""
    from opentelemetry.instrumentation.utils import suppress_instrumentation

    with suppress_instrumentation():
        yield
