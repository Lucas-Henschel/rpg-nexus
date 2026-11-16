"""API HTTP ponta a ponta (FastAPI TestClient, backend em memória). Requer requirements-dev.txt."""

from __future__ import annotations

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from app.bootstrap import build_container  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

from .conftest import validation_request  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
BODY = {"campaignId": "c1", "name": "Lyra", "hp": {"current": 10, "max": 10}, "attributes": {"forca": 15}, "maxItems": 3}


@pytest.fixture
def container():
    settings = Settings.from_env(
        {
            "STORE_BACKEND": "memory",
            "STORAGE_BACKEND": "memory",
            "MESSAGING_ENABLED": "false",
            "LOG_FORMAT": "text",
            "PORTRAIT_MAX_BYTES": "2048",
        }
    )
    return build_container(settings)


@pytest.fixture
def api(container):
    with TestClient(create_app(container=container)) as client:
        yield client


def _create(api, **overrides):
    response = api.post("/characters", json={**BODY, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


def test_health_e_ready(api):
    assert api.get("/health").json()["status"] == "ok"
    ready = api.get("/ready").json()
    assert ready["status"] == "ready" and ready["checks"]["rabbitmq"] == "disabled"


def test_crud_basico(api):
    created = _create(api)
    assert created["capacity"] == {"maxItems": 3, "slotsUsed": 0, "slotsAvailable": 3}
    fetched = api.get(f"/characters/{created['id']}")
    assert fetched.status_code == 200 and fetched.headers["ETag"] == '"1"'

    patched = api.patch(f"/characters/{created['id']}", json={"skills": {"furtividade": 3}}, headers={"If-Match": '"1"'})
    assert patched.status_code == 200 and patched.json()["version"] == 2

    stale = api.patch(f"/characters/{created['id']}", json={"name": "X"}, headers={"If-Match": '"1"'})
    assert stale.status_code == 412 and stale.json()["error"]["code"] == "VERSION_CONFLICT"

    listing = api.get("/characters", params={"campaignId": "c1"}).json()
    assert [c["id"] for c in listing["items"]] == [created["id"]]


def test_idempotency_key(api):
    first = api.post("/characters", json=BODY, headers={"Idempotency-Key": "abc"})
    second = api.post("/characters", json=BODY, headers={"Idempotency-Key": "abc"})
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["id"] == second.json()["id"]


def test_erros_padronizados(api):
    missing = api.get("/characters/nao-existe")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "CHARACTER_NOT_FOUND"
    invalid = api.post("/characters", json={**BODY, "hp": {"current": 99, "max": 1}})
    assert invalid.status_code == 422 and invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    bad_header = api.patch(f"/characters/{_create(api)['id']}", json={"name": "Y"}, headers={"If-Match": "abc"})
    assert bad_header.status_code == 400


def test_reducao_de_capacidade_abaixo_do_uso(api, container):
    created = _create(api, maxItems=2)
    container.handlers.handle_validation_requested(validation_request(character_id=created["id"]))
    response = api.patch(f"/characters/{created['id']}", json={"maxItems": 0})
    assert response.status_code == 409 and response.json()["error"]["code"] == "CAPACITY_BELOW_USAGE"
    holds = api.get(f"/characters/{created['id']}/holds").json()["items"]
    assert len(holds) == 1 and holds[0]["status"] == "HELD"


def test_retrato_upload_pelo_backend(api):
    created = _create(api)
    up = api.put(f"/characters/{created['id']}/portrait", content=PNG, headers={"Content-Type": "image/png"})
    assert up.status_code == 200, up.text
    assert up.json()["portrait"]["sizeBytes"] == len(PNG)
    content = api.get(f"/characters/{created['id']}/portrait/content")
    assert content.content == PNG and content.headers["content-type"] == "image/png"
    assert api.get(f"/characters/{created['id']}/portrait").json()["url"]

    too_big = api.put(f"/characters/{created['id']}/portrait", content=PNG * 100, headers={"Content-Type": "image/png"})
    assert too_big.status_code == 413
    wrong = api.put(f"/characters/{created['id']}/portrait", content=b"GIF89a....", headers={"Content-Type": "image/png"})
    assert wrong.status_code == 422


def test_retrato_presignado(api, container):
    created = _create(api)
    presigned = api.post(f"/characters/{created['id']}/portrait-upload", json={"contentType": "image/png"}).json()
    assert presigned["method"] == "PUT" and presigned["key"] == f"characters/{created['id']}/portrait"
    container.storage.put(presigned["key"], PNG, "image/png")  # simula o PUT do navegador no S3
    confirmed = api.post(presigned["confirmUrl"])
    assert confirmed.status_code == 200 and confirmed.json()["portrait"]["key"] == presigned["key"]


def test_organizacao_livre_da_ficha(api):
    sheet = {
        "template": "em-branco",
        "columns": [[{"id": "notes", "type": "text", "title": "Anotações", "data": {"body": "oi"}}], []],
    }
    created = _create(api, sheet=sheet)
    assert created["sheet"]["columns"][0][0]["data"] == {"body": "oi"}
    patched = api.patch(f"/characters/{created['id']}", json={"sheet": {"columns": [[]]}})
    assert patched.status_code == 200 and patched.json()["sheet"]["columns"] == [[]]
    invalid = api.patch(f"/characters/{created['id']}", json={"sheet": {"columns": [[{"id": "x", "type": "nada"}]]}})
    assert invalid.status_code == 422
    assert _create(api)["sheet"] is None


def test_endpoints_internos(api, container):
    created = _create(api)
    env = validation_request(character_id=created["id"])
    container.handlers.dispatch(env)
    assert api.get("/internal/outbox").json()["pending"] == 1
    inbox = api.get(f"/internal/inbox/{env.messageId}").json()
    assert inbox["outcome"] == "APPROVED"
    assert api.get("/internal/messaging").json() == {"enabled": False}


def test_correlation_id_e_cors(api):
    response = api.get("/health", headers={"X-Correlation-Id": "abc-123"})
    assert response.headers["X-Correlation-Id"] == "abc-123"
    preflight = api.options("/characters", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert preflight.headers.get("access-control-allow-origin") == "http://localhost:5173"


# --- CQRS: consulta pelo modelo de leitura ----------------------------------------------------------


def test_roster_le_do_modelo_de_leitura_e_acompanha_as_escritas(api, container):
    lyra = _create(api, name="Lyra", maxItems=3)
    _create(api, name="Bram", maxItems=1)
    _create(api, name="De outra campanha", campaignId="c2")

    roster = api.get("/campaigns/c1/roster").json()
    assert roster["source"] == "read-model"
    assert [item["name"] for item in roster["items"]] == ["Bram", "Lyra"]
    assert roster["totals"] == {
        "characters": 2,
        "active": 2,
        "slotsUsed": 0,
        "slotsAvailable": 4,
        "holdsHeld": 0,
        "holdsCommitted": 0,
        "holdsReleased": 0,
    }

    api.patch(f"/characters/{lyra['id']}", json={"name": "Lyra Ventobravo", "active": False})
    dispatch = container.projector.after(container.handlers.dispatch)
    bram = next(item for item in roster["items"] if item["name"] == "Bram")
    dispatch(validation_request(character_id=bram["characterId"], operation_id="op-1"))

    roster = api.get("/campaigns/c1/roster").json()
    assert [item["name"] for item in roster["items"]] == ["Bram", "Lyra Ventobravo"]
    assert roster["totals"]["active"] == 1
    assert roster["totals"]["holdsHeld"] == 1 and roster["totals"]["slotsAvailable"] == 3
    assert roster["items"][0]["capacity"] == {"maxItems": 1, "slotsUsed": 1, "slotsAvailable": 0}


def test_roster_de_campanha_sem_personagens_e_vazio(api):
    roster = api.get("/campaigns/vazia/roster").json()
    assert roster["items"] == [] and roster["totals"]["characters"] == 0


def test_rebuild_recupera_modelo_de_leitura_perdido(api, container):
    _create(api, name="Lyra")
    container.read_model._summaries.clear()  # simula a tabela de leitura apagada
    assert api.get("/campaigns/c1/roster").json()["items"] == []

    rebuilt = api.post("/internal/read-model/rebuild", params={"campaignId": "c1"}).json()
    assert rebuilt["rebuilt"] == 1
    assert [item["name"] for item in api.get("/campaigns/c1/roster").json()["items"]] == ["Lyra"]


def test_ready_inclui_o_modelo_de_leitura(api):
    assert api.get("/ready").json()["checks"]["readModel"] == "ok"
