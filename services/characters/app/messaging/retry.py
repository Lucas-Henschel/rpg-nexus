"""Política de retry com backoff exponencial e DLQ.

O contador de tentativas viaja no header ``x-retry-count`` da própria mensagem — portanto sobrevive
a reinícios do serviço e é visível no painel do RabbitMQ (evidência para F4).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .errors import PoisonMessage

RETRY_COUNT_HEADER = "x-retry-count"


class RetryAction(StrEnum):
    RETRY = "RETRY"
    DEAD_LETTER = "DEAD_LETTER"


@dataclass(frozen=True)
class RetryDecision:
    action: RetryAction
    next_attempt: int
    delay_ms: int
    reason: str


@dataclass(frozen=True)
class RetryPolicy:
    max_retries: int = 3
    base_delay_ms: int = 1_000
    max_delay_ms: int = 15_000
    poison_direct_to_dlq: bool = False

    def backoff_ms(self, attempt: int) -> int:
        """Atraso da tentativa ``attempt`` (1 = primeira repetição): base · 2^(attempt-1), limitado."""
        if attempt <= 0:
            return 0
        return min(self.base_delay_ms * (2 ** (attempt - 1)), self.max_delay_ms)

    def decide(self, error: BaseException, retries_so_far: int) -> RetryDecision:
        retries_so_far = max(retries_so_far, 0)
        kind = "poison" if isinstance(error, PoisonMessage) else "transient"
        reason = f"{kind}: {type(error).__name__}: {error}"[:500]
        if kind == "poison" and self.poison_direct_to_dlq:
            return RetryDecision(RetryAction.DEAD_LETTER, retries_so_far, 0, reason)
        if retries_so_far >= self.max_retries:
            return RetryDecision(RetryAction.DEAD_LETTER, retries_so_far, 0, reason)
        attempt = retries_so_far + 1
        return RetryDecision(RetryAction.RETRY, attempt, self.backoff_ms(attempt), reason)


def read_retry_count(headers: dict[str, object] | None) -> int:
    if not headers:
        return 0
    raw = headers.get(RETRY_COUNT_HEADER, 0)
    try:
        return max(int(raw), 0)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return 0
