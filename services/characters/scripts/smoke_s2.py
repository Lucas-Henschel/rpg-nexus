"""Smoke test ponta a ponta do S2 contra o ambiente em execução (HTTP + RabbitMQ + DynamoDB reais).

Faz o papel do S3 Inventário publicando eventos, e verifica as respostas e o estado do S2:

1. cria um personagem com maxItems=1;
2. CharacterValidationRequested (op A)          -> CharacterValidated, capacidade 0;
3. mesmo envelope de A mais 4 vezes (F3)        -> nenhum evento novo, capacidade continua 0;
4. CharacterValidationRequested (op B)          -> CharacterRejected CAPACITY_EXCEEDED;
5. AcquisitionCancelled (op A) (compensação/F1) -> capacidade volta a 1, hold RELEASED;
6. AcquisitionCancelled (op C) antes do pedido  -> pedido C atrasado recusado OPERATION_CLOSED (F7);
7. opcional --poison: payload inválido vai à DLQ após MAX_RETRIES tentativas (F4).

    python -m scripts.smoke_s2 --base-url http://localhost:8000 [--poison]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid
from typing import Any

from app.messaging.topology import VALIDATION_QUEUE

from .rabbit_tools import EventListener, outcome, publish, queue_depth, validation_request

RESULTS: list[tuple[str, bool, str]] = []


def http(method: str, url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})  # noqa: S310
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310 — URL vinda do operador
        return json.loads(response.read() or b"{}")


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, condition, detail))
    print(f"{'✔' if condition else '✘'} {name}{(' — ' + detail) if detail else ''}", flush=True)


def for_operation(op: str, event_type: str):
    return lambda e: e.get("type") == event_type and e.get("payload", {}).get("operationId") == op


async def capacity_eventually(base: str, character_id: str, expected: int, timeout: float = 10) -> int:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        available = http("GET", f"{base}/characters/{character_id}")["capacity"]["slotsAvailable"]
        if available == expected or loop.time() > deadline:
            return available
        await asyncio.sleep(0.3)


async def run(base: str, poison: bool, poison_wait: float) -> None:
    campaign = f"smoke-{uuid.uuid4().hex[:6]}"
    character = http(
        "POST", f"{base}/characters", {"campaignId": campaign, "name": "Smoke", "hp": {"current": 5, "max": 5}, "maxItems": 1}
    )
    cid = character["id"]
    check("personagem criado", character["capacity"]["slotsAvailable"] == 1, cid)

    async with EventListener(["character.validated.v1", "character.rejected.v1"]) as listener:
        op_a, op_b, op_c = (str(uuid.uuid4()) for _ in range(3))

        request_a = validation_request(cid, campaign, op_a, deadline_seconds=60)
        await publish([request_a])
        validated = await listener.wait_for(for_operation(op_a, "rpg.character.validated.v1"))
        check("op A validada", len(validated) == 1)
        check("capacidade reservada", await capacity_eventually(base, cid, 0) == 0)

        await publish([request_a] * 4)
        await asyncio.sleep(2)
        replies = [e for e in listener.events if e.get("payload", {}).get("operationId") == op_a]
        check(
            "F3: duplicatas não geram efeito nem evento",
            len(replies) == 1 and await capacity_eventually(base, cid, 0) == 0,
            f"{len(replies)} resposta(s)",
        )

        await publish([validation_request(cid, campaign, op_b)])
        rejected = await listener.wait_for(for_operation(op_b, "rpg.character.rejected.v1"))
        reason = rejected[0]["payload"]["reason"] if rejected else None
        check("op B recusada por capacidade", reason == "CAPACITY_EXCEEDED", str(reason))

        await publish([outcome("cancelled", cid, op_a)])
        check("F1: cancelamento devolve capacidade", await capacity_eventually(base, cid, 1) == 1)
        holds = {h["operationId"]: h["status"] for h in http("GET", f"{base}/characters/{cid}/holds")["items"]}
        check("hold A RELEASED", holds.get(op_a) == "RELEASED", str(holds))

        await publish([outcome("cancelled", cid, op_c)])
        await asyncio.sleep(1)
        await publish([validation_request(cid, campaign, op_c)])
        late = await listener.wait_for(for_operation(op_c, "rpg.character.rejected.v1"))
        reason = late[0]["payload"]["reason"] if late else None
        check("F7: pedido após cancelamento é recusado", reason == "OPERATION_CLOSED", str(reason))
        check("nenhuma capacidade retida", await capacity_eventually(base, cid, 1) == 1)

        # Versionamento: a mesma fila recebe o pedido na v2 (prazo obrigatório em `expiresAt`).
        op_d = str(uuid.uuid4())
        await publish([validation_request(cid, campaign, op_d, version=2)])
        validated_v2 = await listener.wait_for(for_operation(op_d, "rpg.character.validated.v1"))
        check("versionamento: pedido v2 validado ao lado da v1", len(validated_v2) == 1)
        check("versionamento: v2 reservou capacidade", await capacity_eventually(base, cid, 0) == 0)
        await publish([outcome("cancelled", cid, op_d)])
        check("versionamento: cancelamento da operação v2 compensa", await capacity_eventually(base, cid, 1) == 1)

    # CQRS: o painel da campanha vem do modelo de leitura e já reflete a Saga acima.
    await asyncio.sleep(1)  # consistência eventual: dá tempo à última projeção
    roster = http("GET", f"{base}/campaigns/{campaign}/roster")
    row = next((i for i in roster["items"] if i["characterId"] == cid), None)
    check("CQRS: personagem aparece no modelo de leitura", row is not None, json.dumps(roster["totals"]))
    check(
        "CQRS: modelo de leitura reflete capacidade e reservas",
        row is not None and row["capacity"]["slotsAvailable"] == 1 and row["holds"]["held"] == 0,
        json.dumps(row, default=str),
    )

    jaeger = os.getenv("JAEGER_QUERY_URL")
    if jaeger and os.getenv("TRACING_ENABLED", "").lower() in {"1", "true", "yes", "on", "sim"}:
        # Operação própria, publicada uma única vez: o trace dela precisa ter o publicador e o S2.
        op_t = str(uuid.uuid4())
        await publish([validation_request(cid, campaign, op_t)])
        found, detail = await find_cross_service_trace(jaeger, op_t)
        check("tracing: uma operação é um único trace que atravessa publicador e S2", found, detail)
        await publish([outcome("cancelled", cid, op_t)])
        check("tracing: operação de teste compensada", await capacity_eventually(base, cid, 1) == 1)

    outbox = http("GET", f"{base}/internal/outbox")
    check("outbox drenada", outbox.get("pending") == 0, json.dumps(outbox, default=str))

    if poison:
        before = await queue_depth(VALIDATION_QUEUE.dlq_name)
        await publish([b"{poison"])
        print(f"… aguardando {poison_wait:.0f}s pelas tentativas de retry (F4)", flush=True)
        await asyncio.sleep(poison_wait)
        after = await queue_depth(VALIDATION_QUEUE.dlq_name)
        check("F4: poison message chegou à DLQ", after == before + 1, f"{VALIDATION_QUEUE.dlq_name}: {before} -> {after}")


async def find_cross_service_trace(jaeger: str, correlation_id: str, wait_seconds: float = 30.0) -> tuple[bool, str]:
    """Procura no Jaeger um trace da operação com spans do publicador e do S2 (os spans chegam em lotes de ~5 s)."""
    tags = urllib.parse.quote(json.dumps({"rpg.correlation_id": correlation_id}))
    url = f"{jaeger.rstrip('/')}/api/traces?service=characters&tags={tags}&lookback=1h&limit=20"
    deadline = time.monotonic() + wait_seconds
    seen = "nenhum trace encontrado"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310 — URL interna da rede Compose
                traces = json.load(resp).get("data") or []
        except OSError as exc:
            traces, seen = [], f"Jaeger inacessível: {exc}"
        for item in traces:
            services = {p["serviceName"] for p in item.get("processes", {}).values()}
            if {"demo-publisher", "characters"} <= services:
                return True, f"traceId {item['traceID']} com {', '.join(sorted(services))}"
            seen = f"traceId {item['traceID']} só com {', '.join(sorted(services))}"
        await asyncio.sleep(2)
    return False, seen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--poison", action="store_true", help="também testa a DLQ (demora ~MAX_RETRIES backoffs)")
    parser.add_argument("--poison-wait", type=float, default=12.0, help="segundos; padrão cobre 3 retries de 1s/2s/4s")
    args = parser.parse_args()
    asyncio.run(run(args.base_url.rstrip("/"), args.poison, args.poison_wait))
    failed = [name for name, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} verificações OK")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
