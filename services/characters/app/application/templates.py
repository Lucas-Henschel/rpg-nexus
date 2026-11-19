"""Casos de uso dos modelos de ficha (templates) privados de cada usuário.

O modelo guarda só estrutura e valores iniciais (``rules.template_sheet`` tira o conteúdo pessoal dos
blocos). Cada edição cria uma versão nova e imutável; uma ficha copia a versão escolhida e registra de
onde veio, então editar o modelo depois nunca muda fichas que já existem.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable

from app.clock import Clock, utcnow
from app.domain.errors import TemplateNotFound, VersionConflict
from app.domain.models import CharacterTemplate, TemplateDefinition
from app.domain.rules import template_sheet

from .dto import TemplateCreate, TemplateInitialValues, TemplatePatch
from .ports import ConcurrencyConflict, TemplateStore

log = logging.getLogger(__name__)


def _definition(sheet: dict | None, initial: TemplateInitialValues) -> TemplateDefinition:
    return TemplateDefinition(
        sheet=template_sheet(sheet),
        attributes=dict(initial.attributes),
        skills=dict(initial.skills),
        hp_max=initial.hpMax,
        max_items=initial.maxItems,
        currency_name=initial.currency.name,
        currency_amount=initial.currency.amount,
    )


class TemplateService:
    MAX_OPTIMISTIC_RETRIES = 5

    def __init__(
        self,
        store: TemplateStore,
        *,
        clock: Clock = utcnow,
        id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
    ) -> None:
        self._store = store
        self._clock = clock
        self._new_id = id_factory

    def create(self, owner_id: str, data: TemplateCreate) -> CharacterTemplate:
        now = self._clock()
        template = CharacterTemplate(
            id=self._new_id(),
            owner_id=owner_id,
            name=data.name,
            description=data.description,
            version=1,
            definition=_definition(data.sheetDefinition.model_dump() if data.sheetDefinition else None, data.initialValues),
            created_at=now,
            updated_at=now,
        )
        self._store.create_template(template)
        log.info("template.created", extra={"templateId": template.id})
        return template

    def list(self, owner_id: str) -> list[CharacterTemplate]:
        return self._store.list_templates(owner_id)

    def get(self, owner_id: str, template_id: str, version: int | None = None) -> CharacterTemplate:
        """Modelo do usuário. De outra pessoa, ou inexistente, é o mesmo 404: não revela que ele existe."""
        template = self._store.get_template(template_id, version)
        if template is None or template.owner_id != owner_id or (version is None and template.deleted):
            raise TemplateNotFound(template_id, version)
        return template

    def for_new_character(self, owner_id: str, template_id: str, version: int | None) -> CharacterTemplate:
        """A versão a copiar numa ficha nova. Modelo apagado não serve para fichas novas."""
        template = self.get(owner_id, template_id, version)
        if template.deleted:
            raise TemplateNotFound(template_id, version)
        return template

    def update(
        self, owner_id: str, template_id: str, patch: TemplatePatch, expected_version: int | None = None
    ) -> CharacterTemplate:
        """Grava uma versão nova. Com If-Match, recusa se o modelo mudou desde a versão que o cliente viu."""
        for _ in range(self.MAX_OPTIMISTIC_RETRIES):
            current = self.get(owner_id, template_id)
            if expected_version is not None and current.version != expected_version:
                raise VersionConflict(expected_version, current.version)
            fields = patch.model_fields_set
            d = current.definition
            sheet = d.sheet
            if "sheetDefinition" in fields:
                sheet = template_sheet(patch.sheetDefinition.model_dump() if patch.sheetDefinition else None)
            definition = (
                _definition(sheet, patch.initialValues)
                if "initialValues" in fields and patch.initialValues is not None
                else TemplateDefinition(sheet, d.attributes, d.skills, d.hp_max, d.max_items, d.currency_name, d.currency_amount)
            )
            updated = current.evolve(
                name=patch.name if "name" in fields and patch.name is not None else current.name,
                description=patch.description if "description" in fields else current.description,
                definition=definition,
                version=current.version + 1,
                updated_at=self._clock(),
            )
            try:
                self._store.add_version(updated, current.version)
            except ConcurrencyConflict:
                continue
            log.info("template.versioned", extra={"templateId": template_id, "version": updated.version})
            return updated
        latest = self.get(owner_id, template_id)
        raise VersionConflict(expected_version or latest.version, latest.version)

    def delete(self, owner_id: str, template_id: str) -> None:
        self.get(owner_id, template_id)
        self._store.delete_template(template_id, owner_id)
        log.info("template.deleted", extra={"templateId": template_id})
