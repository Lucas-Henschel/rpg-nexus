"""Mostra, em tempo real, os eventos publicados pelo S2 (ou qualquer routing key).

python -m scripts.watch_events                       # character.validated.v1 + character.rejected.v1
python -m scripts.watch_events --keys "character.#"  # curingas do exchange topic
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from .rabbit_tools import EventListener


async def _watch(keys: list[str], seconds: float) -> None:
    async with EventListener(keys) as listener:
        print(f"ouvindo {keys} … (Ctrl+C para sair)", flush=True)
        seen = 0
        loop = asyncio.get_running_loop()
        deadline = loop.time() + seconds if seconds else None
        while deadline is None or loop.time() < deadline:
            await asyncio.sleep(0.2)
            for event in listener.events[seen:]:
                print(json.dumps(event, ensure_ascii=False, indent=2), flush=True)
            seen = len(listener.events)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--keys", nargs="+", default=["character.validated.v1", "character.rejected.v1"])
    parser.add_argument("--seconds", type=float, default=0, help="0 = sem limite")
    args = parser.parse_args()
    try:
        asyncio.run(_watch(args.keys, args.seconds))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
