"""Organização livre da ficha (blocos em colunas): validação, persistência e PATCH."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.adapters.memory_store import InMemoryObjectStorage
from app.application.characters import CharacterService
from app.application.dto import CharacterCreate, CharacterOut, CharacterPatch, SheetLayout

SHEET = {
    "template": "fantasia",
    "columns": [
        [
            {"id": "hp", "type": "hp"},
            {"id": "mana", "type": "counter", "title": "Pontos de magia", "data": {"current": 4, "max": 6}},
        ],
        [
            {"id": "attrs", "type": "attributes"},
            {"id": "rolls", "type": "dice", "title": "Ataques", "data": {"rolls": [{"label": "Espada", "expr": "1d20+5"}]}},
            {"id": "notes", "type": "text", "title": "Anotações", "data": {"body": "Deve 30 moedas ao taverneiro."}},
        ],
    ],
}
BASE = {"campaignId": "c1", "name": "Lyra", "hp": {"current": 10, "max": 10}}


@pytest.fixture
def service(store, clock):
    return CharacterService(store, InMemoryObjectStorage(), clock=clock)


def test_cria_com_organizacao_e_devolve_igual(service):
    created, _ = service.create(CharacterCreate.model_validate({**BASE, "sheet": SHEET}))
    out = CharacterOut.from_domain(service.get(created.id))
    assert out.sheet is not None
    assert out.sheet["template"] == "fantasia"
    assert [b["type"] for b in out.sheet["columns"][1]] == ["attributes", "dice", "text"]
    assert out.sheet["columns"][0][1]["data"] == {"current": 4, "max": 6}


def test_ficha_sem_organizacao_continua_valida(service):
    created, _ = service.create(CharacterCreate.model_validate(BASE))
    assert service.get(created.id).sheet is None


def test_patch_substitui_e_null_remove(service):
    created, _ = service.create(CharacterCreate.model_validate({**BASE, "sheet": SHEET}))
    smaller = {"columns": [[{"id": "only", "type": "list", "title": "Magias", "data": {"items": ["Luz"]}}]]}
    updated = service.update(created.id, CharacterPatch.model_validate({"sheet": smaller}))
    assert len(updated.sheet["columns"]) == 1 and updated.version == 2
    # mexer só na organização não toca nos atributos
    assert updated.attributes == created.attributes
    cleared = service.update(created.id, CharacterPatch.model_validate({"sheet": None}))
    assert cleared.sheet is None


@pytest.mark.parametrize(
    "sheet",
    [
        {"columns": []},
        {"columns": [[], [], [], []]},
        {"columns": [[{"id": "a", "type": "feitico"}]]},
        {"columns": [[{"id": "a", "type": "text"}, {"id": "a", "type": "text"}]]},
        {"columns": [[{"id": "tem espaco", "type": "text"}]]},
        {"columns": [[{"id": f"b{i}", "type": "text"} for i in range(61)]]},
        {"columns": [[{"id": "a", "type": "text", "data": {"body": "x" * 70_000}}]]},
        {"columns": [[{"id": "a", "type": "text", "campoExtra": 1}]]},
    ],
)
def test_organizacao_invalida(sheet):
    with pytest.raises(ValidationError):
        SheetLayout.model_validate(sheet)
