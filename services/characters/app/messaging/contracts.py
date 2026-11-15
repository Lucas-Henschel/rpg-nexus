"""Validação de envelopes contra os JSON Schemas versionados em ``contracts/``.

Produtor valida o que publica (falha cedo, no próprio serviço, em vez de virar poison message no
consumidor). Os testes de contrato usam o mesmo registro.
"""

from __future__ import annotations

import json
from functools import cached_property
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError as SchemaValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from .events import EventSpec


class ContractViolation(Exception):
    pass


class ContractRegistry:
    def __init__(self, contracts_dir: Path) -> None:
        self._dir = Path(contracts_dir)
        if not self._dir.is_dir():
            raise FileNotFoundError(f"diretório de contratos não encontrado: {self._dir}")
        self._validators: dict[str, Draft202012Validator] = {}

    @cached_property
    def _registry(self) -> Registry:
        resources = []
        for path in sorted(self._dir.rglob("*.schema.json")):
            schema = json.loads(path.read_text(encoding="utf-8"))
            if "$id" in schema:
                resources.append((schema["$id"], Resource.from_contents(schema, default_specification=DRAFT202012)))
        return Registry().with_resources(resources)

    def has_schema(self, spec: EventSpec) -> bool:
        return spec.schema_file is not None and (self._dir / spec.schema_file).is_file()

    def validator_for(self, relative_path: str) -> Draft202012Validator:
        if relative_path not in self._validators:
            schema = json.loads((self._dir / relative_path).read_text(encoding="utf-8"))
            Draft202012Validator.check_schema(schema)
            self._validators[relative_path] = Draft202012Validator(
                schema, registry=self._registry, format_checker=FormatChecker()
            )
        return self._validators[relative_path]

    def errors(self, relative_path: str, document: Any) -> list[str]:
        validator = self.validator_for(relative_path)
        return [_format(e) for e in sorted(validator.iter_errors(document), key=lambda e: list(e.path))]

    def validate_event(self, spec: EventSpec, envelope: dict[str, Any]) -> None:
        if spec.schema_file is None:
            return
        problems = self.errors(spec.schema_file, envelope)
        if problems:
            raise ContractViolation(f"{spec.name} viola {spec.schema_file}: " + "; ".join(problems[:5]))


def _format(error: SchemaValidationError) -> str:
    location = "/".join(str(p) for p in error.absolute_path) or "<raiz>"
    return f"{location}: {error.message}"
