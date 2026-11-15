"""Injeção de falha controlada para a demonstração F2 (crash depois do commit e antes do ACK).

``FAULT_CRASH_BEFORE_ACK=once``   derruba o processo na primeira mensagem processada (marcador em disco
                                  evita repetir após o restart do contêiner);
``FAULT_CRASH_BEFORE_ACK=always`` derruba sempre (útil com 2+ réplicas: a outra réplica recebe a reentrega).

O efeito no banco já foi gravado, o ACK não. O RabbitMQ reentrega a mensagem e a inbox impede que o
efeito seja aplicado de novo.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from pathlib import Path

from .envelope import Envelope

log = logging.getLogger(__name__)


class FaultInjector:
    def __init__(
        self, mode: str = "off", marker_file: str = "/tmp/characters-fault", exit_fn: Callable[[int], None] = os._exit
    ) -> None:
        self._mode = mode
        self._marker = Path(marker_file)
        self._exit = exit_fn

    @property
    def mode(self) -> str:
        return self._mode

    def before_ack(self, envelope: Envelope) -> None:
        if self._mode == "off":
            return
        if self._mode == "once":
            if self._marker.exists():
                return
            self._marker.write_text(str(envelope.messageId), encoding="utf-8")
        log.critical(
            "fault.crash_before_ack",
            extra={"faultMode": self._mode, "note": "efeito já persistido; ACK NÃO enviado — esperar reentrega"},
        )
        for handler in logging.getLogger().handlers:
            handler.flush()
        self._exit(137)
