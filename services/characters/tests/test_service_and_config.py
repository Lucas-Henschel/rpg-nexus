"""Casos de uso HTTP (sem FastAPI), DTOs e configuração."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.adapters.memory_store import InMemoryObjectStorage
from app.application.characters import CharacterService, detect_image_type
from app.application.dto import CharacterCreate, CharacterPatch
from app.application.handlers import MessageHandlers
from app.config import ConfigError, Settings
from app.domain.errors import CapacityBelowUsage, CharacterNotFound, IdempotencyKeyReused, InvalidPortrait, VersionConflict

from .conftest import validation_request

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def service(store, clock):
    return CharacterService(store, InMemoryObjectStorage(), clock=clock, portrait_max_bytes=4096)


def _create(service, **overrides):
    data = {"campaignId": "c1", "name": "Lyra", "hp": {"current": 10, "max": 10}, "attributes": {"forca": 15}}
    data.update(overrides)
    return service.create(CharacterCreate.model_validate(data))[0]


def test_cria_com_max_items_padrao(service):
    c = _create(service)
    assert c.max_items == 10 and c.slots_available == 10 and c.version == 1


def test_idempotency_key_devolve_a_mesma_ficha(service):
    body = CharacterCreate.model_validate({"campaignId": "c1", "name": "Lyra", "hp": {"current": 1, "max": 1}})
    first, created = service.create(body, "chave-1")
    again, created_again = service.create(body, "chave-1")
    assert created and not created_again and first.id == again.id


def test_idempotency_key_reutilizada_com_outro_corpo(service):
    service.create(CharacterCreate.model_validate({"campaignId": "c1", "name": "A", "hp": {"current": 1, "max": 1}}), "k")
    with pytest.raises(IdempotencyKeyReused):
        service.create(CharacterCreate.model_validate({"campaignId": "c1", "name": "B", "hp": {"current": 1, "max": 1}}), "k")


def test_patch_merge_e_versao(service):
    c = _create(service)
    updated = service.update(
        c.id, CharacterPatch.model_validate({"attributes": {"forca": None, "sabedoria": 14}, "name": "Lyra II"})
    )
    assert updated.attributes == {"sabedoria": 14}
    assert updated.name == "Lyra II" and updated.version == 2


def test_patch_com_versao_desatualizada(service):
    c = _create(service)
    service.update(c.id, CharacterPatch.model_validate({"name": "X"}))
    with pytest.raises(VersionConflict):
        service.update(c.id, CharacterPatch.model_validate({"name": "Y"}), expected_version=1)


def test_reservas_nao_alteram_versao_do_perfil(service, store, clock):
    c = _create(service)
    MessageHandlers(store, clock=clock).handle_validation_requested(validation_request(character_id=c.id))
    after = service.get(c.id)
    assert after.version == 1 and after.slots_used == 1
    # edição com If-Match baseada na versão anterior continua válida
    assert service.update(c.id, CharacterPatch.model_validate({"name": "Z"}), expected_version=1).version == 2


def test_reduzir_max_items_abaixo_do_reservado(service, store, clock):
    c = _create(service, maxItems=3)
    handlers = MessageHandlers(store, clock=clock)
    for _ in range(2):
        handlers.handle_validation_requested(validation_request(character_id=c.id))
    with pytest.raises(CapacityBelowUsage):
        service.update(c.id, CharacterPatch.model_validate({"maxItems": 1}))
    updated = service.update(c.id, CharacterPatch.model_validate({"maxItems": 5}))
    assert (updated.max_items, updated.slots_used, updated.slots_available) == (5, 2, 3)


def test_personagem_inexistente(service):
    with pytest.raises(CharacterNotFound):
        service.get("nao-existe")


def test_listagem_paginada(service):
    for i in range(5):
        _create(service, name=f"P{i}")
    _create(service, campaignId="outra")
    page1 = service.list_by_campaign("c1", limit=3)
    page2 = service.list_by_campaign("c1", limit=3, cursor=page1.next_cursor)
    assert len(page1.items) == 3 and len(page2.items) == 2 and page2.next_cursor is None


def test_upload_de_retrato_valida_assinatura(service):
    c = _create(service)
    updated = service.upload_portrait(c.id, PNG, "image/png")
    assert updated.portrait.key == f"characters/{c.id}/portrait"
    assert service.portrait_content(c.id) == (PNG, "image/png")
    with pytest.raises(InvalidPortrait):
        service.upload_portrait(c.id, b"GIF89a" + b"\x00" * 10, "image/png")
    with pytest.raises(InvalidPortrait):
        service.upload_portrait(c.id, PNG * 100, "image/png")  # acima do limite


def test_confirmacao_de_upload_presignado_remove_arquivo_invalido(service):
    c = _create(service)
    presigned = service.request_portrait_upload(c.id, "image/png")
    service._storage.put(presigned.key, b"nao-e-imagem", "image/png")  # simula PUT do navegador
    with pytest.raises(InvalidPortrait):
        service.confirm_portrait(c.id)
    assert service._storage.head(presigned.key) is None
    service._storage.put(presigned.key, PNG, "image/png")
    assert service.confirm_portrait(c.id).portrait.size_bytes == len(PNG)


@pytest.mark.parametrize(
    ("head", "expected"),
    [(PNG, "image/png"), (b"\xff\xd8\xff\xe0", "image/jpeg"), (b"RIFF\x00\x00\x00\x00WEBPVP8", "image/webp"), (b"GIF89a", None)],
)
def test_detect_image_type(head, expected):
    assert detect_image_type(head) == expected


# --- DTOs -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "data",
    [
        {"campaignId": "c1", "name": "", "hp": {"current": 1, "max": 1}},
        {"campaignId": "c 1", "name": "A", "hp": {"current": 1, "max": 1}},
        {"campaignId": "c1", "name": "A", "hp": {"current": 5, "max": 1}},
        {"campaignId": "c1", "name": "A", "hp": {"current": 1, "max": 1}, "attributes": {"Força": 1}},
        {"campaignId": "c1", "name": "A", "hp": {"current": 1, "max": 1}, "campoDesconhecido": 1},
        {"campaignId": "c1", "name": "A", "hp": {"current": 1, "max": 1}, "attributes": {f"a{i}": 1 for i in range(65)}},
    ],
)
def test_create_invalido(data):
    with pytest.raises(ValidationError):
        CharacterCreate.model_validate(data)


@pytest.mark.parametrize("data", [{}, {"campaignId": "outra"}, {"name": None}, {"maxItems": None}])
def test_patch_invalido(data):
    with pytest.raises(ValidationError):
        CharacterPatch.model_validate(data)


# --- configuração -----------------------------------------------------------------------------


def test_config_padrao_e_overrides():
    s = Settings.from_env(
        {"AWS_ENDPOINT_URL": "http://ministack:4566", "S3_PUBLIC_ENDPOINT_URL": "http://localhost:4566", "MAX_RETRIES": "5"}
    )
    assert s.dynamodb_endpoint_url == "http://ministack:4566"
    assert s.s3_endpoint_url == "http://ministack:4566"
    assert s.s3_public_endpoint_url == "http://localhost:4566"
    assert s.max_retries == 5 and s.messaging_enabled


@pytest.mark.parametrize(
    ("env", "message"),
    [({"MAX_RETRIES": "abc"}, "inteiro"), ({"MESSAGING_ENABLED": "talvez"}, "booleano"), ({"STORE_BACKEND": "mongo"}, "um de")],
)
def test_config_invalida_falha_cedo(env, message):
    with pytest.raises(ConfigError, match=message):
        Settings.from_env(env)


def test_atraso_simulado_do_consumidor_e_configuravel():
    assert Settings.from_env({}).consumer_simulated_delay_ms == 0
    assert Settings.from_env({"CONSUMER_SIMULATED_DELAY_MS": "250"}).consumer_simulated_delay_ms == 250
    with pytest.raises(ConfigError):
        Settings.from_env({"CONSUMER_SIMULATED_DELAY_MS": "-1"})
