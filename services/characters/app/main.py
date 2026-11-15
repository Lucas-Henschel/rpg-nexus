"""Ponto de entrada: ``uvicorn --factory app.main:create_app``."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.errors import register_error_handlers
from app.api.routes import internal, router
from app.bootstrap import Container, build_container
from app.config import Settings
from app.logging_setup import configure_logging, log_context

log = logging.getLogger("app")

DESCRIPTION = """
Microsserviço **S2 — Personagens** do RPG Nexus.

* Fichas genéricas com atributos e perícias configuráveis.
* Participante da Saga de aquisição de item: consome `CharacterValidationRequested`, reserva capacidade
  de forma atômica e responde `CharacterValidated` / `CharacterRejected` via outbox transacional.
* Compensação local ao receber `AcquisitionCancelled`; confirmação ao receber `ItemAcquired`.
* Retratos no S3 (URL pré-assinada ou upload pelo backend).
"""


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or (container.settings if container else Settings.from_env())
    configure_logging(settings.log_level, settings.log_format, settings.service_name)
    container = container or build_container(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        tasks: list[asyncio.Task[None]] = []
        if container.bus is not None:
            tasks.append(asyncio.create_task(container.bus.run(), name="rabbitmq-supervisor"))
        if container.relay is not None:
            tasks.append(asyncio.create_task(container.relay.run(), name="outbox-relay"))
        log.info(
            "service.started",
            extra={
                "version": __version__,
                "store": settings.store_backend,
                "storage": settings.storage_backend,
                "messaging": settings.messaging_enabled,
            },
        )
        try:
            yield
        finally:
            if container.relay is not None:
                await container.relay.stop()
            if container.bus is not None:
                await container.bus.stop()
            for task in tasks:
                task.cancel()
            for task in tasks:
                with suppress(asyncio.CancelledError, Exception):
                    await task
            log.info("service.stopped")

    app = FastAPI(
        title="RPG Nexus — S2 Personagens",
        version=__version__,
        description=DESCRIPTION,
        lifespan=lifespan,
    )
    app.state.container = container

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PATCH", "PUT", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["ETag", "Location", "X-Correlation-Id"],
    )

    @app.middleware("http")
    async def correlation_and_access_log(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        correlation_id = request.headers.get("x-correlation-id") or request.headers.get("x-request-id") or str(uuid.uuid4())
        started = time.perf_counter()
        with log_context(correlationId=correlation_id):
            response = await call_next(request)
            if request.url.path not in ("/health",):
                log.info(
                    "http.request",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "status": response.status_code,
                        "elapsedMs": round((time.perf_counter() - started) * 1000, 1),
                    },
                )
        response.headers["X-Correlation-Id"] = correlation_id
        return response

    register_error_handlers(app)
    app.include_router(router)
    if settings.enable_internal_endpoints:
        app.include_router(internal)
    return app
