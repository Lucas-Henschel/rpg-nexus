"""Smoke test ponta a ponta do S2 contra o ambiente em execução (HTTP + RabbitMQ + DynamoDB reais).

Faz o papel do S3 Inventário publicando eventos, e verifica as respostas e o estado do S2:

1. cria um personagem com maxItems=1;
2. CharacterValidationRequested (op A)          -> CharacterValidated, capacidade 0;
3. mesmo envelope de A mais 4 vezes (F3)        -> nenhum evento novo, capacidade continua 0;
4. CharacterValidationRequested (op B)          -> CharacterRejected CAPACITY_EXCEEDED;
5. AcquisitionCancelled (op A) (compensação/F1) -> capacidade volta a 1, hold RELEASED;
6. AcquisitionCancelled (op C) antes do pedido  -> pedido C atrasado recusado OPERATION_CLOSED (F7);
7. MoneyDebitRequested (compra na loja)         -> MoneyDebited, saldo cai; repetido 4x não cobra de novo;
   compra sem saldo -> MoneyDebitRejected; MoneyRefundRequested -> MoneyRefunded, saldo volta;
8. opcional --poison: payload inválido vai à DLQ após MAX_RETRIES tentativas (F4).

As chamadas HTTP vão com um access token igual ao do S4, assinado com o JWT_SECRET do ambiente.

    python -m scripts.smoke_s2 --base-url http://localhost:8000 [--poison]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from app.config import Settings
from app.messaging.topology import consumer_queues
from app.security import sign_access_token

from .rabbit_tools import (
    EventListener,
    member_joined,
    money_request,
    outcome,
    publish,
    queue_depth,
    validation_request,
)

#: Usuário do teste: dono das fichas que o smoke cria (o "comprador" dos débitos).
SMOKE_USER = "smoke-user"


def _token() -> str:
    s = Settings.from_env()
    return sign_access_token(s.jwt_secret, issuer=s.jwt_issuer, audience=s.jwt_audience, user_id=SMOKE_USER, username="smoke")


RESULTS: list[tuple[str, bool, str]] = []


def http(method: str, url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {_token()}"}
    request = urllib.request.Request(url, data=data, method=method, headers=headers)  # noqa: S310
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


async def join_campaign(base: str, campaign: str, timeout: float = 15) -> bool:
    """Faz o papel do S1: o usuário do teste entra na campanha. Espera o S2 aplicar o evento."""
    await publish([member_joined(campaign, SMOKE_USER, "OWNER")])
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        try:
            http("GET", f"{base}/characters?campaignId={campaign}")
            return True
        except urllib.error.HTTPError as exc:
            if exc.code != 403:
                raise
        await asyncio.sleep(0.5)
    return False


async def run(base: str, poison: bool, poison_wait: float) -> None:
    campaign = f"smoke-{uuid.uuid4().hex[:6]}"
    check("participação na campanha aplicada (evento do S1)", await join_campaign(base, campaign), campaign)
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

    await check_money(base, campaign)

    outbox = http("GET", f"{base}/internal/outbox")
    check("outbox drenada", outbox.get("pending") == 0, json.dumps(outbox, default=str))

    if poison:
        dlq = consumer_queues(Settings.from_env())[0].dlq_name
        before = await queue_depth(dlq)
        await publish([b"{poison"])
        print(f"… aguardando {poison_wait:.0f}s pelas tentativas de retry (F4)", flush=True)
        await asyncio.sleep(poison_wait)
        after = await queue_depth(dlq)
        check("F4: poison message chegou à DLQ", after == before + 1, f"{dlq}: {before} -> {after}")


async def check_money(base: str, campaign: str) -> None:
    """Saga de compra, lado do S2: débito atômico e idempotente, recusa sem saldo e reembolso."""
    body = {"campaignId": campaign, "name": "Compradora", "hp": {"current": 5, "max": 5}, "currency": {"amount": 100}}
    buyer = http("POST", f"{base}/characters", body)["id"]

    def balance() -> int:
        return http("GET", f"{base}/characters/{buyer}")["currency"]["amount"]

    keys = ["money.debited.v1", "money.debit-rejected.v1", "money.refunded.v1"]
    async with EventListener(keys) as listener:
        op_buy, op_broke = str(uuid.uuid4()), str(uuid.uuid4())
        debit = money_request("debit", buyer, campaign, op_buy, user_id=SMOKE_USER, amount=30)
        await publish([debit] * 5)  # o mesmo envelope 5 vezes (F3)
        debited = await listener.wait_for(for_operation(op_buy, "rpg.money.debited.v1"))
        await asyncio.sleep(2)
        replies = [e for e in listener.events if e.get("payload", {}).get("operationId") == op_buy]
        check("dinheiro: débito aprovado", len(debited) == 1 and debited[0]["payload"]["balance"] == 70)
        check("dinheiro: duplicatas não cobram de novo", len(replies) == 1 and balance() == 70, f"saldo {balance()}")

        await publish([money_request("debit", buyer, campaign, op_broke, user_id=SMOKE_USER, amount=500)])
        rejected = await listener.wait_for(for_operation(op_broke, "rpg.money.debit-rejected.v1"))
        reason = rejected[0]["payload"]["reason"] if rejected else None
        check("dinheiro: compra sem saldo recusada", reason == "INSUFFICIENT_FUNDS" and balance() == 70, str(reason))

        await publish([money_request("refund", buyer, campaign, op_buy, user_id=SMOKE_USER, amount=30)])
        refunded = await listener.wait_for(for_operation(op_buy, "rpg.money.refunded.v1"))
        check("dinheiro: reembolso devolve o valor", len(refunded) == 1 and balance() == 100, f"saldo {balance()}")


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
