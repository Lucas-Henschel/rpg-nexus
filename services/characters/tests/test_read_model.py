"""CQRS: o modelo de leitura acompanha o de escrita, é idempotente e pode ser reconstruído."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from app.adapters.memory_store import InMemoryReadModel
from app.application.handlers import Outcome
from app.application.read_model import Projector, RosterQuery, build_summary
from app.domain.models import CapacityHold, HoldStatus

from .conftest import make_character, outcome_event, validation_request


@pytest.fixture
def read_model() -> InMemoryReadModel:
    return InMemoryReadModel()


@pytest.fixture
def projector(store, read_model, clock) -> Projector:
    return Projector(store, read_model, clock=clock)


def _only(read_model, campaign_id="c1"):
    (summary,) = read_model.list_campaign(campaign_id)
    return summary


def test_resumo_e_calculado_a_partir_da_ficha_e_das_reservas(store, clock):
    character = make_character(store, clock, max_items=5).evolve(slots_used=2)
    holds = [
        CapacityHold("op-1", "p1", 1, HoldStatus.HELD, clock(), clock()),
        CapacityHold("op-2", "p1", 1, HoldStatus.COMMITTED, clock(), clock()),
        CapacityHold("op-3", "p1", 1, HoldStatus.RELEASED, clock(), clock()),
        CapacityHold("op-4", "p1", 1, HoldStatus.RELEASED, clock(), clock(), tombstone=True),
    ]
    summary = build_summary(character, holds, clock())
    assert (summary.slots_used, summary.slots_available) == (2, 3)
    assert (summary.holds_held, summary.holds_committed, summary.holds_released) == (1, 1, 1)  # lápide não conta


def test_projecao_de_personagem_inexistente_nao_grava_nada(projector, read_model):
    assert projector.project("fantasma") is False
    assert read_model.list_campaign("c1") == []


def test_saga_reflete_no_modelo_de_leitura(store, clock, handlers, projector, read_model):
    make_character(store, clock, max_items=3)
    dispatch = projector.after(handlers.dispatch)

    dispatch(validation_request(operation_id="op-1", message_id=str(uuid.uuid4())))
    dispatch(validation_request(operation_id="op-2", message_id=str(uuid.uuid4())))
    summary = _only(read_model)
    assert (summary.slots_used, summary.slots_available, summary.holds_held) == (2, 1, 2)

    clock.advance(seconds=1)
    dispatch(outcome_event("acquired", "op-1", message_id=str(uuid.uuid4())))
    clock.advance(seconds=1)
    dispatch(outcome_event("cancelled", "op-2", message_id=str(uuid.uuid4())))
    summary = _only(read_model)
    assert (summary.holds_held, summary.holds_committed, summary.holds_released) == (0, 1, 1)
    assert (summary.slots_used, summary.slots_available) == (1, 2)  # a compensação devolveu a vaga


def test_mensagem_duplicada_tambem_projeta(store, clock, handlers, projector, read_model):
    """Queda entre gravar e projetar: a reentrega não repete o efeito, mas atualiza a leitura."""
    make_character(store, clock)
    request = validation_request(operation_id="op-1")
    assert handlers.dispatch(request).outcome is Outcome.APPROVED  # efeito aplicado, projeção "perdida"
    assert read_model.list_campaign("c1") == []

    assert projector.after(handlers.dispatch)(request).outcome is Outcome.DUPLICATE
    assert _only(read_model).holds_held == 1
    assert store.get_character("p1").slots_used == 1


def test_projecao_mais_antiga_nao_sobrescreve_a_mais_nova(store, clock, read_model):
    character = make_character(store, clock)
    novo = build_summary(character.evolve(name="Depois"), [], clock() + timedelta(seconds=5))
    antigo = build_summary(character.evolve(name="Antes"), [], clock())
    assert read_model.put_summary(novo) is True
    assert read_model.put_summary(antigo) is False
    assert _only(read_model).name == "Depois"


def test_falha_no_lado_de_leitura_nao_propaga(store, clock, handlers):
    class Quebrado(InMemoryReadModel):
        def put_summary(self, summary):
            raise RuntimeError("tabela de leitura fora do ar")

    make_character(store, clock)
    projector = Projector(store, Quebrado(), clock=clock)
    result = projector.after(handlers.dispatch)(validation_request(operation_id="op-1"))
    assert result.outcome is Outcome.APPROVED  # a escrita já confirmada não é afetada
    assert projector.stats["failed"] == 1


def test_rebuild_reconstroi_a_campanha_inteira(store, clock, projector, read_model):
    make_character(store, clock, id="p1", name="Lyra")
    make_character(store, clock, id="p2", name="Bram")
    make_character(store, clock, id="p3", name="Outra campanha", campaign_id="c2")
    assert projector.rebuild_campaign("c1") == 2
    roster = RosterQuery(read_model).by_campaign("c1")
    assert [s.name for s in roster.items] == ["Bram", "Lyra"]
    assert roster.totals["characters"] == 2
    assert read_model.list_campaign("c2") == []
