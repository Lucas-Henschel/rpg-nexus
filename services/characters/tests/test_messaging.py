"""Envelope, política de retry, injeção de falha e relay da outbox (sem broker real)."""

from __future__ import annotations

import asyncio
import json

import pytest

from app.application.handlers import MessageHandlers
from app.messaging.envelope import build_envelope, format_timestamp, parse_envelope
from app.messaging.errors import PoisonMessage, TransientProcessingError
from app.messaging.faults import FaultInjector
from app.messaging.outbox_relay import OutboxRelay
from app.messaging.retry import RetryAction, RetryPolicy, read_retry_count

from .conftest import make_character, validation_request

# --- envelope ---------------------------------------------------------------------------------


def test_envelope_round_trip(clock):
    raw = build_envelope(
        event_type="rpg.character.validated.v1", version=1, correlation_id="op", payload={"a": 1}, occurred_at=clock()
    )
    parsed = parse_envelope(json.dumps(raw).encode())
    assert str(parsed.messageId) == raw["messageId"]
    assert raw["occurredAt"] == "2026-11-11T12:00:00.000Z"


@pytest.mark.parametrize(
    "body",
    [
        b"isto nao e json",
        b"[]",
        b'{"messageId": "x"}',
        json.dumps(
            {
                "messageId": "5f0c2b9e-6a1d-4f3b-8c7e-1d2a3b4c5d6e",
                "correlationId": "op",
                "type": "SemPrefixo",
                "version": 1,
                "occurredAt": "2026-11-11T12:00:00Z",
                "payload": {},
            }
        ).encode(),
    ],
)
def test_envelope_invalido_e_poison(body):
    with pytest.raises(PoisonMessage):
        parse_envelope(body)


def test_occurred_at_sem_fuso_e_rejeitado():
    body = json.dumps(
        {
            "messageId": "5f0c2b9e-6a1d-4f3b-8c7e-1d2a3b4c5d6e",
            "correlationId": "op",
            "type": "rpg.a.v1",
            "version": 1,
            "occurredAt": "2026-11-11T12:00:00",
            "payload": {},
        }
    )
    with pytest.raises(PoisonMessage):
        parse_envelope(body)


def test_format_timestamp_converte_para_utc():
    from datetime import datetime, timedelta, timezone

    assert format_timestamp(datetime(2026, 11, 11, 9, 0, tzinfo=timezone(timedelta(hours=-3)))) == "2026-11-11T12:00:00.000Z"


# --- retry ------------------------------------------------------------------------------------


def test_F4_poison_passa_por_n_tentativas_e_vai_para_dlq():
    policy = RetryPolicy(max_retries=3, base_delay_ms=1000, max_delay_ms=15000)
    decisions = [policy.decide(PoisonMessage("x"), n) for n in range(4)]
    assert [d.action for d in decisions] == [RetryAction.RETRY] * 3 + [RetryAction.DEAD_LETTER]
    assert [d.delay_ms for d in decisions[:3]] == [1000, 2000, 4000]
    assert [d.next_attempt for d in decisions[:3]] == [1, 2, 3]


def test_poison_direto_para_dlq_quando_configurado():
    decision = RetryPolicy(poison_direct_to_dlq=True).decide(PoisonMessage("x"), 0)
    assert decision.action is RetryAction.DEAD_LETTER


def test_erro_transitorio_respeita_limite_e_teto_do_backoff():
    policy = RetryPolicy(max_retries=10, base_delay_ms=1000, max_delay_ms=5000)
    assert policy.decide(TransientProcessingError("x"), 6).delay_ms == 5000
    assert policy.decide(TransientProcessingError("x"), 10).action is RetryAction.DEAD_LETTER


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        (None, 0),
        ({}, 0),
        ({"x-retry-count": 2}, 2),
        ({"x-retry-count": "3"}, 3),
        ({"x-retry-count": "lixo"}, 0),
        ({"x-retry-count": -5}, 0),
    ],
)
def test_leitura_do_contador(headers, expected):
    assert read_retry_count(headers) == expected


# --- falha injetada (F2) ----------------------------------------------------------------------


def test_fault_once_derruba_uma_unica_vez(tmp_path):
    exits: list[int] = []
    fault = FaultInjector("once", str(tmp_path / "marker"), exit_fn=exits.append)
    env = validation_request()
    fault.before_ack(env)
    fault.before_ack(env)  # "após o restart": marcador existe
    assert exits == [137]


def test_fault_off_nao_faz_nada(tmp_path):
    exits: list[int] = []
    FaultInjector("off", str(tmp_path / "m"), exit_fn=exits.append).before_ack(validation_request())
    assert exits == []


# --- relay da outbox --------------------------------------------------------------------------


class FakePublisher:
    def __init__(self, fail_after: int | None = None) -> None:
        self.sent: list[str] = []
        self.fail_after = fail_after
        self.is_connected = True

    async def wait_connected(self, timeout: float) -> bool:
        return self.is_connected

    async def publish(self, record) -> None:
        if self.fail_after is not None and len(self.sent) >= self.fail_after:
            raise ConnectionError("broker fora")
        self.sent.append(record.message_id)


def _fill_outbox(store, clock, n: int) -> None:
    make_character(store, clock, max_items=100)
    handlers = MessageHandlers(store, clock=clock)
    for _ in range(n):
        handlers.handle_validation_requested(validation_request())


def test_relay_publica_e_marca_published(store, clock):
    _fill_outbox(store, clock, 3)
    publisher = FakePublisher()
    relay = OutboxRelay(store, publisher, batch_size=10, clock=clock)

    assert asyncio.run(relay.run_once()) == 3
    assert asyncio.run(relay.run_once()) == 0
    assert len(publisher.sent) == 3
    assert store.outbox_stats().pending == 0


def test_F6_broker_fora_mantem_eventos_pendentes_e_escoa_depois(store, clock):
    _fill_outbox(store, clock, 5)
    failing = FakePublisher(fail_after=2)
    relay = OutboxRelay(store, failing, batch_size=10, clock=clock)

    asyncio.run(relay.run_once())
    assert store.outbox_stats().pending == 3  # nada perdido; claims liberados

    recovered = FakePublisher()
    asyncio.run(OutboxRelay(store, recovered, batch_size=10, clock=clock).run_once())
    assert store.outbox_stats().pending == 0
    assert set(failing.sent) | set(recovered.sent) == {r.message_id for r in store.outbox}


def test_lease_impede_duas_replicas_de_publicar_o_mesmo_evento(store, clock):
    _fill_outbox(store, clock, 4)
    first = store.claim_outbox(10, 30, "replica-a", clock())
    second = store.claim_outbox(10, 30, "replica-b", clock())
    assert len(first) == 4 and second == []

    clock.advance(seconds=31)  # réplica A morreu sem publicar: lease expira e B assume
    assert len(store.claim_outbox(10, 30, "replica-b", clock())) == 4
