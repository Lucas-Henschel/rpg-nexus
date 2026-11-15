"""Topologia RabbitMQ do S2 (espelhada em infra/manifests/characters.json; um teste garante a igualdade).

Para cada fila de consumo Q existem:
* ``Q``        durável, ligada a ``rpg.events`` pelas routing keys de interesse; DLX -> ``Q.dlq``
* ``Q.retry``  sem consumidores; cada mensagem recebe TTL (backoff) e, ao expirar, volta para ``Q``
* ``Q.dlq``    destino final após ``MAX_RETRIES``; inspeção manual / reprocessamento

Fila própria por consumidor: réplicas do S2 dividem as mesmas filas (consumidores concorrentes, R4),
enquanto outros serviços interessados nos mesmos eventos têm as suas próprias filas.
"""

from __future__ import annotations

from dataclasses import dataclass

from .events import ACQUISITION_CANCELLED, CHARACTER_VALIDATION_REQUESTED, ITEM_ACQUIRED


@dataclass(frozen=True)
class QueueSpec:
    name: str
    bindings: tuple[str, ...]

    @property
    def retry_name(self) -> str:
        return f"{self.name}.retry"

    @property
    def dlq_name(self) -> str:
        return f"{self.name}.dlq"

    def arguments(self) -> dict[str, str]:
        return {"x-dead-letter-exchange": "", "x-dead-letter-routing-key": self.dlq_name}

    def retry_arguments(self) -> dict[str, str]:
        return {"x-dead-letter-exchange": "", "x-dead-letter-routing-key": self.name}


VALIDATION_QUEUE = QueueSpec("characters.validation-requested.v1", (CHARACTER_VALIDATION_REQUESTED.routing_key,))
OUTCOMES_QUEUE = QueueSpec("characters.acquisition-outcomes.v1", (ITEM_ACQUIRED.routing_key, ACQUISITION_CANCELLED.routing_key))
CONSUMER_QUEUES: tuple[QueueSpec, ...] = (VALIDATION_QUEUE, OUTCOMES_QUEUE)


def expected_manifest_queues() -> list[dict[str, object]]:
    queues: list[dict[str, object]] = []
    for q in CONSUMER_QUEUES:
        queues.append({"name": q.name, "durable": True, "arguments": q.arguments(), "bindings": list(q.bindings)})
        queues.append({"name": q.retry_name, "durable": True, "arguments": q.retry_arguments(), "bindings": []})
        queues.append({"name": q.dlq_name, "durable": True, "arguments": {}, "bindings": []})
    return queues
