"""Formato único de erro: ``{"error": {"code", "message", "details"}}``."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.application.ports import CharacterAlreadyExists, StoreUnavailable
from app.domain.errors import DomainError

log = logging.getLogger(__name__)


def error_response(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = jsonable_encoder(details)
    return JSONResponse(status_code=status, content=body)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError) -> JSONResponse:
        return error_response(exc.http_status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": ".".join(str(p) for p in err.get("loc", ())), "message": err.get("msg"), "type": err.get("type")}
            for err in exc.errors()
        ]
        return error_response(422, "VALIDATION_ERROR", "requisição inválida", details)

    @app.exception_handler(CharacterAlreadyExists)
    async def _exists(_: Request, exc: CharacterAlreadyExists) -> JSONResponse:
        return error_response(409, "CHARACTER_ALREADY_EXISTS", "personagem já existe", {"characterId": str(exc)})

    @app.exception_handler(StoreUnavailable)
    async def _store(_: Request, exc: StoreUnavailable) -> JSONResponse:
        log.warning("store.unavailable", extra={"error": str(exc)})
        return error_response(503, "STORE_UNAVAILABLE", "banco de dados indisponível; tente novamente")

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("http.unhandled_error")
        return error_response(500, "INTERNAL_ERROR", "erro interno")
