"""Erros de domínio, traduzidos para HTTP pela camada de API."""

from __future__ import annotations


class DomainError(Exception):
    code = "DOMAIN_ERROR"
    http_status = 400

    def __init__(self, message: str, **details: object) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class CharacterNotFound(DomainError):
    code = "CHARACTER_NOT_FOUND"
    http_status = 404

    def __init__(self, character_id: str) -> None:
        super().__init__(f"personagem {character_id} não encontrado", characterId=character_id)


class VersionConflict(DomainError):
    code = "VERSION_CONFLICT"
    http_status = 409

    def __init__(self, expected: int, current: int) -> None:
        super().__init__(
            "a ficha foi alterada por outra requisição; recarregue e tente novamente",
            expectedVersion=expected,
            currentVersion=current,
        )


class CapacityBelowUsage(DomainError):
    code = "CAPACITY_BELOW_USAGE"
    http_status = 409

    def __init__(self, requested: int, slots_used: int) -> None:
        super().__init__(
            f"maxItems={requested} é menor que a capacidade já ocupada/reservada ({slots_used})",
            requestedMaxItems=requested,
            slotsUsed=slots_used,
        )


class InvalidPortrait(DomainError):
    code = "INVALID_PORTRAIT"
    http_status = 422


class PortraitNotFound(DomainError):
    code = "PORTRAIT_NOT_FOUND"
    http_status = 404


class IdempotencyKeyReused(DomainError):
    code = "IDEMPOTENCY_KEY_REUSED"
    http_status = 422

    def __init__(self) -> None:
        super().__init__("a Idempotency-Key já foi usada com um corpo de requisição diferente")


class DependencyUnavailable(DomainError):
    code = "DEPENDENCY_UNAVAILABLE"
    http_status = 503
