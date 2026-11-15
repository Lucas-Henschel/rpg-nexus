"""Logs estruturados (JSON) com correlationId e messageId propagados por contextvars.

Os contextvars são copiados automaticamente por ``asyncio.to_thread``; assim, um log emitido dentro
do repositório (thread) carrega o mesmo correlationId da mensagem que está sendo processada.
Isso permite filtrar, em `docker compose logs`, todo o caminho de uma operação da Saga.
"""

from __future__ import annotations

import contextvars
import json
import logging
import socket
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

_context: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar("log_context", default=None)

_RESERVED = set(vars(logging.LogRecord("", 0, "", 0, "", (), None))) | {"message", "asctime"}


@contextmanager
def log_context(**fields: Any) -> Iterator[None]:
    """Adiciona campos (ex.: correlationId) a todos os logs emitidos dentro do bloco."""
    merged = {**(_context.get() or {}), **{k: v for k, v in fields.items() if v is not None}}
    token = _context.set(merged)
    try:
        yield
    finally:
        _context.reset(token)


def current_context() -> dict[str, Any]:
    return dict(_context.get() or {})


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str) -> None:
        super().__init__()
        self._service = service
        self._host = socket.gethostname()

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname,
            "service": self._service,
            "instance": self._host,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        entry.update(_context.get() or {})
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                entry[key] = value
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        ctx = _context.get() or {}
        extras = {k: v for k, v in record.__dict__.items() if k not in _RESERVED and not k.startswith("_")}
        tail = " ".join(f"{k}={v}" for k, v in {**ctx, **extras}.items())
        return f"{base} {tail}".rstrip()


def configure_logging(level: str = "INFO", fmt: str = "json", service: str = "characters") -> None:
    handler = logging.StreamHandler(sys.stdout)
    if fmt == "json":
        handler.setFormatter(JsonFormatter(service))
    else:
        handler.setFormatter(TextFormatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Bibliotecas muito verbosas em DEBUG
    for noisy in ("botocore", "boto3", "urllib3", "aiormq", "aio_pika"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, logging.getLevelName(level)))
