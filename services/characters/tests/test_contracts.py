"""Testes de contrato: exemplos, schemas, modelos Pydantic e manifesto precisam concordar entre si."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from app.application.handlers import Outcome
from app.messaging.envelope import Envelope, parse_envelope
from app.messaging.errors import PoisonMessage
from app.messaging.events import (
    CHARACTER_REJECTED,
    CHARACTER_VALIDATED,
    CHARACTER_VALIDATION_REQUESTED,
    AcquisitionOutcomePayload,
    CharacterRejectedPayload,
    CharacterValidatedPayload,
    ValidationRequestedPayload,
)
from app.messaging.topology import CONSUMER_QUEUES, expected_manifest_queues

from .conftest import CONTRACTS_DIR, REPO_ROOT, SERVICE_ROOT, make_character

EXAMPLES = CONTRACTS_DIR / "examples"
CONSUMED = SERVICE_ROOT / "contracts-consumed"

OWNED = [
    (CHARACTER_VALIDATION_REQUESTED, "character-validation-requested.v1", ValidationRequestedPayload),
    (CHARACTER_VALIDATED, "character-validated.v1", CharacterValidatedPayload),
    (CHARACTER_REJECTED, "character-rejected.v1", CharacterRejectedPayload),
]


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_todos_os_schemas_sao_json_schema_validos():
    for path in [*CONTRACTS_DIR.rglob("*.schema.json"), *CONSUMED.glob("*.schema.json")]:
        Draft202012Validator.check_schema(_load(path))


@pytest.mark.parametrize(("spec", "stem", "model"), OWNED, ids=[s[1] for s in OWNED])
def test_exemplo_valido_passa_no_schema_e_no_modelo(contracts, spec, stem, model):
    example = _load(EXAMPLES / f"{stem}.valid.json")
    assert contracts.errors(spec.schema_file, example) == []
    envelope = Envelope.model_validate(example)
    assert envelope.type == spec.type and envelope.version == spec.version
    model.model_validate(envelope.payload)


@pytest.mark.parametrize(("spec", "stem", "model"), OWNED, ids=[s[1] for s in OWNED])
def test_exemplo_invalido_e_rejeitado_pelo_schema(contracts, spec, stem, model):
    example = _load(EXAMPLES / f"{stem}.invalid.json")
    assert contracts.errors(spec.schema_file, example), "o exemplo inválido deveria violar o schema"


def test_exemplo_invalido_do_pedido_vira_poison_no_consumidor(handlers):
    body = (EXAMPLES / "character-validation-requested.v1.invalid.json").read_bytes()
    with pytest.raises(PoisonMessage):
        handlers.dispatch(parse_envelope(body))


def test_versao_desconhecida_e_rejeitada_pelo_schema_v1_e_pelo_consumidor(contracts, handlers):
    example = _load(EXAMPLES / "character-validation-requested.v2.unknown-version.json")
    assert contracts.errors(CHARACTER_VALIDATION_REQUESTED.schema_file, example)
    with pytest.raises(PoisonMessage):
        handlers.dispatch(Envelope.model_validate(example))


def test_exemplo_valido_do_pedido_e_processado(store, clock, handlers):
    make_character(store, clock)
    body = (EXAMPLES / "character-validation-requested.v1.valid.json").read_bytes()
    assert handlers.dispatch(parse_envelope(body)).outcome is Outcome.APPROVED


@pytest.mark.parametrize("name", ["item-acquired.v1.example.json", "acquisition-cancelled.v1.example.json"])
def test_exemplos_consumidos_atendem_a_expectativa_do_s2(name):
    example = _load(CONSUMED / name)
    expectation = _load(CONSUMED / "acquisition-outcome.expectation.schema.json")
    assert list(Draft202012Validator(expectation).iter_errors(example)) == []
    AcquisitionOutcomePayload.model_validate(Envelope.model_validate(example).payload)


@pytest.mark.parametrize("stem", ["item-acquired.v1", "acquisition-cancelled.v1"])
def test_schema_oficial_do_p3_mantem_campos_que_o_s2_usa(stem):
    """Consumer-driven contract: quando P3 publicar o schema oficial, ele deve exigir o que o S2 lê."""
    official = CONTRACTS_DIR / "events" / f"{stem}.schema.json"
    if not official.exists():
        pytest.skip(f"{official.name} ainda não foi publicado por P3")
    payload = _load(official).get("properties", {}).get("payload", {})
    required = set(payload.get("required", []))
    assert {"operationId", "characterId"} <= required


def test_eventos_produzidos_pelo_handler_respeitam_o_schema(store, clock, handlers, contracts):
    # o fixture `handlers` já valida cada evento gerado; aqui garantimos que houve validação de fato
    make_character(store, clock, max_items=1)
    handlers.dispatch(parse_envelope((EXAMPLES / "character-validation-requested.v1.valid.json").read_bytes()))
    for record in store.outbox:
        spec = CHARACTER_VALIDATED if record.type == CHARACTER_VALIDATED.type else CHARACTER_REJECTED
        assert contracts.errors(spec.schema_file, record.envelope) == []


def test_manifesto_de_infra_igual_a_topologia_do_codigo():
    manifest = _load(REPO_ROOT / "infra" / "manifests" / "characters.json")
    assert manifest["rabbitmq"]["queues"] == expected_manifest_queues()
    assert set(manifest["rabbitmq"]["publishes"]) == {CHARACTER_VALIDATED.routing_key, CHARACTER_REJECTED.routing_key}
    bound = {rk for q in CONSUMER_QUEUES for rk in q.bindings}
    assert bound == {"character.validation.requested.v1", "item.acquired.v1", "acquisition.cancelled.v1"}


def test_routing_keys_e_tipos_seguem_o_padrao_dos_contratos():
    for spec, stem, _ in OWNED:
        schema = _load(CONTRACTS_DIR / spec.schema_file)
        assert schema["x-routing"]["routingKey"] == spec.routing_key
        assert schema["properties"]["type"]["const"] == spec.type
        assert spec.schema_file.endswith(f"{stem}.schema.json")
