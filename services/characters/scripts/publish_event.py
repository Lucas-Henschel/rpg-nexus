"""Publica eventos de teste em rpg.events — permite exercitar o S2 sem o S3 Inventário (P3).

Exemplos (dentro do contêiner: ``docker compose exec characters python -m scripts.publish_event ...``):

    # pedido de validação
    python -m scripts.publish_event validation --character-id <id> --campaign-id c1

    # mesma operação na versão 2 do evento (as duas versões convivem)
    python -m scripts.publish_event validation --character-id <id> --campaign-id c1 --event-version 2

    # carga: N operações distintas, para a fila crescer (demonstração da autoescala)
    python -m scripts.publish_event flood --character-id <id> --campaign-id c1 --count 2000

    # F3 — mesmo envelope (mesmo messageId) 5 vezes
    python -m scripts.publish_event validation --character-id <id> --campaign-id c1 --times 5

    # desfechos da Saga para uma operação
    python -m scripts.publish_event cancelled --character-id <id> --operation-id <op>
    python -m scripts.publish_event acquired  --character-id <id> --operation-id <op>

    # compra na loja: débito e reembolso do dinheiro (o userId precisa ser o dono da ficha)
    python -m scripts.publish_event debit --character-id <id> --campaign-id c1 --user-id <userId> --amount 30
    python -m scripts.publish_event refund --character-id <id> --campaign-id c1 --operation-id <op>

    # F4 — poison message (JSON inválido ou payload inválido)
    python -m scripts.publish_event poison --kind json
    python -m scripts.publish_event poison --kind payload

    # arquivo JSON arbitrário (ex.: contracts/examples/...)
    python -m scripts.publish_event file contracts/examples/character-validation-requested.v1.valid.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Any

from .rabbit_tools import money_request, outcome, publish, validation_request


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    v = sub.add_parser("validation", help="CharacterValidationRequested")
    v.add_argument("--character-id", required=True)
    v.add_argument("--campaign-id", required=True)
    v.add_argument("--operation-id")
    v.add_argument("--deadline-seconds", type=int)
    v.add_argument("--times", type=int, default=1, help="repete o MESMO envelope (mesmo messageId)")
    v.add_argument("--event-version", type=int, choices=[1, 2], default=1, help="versão do evento a publicar")

    fl = sub.add_parser("flood", help="N pedidos de validação distintos (carga para a autoescala)")
    fl.add_argument("--character-id", required=True)
    fl.add_argument("--campaign-id", required=True)
    fl.add_argument("--count", type=int, default=1000)
    fl.add_argument("--event-version", type=int, choices=[1, 2], default=1)

    for kind in ("acquired", "cancelled"):
        o = sub.add_parser(kind, help=f"{'ItemAcquired' if kind == 'acquired' else 'AcquisitionCancelled'}")
        o.add_argument("--character-id", required=True)
        o.add_argument("--operation-id", required=True)
        o.add_argument("--times", type=int, default=1)

    d = sub.add_parser("debit", help="MoneyDebitRequested (pagamento da compra)")
    d.add_argument("--character-id", required=True)
    d.add_argument("--campaign-id", required=True)
    d.add_argument("--user-id", required=True, help="quem compra: precisa ser o dono da ficha")
    d.add_argument("--amount", type=int, required=True)
    d.add_argument("--operation-id")
    d.add_argument("--times", type=int, default=1, help="repete o MESMO envelope (mesmo messageId)")

    r = sub.add_parser("refund", help="MoneyRefundRequested (compensação da compra)")
    r.add_argument("--character-id", required=True)
    r.add_argument("--campaign-id", required=True)
    r.add_argument("--operation-id", required=True)
    r.add_argument("--times", type=int, default=1)

    p = sub.add_parser("poison", help="mensagem que nunca será processada (F4)")
    p.add_argument("--kind", choices=["json", "payload"], default="payload")

    f = sub.add_parser("file", help="publica um arquivo JSON")
    f.add_argument("path", type=Path)
    f.add_argument("--routing-key")
    f.add_argument("--times", type=int, default=1)

    args = parser.parse_args()
    bodies: list[bytes | dict[str, Any]]

    if args.command == "validation":
        envelope = validation_request(
            args.character_id, args.campaign_id, args.operation_id, args.deadline_seconds, args.event_version
        )
        bodies = [envelope] * args.times
    elif args.command == "flood":
        requests = [
            validation_request(args.character_id, args.campaign_id, None, 600, args.event_version) for _ in range(args.count)
        ]
        bodies = list(requests)
        envelope = {"messageId": None, "type": requests[0]["type"] if requests else None}
    elif args.command in ("debit", "refund"):
        operation_id = getattr(args, "operation_id", None) or str(uuid.uuid4())
        envelope = money_request(
            args.command,
            args.character_id,
            args.campaign_id,
            operation_id,
            user_id=getattr(args, "user_id", ""),
            amount=getattr(args, "amount", 0),
        )
        bodies = [envelope] * args.times
    elif args.command in ("acquired", "cancelled"):
        envelope = outcome(args.command, args.character_id, args.operation_id)
        bodies = [envelope] * args.times
    elif args.command == "poison":
        if args.kind == "json":
            bodies = [b"{isto nao e json"]
            envelope = {"messageId": None, "type": "<json inválido>"}
        else:
            envelope = validation_request("p1", "c1")
            envelope["payload"] = {"operationId": str(uuid.uuid4()), "quantity": 0}
            bodies = [envelope]
    else:
        envelope = json.loads(args.path.read_text(encoding="utf-8"))
        bodies = [envelope] * args.times

    asyncio.run(publish(bodies, getattr(args, "routing_key", None)))
    print(
        json.dumps(
            {
                "published": len(bodies),
                "messageId": envelope.get("messageId"),
                "type": envelope.get("type"),
                "operationId": (envelope.get("payload") or {}).get("operationId"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
