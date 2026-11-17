"""Comportamento do S2 como participante da Saga (idempotência, compensação, reordenação, concorrência)."""

from __future__ import annotations

import threading
import uuid

import pytest

from app.application.handlers import MessageHandlers, Outcome
from app.domain.models import HoldStatus
from app.messaging.envelope import Envelope
from app.messaging.errors import PoisonMessage

from .conftest import make_character, outcome_event, validation_request, validation_request_v2


def _last_event(store):
    return store.outbox[-1].envelope


def test_aprovacao_reserva_capacidade_e_publica_validated(store, clock, handlers):
    make_character(store, clock, max_items=3)
    env = validation_request(operation_id="op-1")

    result = handlers.handle_validation_requested(env)

    assert result.outcome is Outcome.APPROVED
    assert store.get_character("p1").slots_used == 1
    assert store.get_hold("p1", "op-1").status is HoldStatus.HELD
    event = _last_event(store)
    assert event["type"] == "rpg.character.validated.v1"
    assert event["correlationId"] == "op-1"
    assert event["payload"]["slotsRemaining"] == 2
    assert store.get_inbox(str(env.messageId)).outcome == "APPROVED"


def test_recusa_publica_rejected_sem_alterar_capacidade(store, clock, handlers):
    make_character(store, clock, active=False)
    result = handlers.handle_validation_requested(validation_request(operation_id="op-2"))

    assert result.outcome is Outcome.REJECTED
    assert store.get_character("p1").slots_used == 0
    assert store.get_hold("p1", "op-2") is None
    event = _last_event(store)
    assert event["type"] == "rpg.character.rejected.v1"
    assert event["payload"]["reason"] == "CHARACTER_INACTIVE"


def test_F3_mesmo_message_id_cinco_vezes_aplica_um_efeito(store, clock, handlers):
    make_character(store, clock)
    env = validation_request(operation_id="op-3")

    outcomes = [handlers.handle_validation_requested(env).outcome for _ in range(5)]

    assert outcomes == [Outcome.APPROVED] + [Outcome.DUPLICATE] * 4
    assert store.get_character("p1").slots_used == 1
    assert len(store.outbox) == 1


def test_mesma_operacao_com_outro_message_id_nao_reserva_duas_vezes(store, clock, handlers):
    make_character(store, clock)
    first = validation_request(operation_id="op-4")
    second = validation_request(operation_id="op-4")  # S3 reenviou com novo messageId

    assert handlers.handle_validation_requested(first).outcome is Outcome.APPROVED
    assert handlers.handle_validation_requested(second).outcome is Outcome.APPROVED_REPLAY
    assert store.get_character("p1").slots_used == 1
    assert [e.envelope["type"] for e in store.outbox] == ["rpg.character.validated.v1"] * 2


def test_capacidade_esgotada(store, clock, handlers):
    make_character(store, clock, max_items=2)
    outcomes = [handlers.handle_validation_requested(validation_request()).outcome for _ in range(3)]
    assert outcomes == [Outcome.APPROVED, Outcome.APPROVED, Outcome.REJECTED]
    assert _last_event(store)["payload"]["reason"] == "CAPACITY_EXCEEDED"


def test_item_adquirido_confirma_reserva(store, clock, handlers):
    make_character(store, clock)
    handlers.handle_validation_requested(validation_request(operation_id="op-5"))
    acquired = outcome_event("acquired", "op-5")

    assert handlers.handle_item_acquired(acquired).outcome is Outcome.HOLD_COMMITTED
    assert handlers.handle_item_acquired(acquired).outcome is Outcome.DUPLICATE
    assert store.get_hold("p1", "op-5").status is HoldStatus.COMMITTED
    assert store.get_character("p1").slots_used == 1  # item agora ocupa a vaga


def test_F1_cancelamento_compensa_liberando_capacidade(store, clock, handlers):
    make_character(store, clock, max_items=1)
    handlers.handle_validation_requested(validation_request(operation_id="op-6"))
    assert store.get_character("p1").slots_available == 0

    cancelled = outcome_event("cancelled", "op-6")
    assert handlers.handle_acquisition_cancelled(cancelled).outcome is Outcome.HOLD_RELEASED
    assert handlers.handle_acquisition_cancelled(cancelled).outcome is Outcome.DUPLICATE
    assert store.get_character("p1").slots_available == 1
    assert store.get_hold("p1", "op-6").status is HoldStatus.RELEASED

    # capacidade devolvida pode ser usada por outra operação
    assert handlers.handle_validation_requested(validation_request()).outcome is Outcome.APPROVED


def test_cancelamento_reentregue_com_outro_message_id_nao_devolve_duas_vezes(store, clock, handlers):
    make_character(store, clock, max_items=2)
    handlers.handle_validation_requested(validation_request(operation_id="op-7"))
    handlers.handle_acquisition_cancelled(outcome_event("cancelled", "op-7"))
    result = handlers.handle_acquisition_cancelled(outcome_event("cancelled", "op-7"))

    assert result.outcome is Outcome.ALREADY_APPLIED
    assert store.get_character("p1").slots_used == 0


def test_F7_cancelamento_antes_do_pedido_cria_lapide_e_pedido_atrasado_e_recusado(store, clock, handlers):
    make_character(store, clock)
    assert handlers.handle_acquisition_cancelled(outcome_event("cancelled", "op-8")).outcome is Outcome.TOMBSTONE_CREATED

    late = handlers.handle_validation_requested(validation_request(operation_id="op-8"))

    assert late.outcome is Outcome.REJECTED
    assert _last_event(store)["payload"]["reason"] == "OPERATION_CLOSED"
    assert store.get_character("p1").slots_used == 0  # nenhuma capacidade retida para operação morta


def test_pedido_apos_deadline_nao_reserva(store, clock, handlers):
    make_character(store, clock)
    clock.advance(seconds=60)
    result = handlers.handle_validation_requested(validation_request(deadline_at="2026-11-11T12:00:30Z"))
    assert result.outcome is Outcome.REJECTED
    assert _last_event(store)["payload"]["reason"] == "DEADLINE_EXPIRED"


# --- Versionamento de eventos: v1 e v2 de CharacterValidationRequested convivem ------------------


def test_v1_e_v2_do_pedido_convivem_no_mesmo_consumidor(store, clock, handlers):
    make_character(store, clock, max_items=5)
    antigo = handlers.dispatch(validation_request(operation_id="op-v1", message_id=str(uuid.uuid4())))
    novo = handlers.dispatch(validation_request_v2(operation_id="op-v2", message_id=str(uuid.uuid4())))
    assert antigo.outcome is Outcome.APPROVED and novo.outcome is Outcome.APPROVED
    assert store.get_character("p1").slots_used == 2
    statuses = {h.operation_id: h.status for h in store.list_holds("p1")}
    assert statuses == {"op-v1": HoldStatus.HELD, "op-v2": HoldStatus.HELD}
    # a resposta tem o mesmo contrato para as duas versões do pedido
    assert {r.type for r in store.outbox} == {"rpg.character.validated.v1"}


def test_v2_exige_expires_at_e_nao_aceita_o_campo_antigo(handlers):
    sem_prazo = validation_request_v2(expires_at=None)
    with pytest.raises(PoisonMessage):
        handlers.dispatch(sem_prazo)
    com_campo_da_v1 = sem_prazo.model_copy(update={"payload": {**sem_prazo.payload, "deadlineAt": "2026-11-11T12:05:00Z"}})
    with pytest.raises(PoisonMessage):
        handlers.dispatch(com_campo_da_v1)


def test_v2_com_prazo_vencido_nao_reserva(store, clock, handlers):
    make_character(store, clock)
    clock.advance(seconds=60)
    result = handlers.dispatch(validation_request_v2(expires_at="2026-11-11T12:00:30Z"))
    assert result.outcome is Outcome.REJECTED
    assert _last_event(store)["payload"]["reason"] == "DEADLINE_EXPIRED"
    assert store.get_character("p1").slots_used == 0


def test_mesma_operacao_pedida_em_v1_e_depois_em_v2_reserva_uma_vez(store, clock, handlers):
    make_character(store, clock)
    handlers.dispatch(validation_request(operation_id="op-1", message_id=str(uuid.uuid4())))
    repetido = handlers.dispatch(validation_request_v2(operation_id="op-1", message_id=str(uuid.uuid4())))
    assert repetido.outcome is Outcome.APPROVED_REPLAY
    assert store.get_character("p1").slots_used == 1


def test_inbox_registra_a_versao_do_evento_recebido(store, clock, handlers):
    make_character(store, clock)
    message_id = str(uuid.uuid4())
    handlers.dispatch(validation_request_v2(message_id=message_id))
    assert store.get_inbox(message_id).type == "rpg.character.validation-requested.v2"


def test_anomalias_sao_registradas_sem_alterar_capacidade(store, clock, handlers):
    make_character(store, clock)
    assert handlers.handle_item_acquired(outcome_event("acquired", "op-x")).outcome is Outcome.ANOMALY
    handlers.handle_validation_requested(validation_request(operation_id="op-y"))
    handlers.handle_item_acquired(outcome_event("acquired", "op-y"))
    assert handlers.handle_acquisition_cancelled(outcome_event("cancelled", "op-y")).outcome is Outcome.ANOMALY
    assert store.get_character("p1").slots_used == 1


def test_dispatch_tipo_desconhecido_e_poison(handlers):
    env = validation_request()
    with pytest.raises(PoisonMessage):
        handlers.dispatch(env.model_copy(update={"type": "rpg.unknown.thing.v1"}))


def test_dispatch_versao_desconhecida_e_poison(handlers):
    env = validation_request()
    with pytest.raises(PoisonMessage):
        handlers.dispatch(env.model_copy(update={"version": 2}))


def test_payload_invalido_e_poison(handlers):
    env = validation_request()
    bad = Envelope.model_validate({**env.model_dump(mode="json"), "payload": {"operationId": "x", "quantity": 0}})
    with pytest.raises(PoisonMessage):
        handlers.dispatch(bad)


def test_leitor_tolerante_ignora_campos_extras(store, clock, handlers):
    make_character(store, clock)
    env = validation_request()
    extra = Envelope.model_validate({**env.model_dump(mode="json"), "payload": {**env.payload, "campoNovoDoProdutor": "ok"}})
    assert handlers.dispatch(extra).outcome is Outcome.APPROVED


def test_notifica_outbox_apos_gravar(store, clock):
    calls = []
    handlers = MessageHandlers(store, clock=clock, on_outbox_write=lambda: calls.append(1))
    make_character(store, clock)
    handlers.handle_validation_requested(validation_request())
    assert calls == [1]


def test_R2_concorrencia_entre_replicas_nunca_excede_capacidade(store, clock):
    """Várias "réplicas" (threads) disputando a mesma ficha: exatamente maxItems aprovações."""
    make_character(store, clock, max_items=10)
    handlers = MessageHandlers(store, clock=clock)
    requests = [validation_request(operation_id=str(uuid.uuid4())) for _ in range(100)]
    results: list[Outcome] = []
    lock = threading.Lock()

    def worker(chunk):
        for env in chunk:
            outcome = handlers.handle_validation_requested(env).outcome
            with lock:
                results.append(outcome)

    threads = [threading.Thread(target=worker, args=(requests[i::8],)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(Outcome.APPROVED) == 10
    assert results.count(Outcome.REJECTED) == 90
    character = store.get_character("p1")
    assert character.slots_used == 10 and character.slots_available == 0
    assert len(store.outbox) == 100
