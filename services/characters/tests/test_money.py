"""Dinheiro na Saga de compra: débito atômico, idempotência, compensação e reordenação."""

from __future__ import annotations

import threading
import uuid

from app.application.handlers import MessageHandlers, Outcome
from app.domain.models import MoneyStatus

from .conftest import make_character, money_debit_request, money_refund_request


def _ana(store, clock, amount=100, **kw):
    return make_character(store, clock, owner_id="user-ana", currency_amount=amount, **kw)


def _balance(store) -> int:
    return store.get_character("p1").currency_amount


def _last(store):
    return store.outbox[-1].envelope


def test_debito_aprovado_tira_o_valor_e_publica_money_debited(store, clock, handlers):
    _ana(store, clock, amount=100)
    result = handlers.dispatch(money_debit_request(operation_id="op-1", amount=30))
    assert result.outcome is Outcome.APPROVED
    assert _balance(store) == 70
    assert _last(store)["type"] == "rpg.money.debited.v1"
    assert _last(store)["payload"] == {
        "operationId": "op-1",
        "campaignId": "c1",
        "characterId": "p1",
        "userId": "user-ana",
        "amount": 30,
        "balance": 70,
    }
    (entry,) = store.list_money_entries("p1")
    assert (entry.status, entry.amount, entry.kind) == (MoneyStatus.DEBITED, 30, "PURCHASE")


def test_mesmo_message_id_cinco_vezes_debita_uma_vez(store, clock, handlers):
    _ana(store, clock)
    env = money_debit_request(message_id=str(uuid.uuid4()))
    outcomes = [handlers.dispatch(env).outcome for _ in range(5)]
    assert outcomes == [Outcome.APPROVED] + [Outcome.DUPLICATE] * 4
    assert _balance(store) == 70
    assert len(store.outbox) == 1


def test_mesma_operacao_com_outro_message_id_confirma_sem_cobrar_de_novo(store, clock, handlers):
    _ana(store, clock)
    handlers.dispatch(money_debit_request(operation_id="op-1", message_id=str(uuid.uuid4())))
    again = handlers.dispatch(money_debit_request(operation_id="op-1", message_id=str(uuid.uuid4())))
    assert again.outcome is Outcome.APPROVED_REPLAY
    assert _balance(store) == 70
    assert _last(store)["type"] == "rpg.money.debited.v1"


def test_recusas_nao_mexem_no_saldo(store, clock, handlers):
    _ana(store, clock, amount=10)
    cases = [
        (money_debit_request(amount=30), "INSUFFICIENT_FUNDS"),
        (money_debit_request(amount=5, user_id="user-bia"), "NOT_OWNER"),
        (money_debit_request(amount=5, campaign_id="c2"), "CAMPAIGN_MISMATCH"),
        (money_debit_request(amount=5, character_id="fantasma"), "CHARACTER_NOT_FOUND"),
    ]
    for env, reason in cases:
        assert handlers.dispatch(env).outcome is Outcome.REJECTED
        assert _last(store)["type"] == "rpg.money.debit-rejected.v1"
        assert _last(store)["payload"]["reason"] == reason
    assert _balance(store) == 10
    assert store.list_money_entries("p1") == []


def test_personagem_inativo_e_prazo_vencido_sao_recusados(store, clock, handlers):
    _ana(store, clock, active=False)
    handlers.dispatch(money_debit_request(amount=5))
    assert _last(store)["payload"]["reason"] == "CHARACTER_INACTIVE"
    clock.advance(seconds=60)
    handlers.dispatch(money_debit_request(amount=5, deadline_at="2026-11-11T12:00:30Z"))
    assert _last(store)["payload"]["reason"] == "DEADLINE_EXPIRED"
    assert _balance(store) == 100


def test_reembolso_devolve_o_valor_uma_unica_vez(store, clock, handlers):
    _ana(store, clock)
    handlers.dispatch(money_debit_request(operation_id="op-1", amount=30))
    first = handlers.dispatch(money_refund_request("op-1", message_id=str(uuid.uuid4())))
    again = handlers.dispatch(money_refund_request("op-1", message_id=str(uuid.uuid4())))
    assert (first.outcome, again.outcome) == (Outcome.MONEY_REFUNDED, Outcome.ALREADY_APPLIED)
    assert _balance(store) == 100  # 100 - 30 + 30, e não + 60
    assert _last(store)["type"] == "rpg.money.refunded.v1"
    assert store.get_money_entry("p1", "op-1").status is MoneyStatus.REFUNDED


def test_reembolso_antes_do_debito_cria_lapide_e_debito_atrasado_e_recusado(store, clock, handlers):
    _ana(store, clock)
    early = handlers.dispatch(money_refund_request("op-1"))
    assert early.outcome is Outcome.TOMBSTONE_CREATED
    assert _last(store)["payload"]["amount"] == 0

    late = handlers.dispatch(money_debit_request(operation_id="op-1"))
    assert late.outcome is Outcome.REJECTED
    assert _last(store)["payload"]["reason"] == "OPERATION_CLOSED"
    assert _balance(store) == 100  # nada cobrado por uma compra já desfeita


def test_compras_simultaneas_nunca_deixam_saldo_negativo(store, clock):
    """Várias réplicas debitando a mesma ficha ao mesmo tempo: exatamente saldo/preço aprovações."""
    _ana(store, clock, amount=100)
    handlers = MessageHandlers(store, clock=clock)
    requests = [money_debit_request(amount=30) for _ in range(40)]
    results: list[Outcome] = []
    lock = threading.Lock()

    def worker(chunk):
        for env in chunk:
            outcome = handlers.dispatch(env).outcome
            with lock:
                results.append(outcome)

    threads = [threading.Thread(target=worker, args=(requests[i::8],)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(Outcome.APPROVED) == 3  # 3 x 30 = 90 <= 100
    assert results.count(Outcome.REJECTED) == 37
    assert _balance(store) == 10


def test_ficha_antiga_sem_dinheiro_comeca_com_zero(store, clock, handlers):
    make_character(store, clock, owner_id="user-ana")
    handlers.dispatch(money_debit_request(amount=1))
    assert _last(store)["payload"]["reason"] == "INSUFFICIENT_FUNDS"
