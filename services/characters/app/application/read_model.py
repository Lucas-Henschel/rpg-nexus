"""Lado de LEITURA do CQRS: um resumo por personagem, pronto para as consultas por campanha.

O lado de escrita continua sendo a tabela ``characters`` (fichas + reservas da Saga), com suas
transações e escritas condicionais. Aqui fica um modelo separado, desnormalizado e só de consulta:

* ``CharacterSummary``  o que a consulta devolve, já calculado (vagas, contagem de reservas por estado);
* ``Projector``         reconstrói o resumo de um personagem a partir do modelo de escrita;
* ``RosterQuery``       consulta que lê SOMENTE o modelo de leitura.

A projeção é idempotente: ela sempre relê o estado atual e regrava o resumo inteiro, então repetir ou
receber eventos fora de ordem não corrompe nada. A consistência é eventual — o resumo pode ficar um
instante atrás da escrita — e ``rebuild_campaign`` reconstrói tudo a partir da fonte.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, TypeVar

from app.clock import Clock, utcnow
from app.domain.models import CapacityHold, Character, HoldStatus

from .ports import CharacterStore

log = logging.getLogger(__name__)

R = TypeVar("R")


@dataclass(frozen=True)
class CharacterSummary:
    campaign_id: str
    character_id: str
    name: str
    active: bool
    hp_current: int
    hp_max: int
    max_items: int
    slots_used: int
    slots_available: int
    holds_held: int
    holds_committed: int
    holds_released: int
    has_portrait: bool
    profile_version: int
    created_at: datetime
    updated_at: datetime
    #: Instante em que o modelo de escrita foi lido para gerar este resumo.
    projected_at: datetime


class ReadModelStore(Protocol):
    def ping(self) -> None: ...

    def put_summary(self, summary: CharacterSummary) -> bool:
        """Grava o resumo se ele não for mais antigo que o já gravado. Devolve False se foi descartado."""
        ...

    def list_campaign(self, campaign_id: str) -> list[CharacterSummary]: ...


def build_summary(character: Character, holds: list[CapacityHold], projected_at: datetime) -> CharacterSummary:
    """Função pura: do estado do modelo de escrita para o resumo de leitura."""
    counts = {status: 0 for status in HoldStatus}
    for hold in holds:
        if not hold.tombstone:  # lápide não é reserva de verdade
            counts[hold.status] += 1
    return CharacterSummary(
        campaign_id=character.campaign_id,
        character_id=character.id,
        name=character.name,
        active=character.active,
        hp_current=character.hp.current,
        hp_max=character.hp.max,
        max_items=character.max_items,
        slots_used=character.slots_used,
        slots_available=character.slots_available,
        holds_held=counts[HoldStatus.HELD],
        holds_committed=counts[HoldStatus.COMMITTED],
        holds_released=counts[HoldStatus.RELEASED],
        has_portrait=character.portrait is not None,
        profile_version=character.version,
        created_at=character.created_at,
        updated_at=character.updated_at,
        projected_at=projected_at,
    )


class Projector:
    """Mantém o modelo de leitura em dia com o de escrita."""

    def __init__(self, source: CharacterStore, target: ReadModelStore, *, clock: Clock = utcnow) -> None:
        self._source = source
        self._target = target
        self._clock = clock
        self.stats = {"projected": 0, "stale": 0, "failed": 0}

    def project(self, character_id: str) -> bool:
        """Relê o personagem e suas reservas e regrava o resumo. Devolve False se não havia o que projetar."""
        read_at = self._clock()  # antes da leitura: uma projeção mais antiga nunca sobrescreve uma mais nova
        character = self._source.get_character(character_id)
        if character is None:
            return False
        summary = build_summary(character, self._source.list_holds(character_id), read_at)
        if self._target.put_summary(summary):
            self.stats["projected"] += 1
            return True
        self.stats["stale"] += 1
        return False

    def project_safely(self, character_id: str) -> None:
        """Nunca propaga erro: uma falha no lado de leitura não pode derrubar uma escrita já confirmada."""
        try:
            self.project(character_id)
        except Exception as exc:  # noqa: BLE001
            self.stats["failed"] += 1
            log.warning("read_model.projection_failed", extra={"characterId": character_id, "error": str(exc)})

    def rebuild_campaign(self, campaign_id: str) -> int:
        """Reconstrói o resumo de todos os personagens da campanha a partir do modelo de escrita."""
        rebuilt = 0
        cursor: str | None = None
        while True:
            page = self._source.list_characters(campaign_id, 100, cursor)
            for character in page.items:
                if self.project(character.id):
                    rebuilt += 1
            cursor = page.next_cursor
            if not cursor:
                return rebuilt

    def after(self, dispatch: Callable[[Any], R]) -> Callable[[Any], R]:
        """Envolve o processamento de mensagens: depois do efeito (e antes do ACK), projeta o personagem.

        Vale também para mensagens duplicadas: se o serviço caiu entre gravar e projetar, a reentrega
        encontra o ``messageId`` na inbox, não repete o efeito, e a projeção acontece aqui.
        """

        def dispatch_and_project(envelope: Any) -> R:
            result = dispatch(envelope)
            character_id = envelope.payload.get("characterId")
            if isinstance(character_id, str) and character_id:
                self.project_safely(character_id)
            return result

        return dispatch_and_project


@dataclass(frozen=True)
class Roster:
    campaign_id: str
    items: list[CharacterSummary]

    @property
    def totals(self) -> dict[str, int]:
        return {
            "characters": len(self.items),
            "active": sum(1 for s in self.items if s.active),
            "slotsUsed": sum(s.slots_used for s in self.items),
            "slotsAvailable": sum(s.slots_available for s in self.items),
            "holdsHeld": sum(s.holds_held for s in self.items),
            "holdsCommitted": sum(s.holds_committed for s in self.items),
            "holdsReleased": sum(s.holds_released for s in self.items),
        }


class RosterQuery:
    """Consulta do painel da campanha. Não toca o modelo de escrita."""

    def __init__(self, read_model: ReadModelStore) -> None:
        self._read_model = read_model

    def by_campaign(self, campaign_id: str) -> Roster:
        items = sorted(self._read_model.list_campaign(campaign_id), key=lambda s: (s.name.casefold(), s.character_id))
        return Roster(campaign_id, items)
