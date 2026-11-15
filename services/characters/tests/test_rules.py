from __future__ import annotations

from datetime import timedelta

import pytest

from app.domain.errors import CapacityBelowUsage
from app.domain.models import CapacityHold, HoldStatus, RejectionReason
from app.domain.rules import ensure_max_items_change_allowed, evaluate_validation_request, merge_stat_map

from .conftest import make_character


def _evaluate(character, hold=None, *, now, campaign_id="c1", quantity=1, deadline_at=None):
    return evaluate_validation_request(
        character, hold, campaign_id=campaign_id, quantity=quantity, deadline_at=deadline_at, now=now
    )


def test_aprova_personagem_ativo_com_capacidade(store, clock):
    decision = _evaluate(make_character(store, clock), now=clock())
    assert decision.approved and not decision.replay


@pytest.mark.parametrize(
    ("overrides", "kwargs", "reason"),
    [
        ({"active": False}, {}, RejectionReason.CHARACTER_INACTIVE),
        ({}, {"campaign_id": "outra"}, RejectionReason.CAMPAIGN_MISMATCH),
        ({"max_items": 2, "slots_used": 2}, {}, RejectionReason.CAPACITY_EXCEEDED),
        ({"max_items": 3}, {"quantity": 4}, RejectionReason.CAPACITY_EXCEEDED),
    ],
)
def test_recusas(store, clock, overrides, kwargs, reason):
    decision = _evaluate(make_character(store, clock, **overrides), now=clock(), **kwargs)
    assert not decision.approved
    assert decision.reason is reason


def test_personagem_inexistente(clock):
    assert _evaluate(None, now=clock()).reason is RejectionReason.CHARACTER_NOT_FOUND


def test_prazo_vencido_recusa_antes_de_reservar(store, clock):
    character = make_character(store, clock)
    decision = _evaluate(character, now=clock(), deadline_at=clock() - timedelta(seconds=1))
    assert decision.reason is RejectionReason.DEADLINE_EXPIRED


@pytest.mark.parametrize("status", [HoldStatus.HELD, HoldStatus.COMMITTED])
def test_reserva_existente_e_replay_aprovado(store, clock, status):
    # mesmo sem capacidade livre, a operação já reservada continua aprovada (idempotência por operationId)
    character = make_character(store, clock, max_items=1, slots_used=1)
    hold = CapacityHold("op", "p1", 1, status, clock(), clock())
    decision = _evaluate(character, hold, now=clock())
    assert decision.approved and decision.replay


def test_reserva_liberada_fecha_a_operacao(store, clock):
    hold = CapacityHold("op", "p1", 1, HoldStatus.RELEASED, clock(), clock(), tombstone=True)
    assert _evaluate(make_character(store, clock), hold, now=clock()).reason is RejectionReason.OPERATION_CLOSED


def test_reducao_de_max_items_abaixo_do_uso(store, clock):
    character = make_character(store, clock, max_items=5, slots_used=3)
    ensure_max_items_change_allowed(character, 3)
    with pytest.raises(CapacityBelowUsage):
        ensure_max_items_change_allowed(character, 2)


def test_merge_patch_de_atributos():
    assert merge_stat_map({"forca": 10, "carisma": 8}, {"forca": 12, "carisma": None, "sabedoria": 14}) == {
        "forca": 12,
        "sabedoria": 14,
    }
