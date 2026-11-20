"""Participação do S2 na Saga de aquisição de item.

Fluxo (todas as escritas de cada passo numa única transação local):

    CharacterValidationRequested ──► decide ──► aprovado: hold HELD + capacidade -= q + CharacterValidated
                                              └► recusado: CharacterRejected (sem efeito em capacidade)
    ItemAcquired                 ──► hold HELD -> COMMITTED
    AcquisitionCancelled         ──► hold HELD -> RELEASED + capacidade += q  (compensação local)
                                     ou, se o pedido ainda não chegou, lápide RELEASED

Garantias:
* **Idempotência por messageId** (inbox na mesma transação do efeito): reentrega não repete efeito.
* **Idempotência por operationId** (hold com chave CHAR#id / HOLD#operationId): mesmo que o S3 envie
  outro messageId para a mesma operação, a capacidade é reservada uma única vez.
* **Concorrência**: a reserva usa escrita condicional ``slotsAvailable >= q``; se outra réplica
  vencer a corrida, a transação falha, relemos e decidimos de novo (nunca fica negativo).
* **Reordenação**: cancelamento antes do pedido cria lápide; o pedido atrasado é recusado com
  OPERATION_CLOSED em vez de reter capacidade para sempre.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.clock import Clock, utcnow
from app.domain.models import CampaignMembership, CampaignTemplate, CapacityHold, Character, HoldStatus, MoneyEntry, MoneyStatus
from app.domain.rules import MoneyDecision, ValidationDecision, evaluate_debit_request, evaluate_validation_request
from app.messaging.envelope import Envelope, build_envelope, summarize_validation_error
from app.messaging.errors import PoisonMessage, TransientProcessingError
from app.messaging.events import (
    ACQUISITION_CANCELLED,
    CAMPAIGN_MEMBER_JOINED,
    CAMPAIGN_MEMBER_REMOVED,
    CAMPAIGN_TEMPLATE_ASSIGNED,
    CHARACTER_REJECTED,
    CHARACTER_VALIDATED,
    CHARACTER_VALIDATION_REQUESTED,
    CHARACTER_VALIDATION_REQUESTED_V2,
    ITEM_ACQUIRED,
    MONEY_DEBIT_REJECTED,
    MONEY_DEBIT_REQUESTED,
    MONEY_DEBITED,
    MONEY_REFUND_REQUESTED,
    MONEY_REFUNDED,
    AcquisitionOutcomePayload,
    CampaignMemberJoinedPayload,
    CampaignMemberRemovedPayload,
    CampaignTemplateAssignedPayload,
    CharacterRejectedPayload,
    CharacterValidatedPayload,
    EventSpec,
    MoneyDebitedPayload,
    MoneyDebitRejectedPayload,
    MoneyDebitRequestedPayload,
    MoneyRefundedPayload,
    MoneyRefundRequestedPayload,
    ValidationRequestedPayload,
    ValidationRequestedPayloadV2,
)
from app.tracing import current_carrier

from .ports import CharacterStore, ConcurrencyConflict, DuplicateMessage, InboxRecord, OutboxRecord

log = logging.getLogger(__name__)

P = TypeVar("P", bound=BaseModel)


class Outcome(StrEnum):
    APPROVED = "APPROVED"
    APPROVED_REPLAY = "APPROVED_REPLAY"
    REJECTED = "REJECTED"
    DUPLICATE = "DUPLICATE"
    HOLD_COMMITTED = "HOLD_COMMITTED"
    HOLD_RELEASED = "HOLD_RELEASED"
    TOMBSTONE_CREATED = "TOMBSTONE_CREATED"
    ALREADY_APPLIED = "ALREADY_APPLIED"
    MONEY_REFUNDED = "MONEY_REFUNDED"
    MEMBERSHIP_APPLIED = "MEMBERSHIP_APPLIED"
    CAMPAIGN_TEMPLATE_APPLIED = "CAMPAIGN_TEMPLATE_APPLIED"
    STALE = "STALE"
    ANOMALY = "ANOMALY"


@dataclass(frozen=True)
class HandlingResult:
    outcome: Outcome
    detail: str = ""
    emitted_type: str | None = None


OutgoingValidator = Callable[[EventSpec, dict[str, Any]], None]


class MessageHandlers:
    MAX_CONFLICT_RETRIES = 8

    def __init__(
        self,
        store: CharacterStore,
        *,
        clock: Clock = utcnow,
        on_outbox_write: Callable[[], None] | None = None,
        outgoing_validator: OutgoingValidator | None = None,
    ) -> None:
        self._store = store
        self._clock = clock
        self._notify = on_outbox_write or (lambda: None)
        self._validate_outgoing = outgoing_validator
        self._routes: dict[str, tuple[EventSpec, Callable[[Envelope], HandlingResult]]] = {
            CHARACTER_VALIDATION_REQUESTED.type: (CHARACTER_VALIDATION_REQUESTED, self.handle_validation_requested),
            CHARACTER_VALIDATION_REQUESTED_V2.type: (
                CHARACTER_VALIDATION_REQUESTED_V2,
                self.handle_validation_requested_v2,
            ),
            ITEM_ACQUIRED.type: (ITEM_ACQUIRED, self.handle_item_acquired),
            ACQUISITION_CANCELLED.type: (ACQUISITION_CANCELLED, self.handle_acquisition_cancelled),
            MONEY_DEBIT_REQUESTED.type: (MONEY_DEBIT_REQUESTED, self.handle_money_debit_requested),
            MONEY_REFUND_REQUESTED.type: (MONEY_REFUND_REQUESTED, self.handle_money_refund_requested),
            CAMPAIGN_MEMBER_JOINED.type: (CAMPAIGN_MEMBER_JOINED, self.handle_member_joined),
            CAMPAIGN_MEMBER_REMOVED.type: (CAMPAIGN_MEMBER_REMOVED, self.handle_member_removed),
            CAMPAIGN_TEMPLATE_ASSIGNED.type: (CAMPAIGN_TEMPLATE_ASSIGNED, self.handle_template_assigned),
        }

    def set_outbox_notifier(self, notifier: Callable[[], None]) -> None:
        self._notify = notifier

    @property
    def supported_types(self) -> tuple[str, ...]:
        return tuple(self._routes)

    # --- Entrada única usada pelo consumidor RabbitMQ -----------------------------------------

    def dispatch(self, envelope: Envelope) -> HandlingResult:
        route = self._routes.get(envelope.type)
        if route is None:
            raise PoisonMessage(f"tipo de evento não suportado pelo S2: {envelope.type}")
        spec, handler = route
        if envelope.version != spec.version:
            raise PoisonMessage(f"versão {envelope.version} não suportada para {spec.name} (esperado {spec.version})")
        return handler(envelope)

    # --- CharacterValidationRequested ---------------------------------------------------------

    def handle_validation_requested(self, envelope: Envelope) -> HandlingResult:
        return self._validate(envelope, self._parse(ValidationRequestedPayload, envelope))

    def handle_validation_requested_v2(self, envelope: Envelope) -> HandlingResult:
        """v2 convive com a v1: o payload é convertido para a forma interna e segue o mesmo caminho."""
        return self._validate(envelope, self._parse(ValidationRequestedPayloadV2, envelope).upcast())

    def _validate(self, envelope: Envelope, p: ValidationRequestedPayload) -> HandlingResult:
        message_id = str(envelope.messageId)
        if self._store.get_inbox(message_id) is not None:
            return HandlingResult(Outcome.DUPLICATE, "messageId já processado")

        for attempt in range(1, self.MAX_CONFLICT_RETRIES + 1):
            now = self._clock()
            character = self._store.get_character(p.characterId)
            hold = self._store.get_hold(p.characterId, p.operationId)
            decision = evaluate_validation_request(
                character, hold, campaign_id=p.campaignId, quantity=p.quantity, deadline_at=p.deadlineAt, now=now
            )
            try:
                result = self._apply_validation_decision(envelope, p, character, decision, now)
            except DuplicateMessage:
                return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
            except ConcurrencyConflict:
                log.info("validation.conflict_retry", extra={"attempt": attempt, "operationId": p.operationId})
                continue
            self._notify()
            log.info(
                "validation.decided",
                extra={
                    "operationId": p.operationId,
                    "characterId": p.characterId,
                    "outcome": result.outcome.value,
                    "detail": result.detail,
                    "eventVersion": envelope.version,
                },
            )
            return result
        raise TransientProcessingError(f"conflitos de concorrência persistentes para operação {p.operationId}")

    def _apply_validation_decision(
        self,
        envelope: Envelope,
        p: ValidationRequestedPayload,
        character: Character | None,
        decision: ValidationDecision,
        now: Any,
    ) -> HandlingResult:
        if decision.approved and not decision.replay:
            assert character is not None
            outbox = self._outgoing(
                CHARACTER_VALIDATED,
                envelope.correlationId,
                CharacterValidatedPayload(
                    operationId=p.operationId,
                    campaignId=p.campaignId,
                    characterId=p.characterId,
                    itemId=p.itemId,
                    quantity=p.quantity,
                    slotsRemaining=max(character.slots_available - p.quantity, 0),
                ),
                now,
            )
            hold = CapacityHold(
                operation_id=p.operationId,
                character_id=p.characterId,
                quantity=p.quantity,
                status=HoldStatus.HELD,
                campaign_id=p.campaignId,
                item_id=p.itemId,
                created_at=now,
                updated_at=now,
            )
            self._store.reserve_capacity(self._inbox(envelope, Outcome.APPROVED, decision.detail, now), hold, outbox)
            return HandlingResult(Outcome.APPROVED, decision.detail, CHARACTER_VALIDATED.type)

        if decision.approved:  # replay: reserva já existe para esta operação
            outbox = self._outgoing(
                CHARACTER_VALIDATED,
                envelope.correlationId,
                CharacterValidatedPayload(
                    operationId=p.operationId,
                    campaignId=p.campaignId,
                    characterId=p.characterId,
                    itemId=p.itemId,
                    quantity=p.quantity,
                    slotsRemaining=max(character.slots_available, 0) if character else 0,
                ),
                now,
            )
            self._store.record_outcome(self._inbox(envelope, Outcome.APPROVED_REPLAY, decision.detail, now), outbox)
            return HandlingResult(Outcome.APPROVED_REPLAY, decision.detail, CHARACTER_VALIDATED.type)

        assert decision.reason is not None
        outbox = self._outgoing(
            CHARACTER_REJECTED,
            envelope.correlationId,
            CharacterRejectedPayload(
                operationId=p.operationId,
                campaignId=p.campaignId,
                characterId=p.characterId,
                itemId=p.itemId,
                quantity=p.quantity,
                reason=decision.reason,
                detail=decision.detail[:500],
            ),
            now,
        )
        detail = f"{decision.reason.value}: {decision.detail}"
        self._store.record_outcome(self._inbox(envelope, Outcome.REJECTED, detail, now), outbox)
        return HandlingResult(Outcome.REJECTED, detail, CHARACTER_REJECTED.type)

    # --- ItemAcquired -------------------------------------------------------------------------

    def handle_item_acquired(self, envelope: Envelope) -> HandlingResult:
        p = self._parse(AcquisitionOutcomePayload, envelope)
        if self._store.get_inbox(str(envelope.messageId)) is not None:
            return HandlingResult(Outcome.DUPLICATE, "messageId já processado")

        for _ in range(self.MAX_CONFLICT_RETRIES):
            now = self._clock()
            hold = self._store.get_hold(p.characterId, p.operationId)
            try:
                if hold is None:
                    return self._anomaly(envelope, "ItemAcquired sem reserva correspondente no S2", now)
                if hold.status is HoldStatus.HELD:
                    self._store.commit_hold(
                        self._inbox(envelope, Outcome.HOLD_COMMITTED, "", now),
                        hold.evolve(status=HoldStatus.COMMITTED, updated_at=now),
                    )
                    log.info("hold.committed", extra={"operationId": p.operationId, "characterId": p.characterId})
                    return HandlingResult(Outcome.HOLD_COMMITTED)
                if hold.status is HoldStatus.COMMITTED:
                    self._store.record_outcome(self._inbox(envelope, Outcome.ALREADY_APPLIED, "já COMMITTED", now), None)
                    return HandlingResult(Outcome.ALREADY_APPLIED, "reserva já COMMITTED")
                return self._anomaly(envelope, "ItemAcquired após reserva liberada (RELEASED)", now)
            except DuplicateMessage:
                return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
            except ConcurrencyConflict:
                continue
        raise TransientProcessingError(f"conflitos persistentes ao confirmar operação {p.operationId}")

    # --- AcquisitionCancelled (compensação local) --------------------------------------------

    def handle_acquisition_cancelled(self, envelope: Envelope) -> HandlingResult:
        p = self._parse(AcquisitionOutcomePayload, envelope)
        if self._store.get_inbox(str(envelope.messageId)) is not None:
            return HandlingResult(Outcome.DUPLICATE, "messageId já processado")

        for _ in range(self.MAX_CONFLICT_RETRIES):
            now = self._clock()
            hold = self._store.get_hold(p.characterId, p.operationId)
            try:
                if hold is None:
                    tombstone = CapacityHold(
                        operation_id=p.operationId,
                        character_id=p.characterId,
                        quantity=p.quantity or 1,
                        status=HoldStatus.RELEASED,
                        created_at=now,
                        updated_at=now,
                        tombstone=True,
                    )
                    self._store.create_tombstone(
                        self._inbox(envelope, Outcome.TOMBSTONE_CREATED, "cancelamento antes da validação", now), tombstone
                    )
                    log.info("hold.tombstone_created", extra={"operationId": p.operationId, "characterId": p.characterId})
                    return HandlingResult(Outcome.TOMBSTONE_CREATED)
                if hold.status is HoldStatus.HELD:
                    self._store.release_hold(
                        self._inbox(envelope, Outcome.HOLD_RELEASED, "", now),
                        hold.evolve(status=HoldStatus.RELEASED, updated_at=now),
                    )
                    log.info(
                        "hold.released",
                        extra={"operationId": p.operationId, "characterId": p.characterId, "quantity": hold.quantity},
                    )
                    return HandlingResult(Outcome.HOLD_RELEASED)
                if hold.status is HoldStatus.RELEASED:
                    self._store.record_outcome(self._inbox(envelope, Outcome.ALREADY_APPLIED, "já RELEASED", now), None)
                    return HandlingResult(Outcome.ALREADY_APPLIED, "reserva já RELEASED")
                return self._anomaly(envelope, "AcquisitionCancelled após reserva COMMITTED", now)
            except DuplicateMessage:
                return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
            except ConcurrencyConflict:
                continue
        raise TransientProcessingError(f"conflitos persistentes ao cancelar operação {p.operationId}")

    # --- MoneyDebitRequested (passo de pagamento da Saga de compra) -----------------------------

    def handle_money_debit_requested(self, envelope: Envelope) -> HandlingResult:
        p = self._parse(MoneyDebitRequestedPayload, envelope)
        if self._store.get_inbox(str(envelope.messageId)) is not None:
            return HandlingResult(Outcome.DUPLICATE, "messageId já processado")

        for attempt in range(1, self.MAX_CONFLICT_RETRIES + 1):
            now = self._clock()
            character = self._store.get_character(p.characterId)
            existing = self._store.get_money_entry(p.characterId, p.operationId)
            decision = evaluate_debit_request(
                character,
                existing,
                user_id=p.userId,
                campaign_id=p.campaignId,
                amount=p.amount,
                deadline_at=p.deadlineAt,
                now=now,
            )
            try:
                result = self._apply_debit_decision(envelope, p, character, existing, decision, now)
            except DuplicateMessage:
                return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
            except ConcurrencyConflict:
                # outra compra gastou o saldo (ou a ficha mudou) entre a leitura e a escrita: decide de novo
                log.info("money.debit_conflict_retry", extra={"attempt": attempt, "operationId": p.operationId})
                continue
            self._notify()
            log.info(
                "money.debit_decided",
                extra={"operationId": p.operationId, "characterId": p.characterId, "outcome": result.outcome.value},
            )
            return result
        raise TransientProcessingError(f"conflitos persistentes no débito da operação {p.operationId}")

    def _apply_debit_decision(
        self,
        envelope: Envelope,
        p: MoneyDebitRequestedPayload,
        character: Character | None,
        existing: MoneyEntry | None,
        decision: MoneyDecision,
        now: Any,
    ) -> HandlingResult:
        if decision.approved and not decision.replay:
            assert character is not None
            entry = MoneyEntry(
                operation_id=p.operationId,
                character_id=p.characterId,
                kind="PURCHASE",
                amount=p.amount,
                status=MoneyStatus.DEBITED,
                campaign_id=p.campaignId,
                user_id=p.userId,
                reason=f"compra do item {p.itemId}",
                created_at=now,
                updated_at=now,
            )
            outbox = self._outgoing(
                MONEY_DEBITED,
                envelope.correlationId,
                MoneyDebitedPayload(
                    operationId=p.operationId,
                    campaignId=p.campaignId,
                    characterId=p.characterId,
                    userId=p.userId,
                    itemId=p.itemId,
                    amount=p.amount,
                    balance=character.currency_amount - p.amount,
                ),
                now,
            )
            self._store.debit_money(self._inbox(envelope, Outcome.APPROVED, decision.detail, now), entry, outbox)
            return HandlingResult(Outcome.APPROVED, decision.detail, MONEY_DEBITED.type)
        if decision.approved:  # replay: o débito desta operação já foi feito
            assert existing is not None
            outbox = self._outgoing(
                MONEY_DEBITED,
                envelope.correlationId,
                MoneyDebitedPayload(
                    operationId=p.operationId,
                    campaignId=p.campaignId,
                    characterId=p.characterId,
                    userId=p.userId,
                    itemId=p.itemId,
                    amount=p.amount,
                    balance=character.currency_amount if character else 0,
                ),
                now,
            )
            self._store.record_outcome(self._inbox(envelope, Outcome.APPROVED_REPLAY, decision.detail, now), outbox)
            return HandlingResult(Outcome.APPROVED_REPLAY, decision.detail, MONEY_DEBITED.type)
        assert decision.reason is not None
        outbox = self._outgoing(
            MONEY_DEBIT_REJECTED,
            envelope.correlationId,
            MoneyDebitRejectedPayload(
                operationId=p.operationId,
                campaignId=p.campaignId,
                characterId=p.characterId,
                userId=p.userId,
                itemId=p.itemId,
                amount=p.amount,
                reason=decision.reason,
                detail=decision.detail[:500],
            ),
            now,
        )
        detail = f"{decision.reason.value}: {decision.detail}"
        self._store.record_outcome(self._inbox(envelope, Outcome.REJECTED, detail, now), outbox)
        return HandlingResult(Outcome.REJECTED, detail, MONEY_DEBIT_REJECTED.type)

    # --- MoneyRefundRequested (compensação do pagamento) -------------------------------------

    def handle_money_refund_requested(self, envelope: Envelope) -> HandlingResult:
        p = self._parse(MoneyRefundRequestedPayload, envelope)
        if self._store.get_inbox(str(envelope.messageId)) is not None:
            return HandlingResult(Outcome.DUPLICATE, "messageId já processado")

        for _ in range(self.MAX_CONFLICT_RETRIES):
            now = self._clock()
            entry = self._store.get_money_entry(p.characterId, p.operationId)
            character = self._store.get_character(p.characterId)
            balance = character.currency_amount if character else 0

            def refunded(amount: int, new_balance: int, at: Any = now) -> OutboxRecord:
                # amount = preço (o S3 confere); refundedAmount = o que voltou de fato ao saldo
                payload = MoneyRefundedPayload(
                    operationId=p.operationId,
                    campaignId=p.campaignId,
                    characterId=p.characterId,
                    userId=p.userId,
                    itemId=p.itemId,
                    amount=p.amount,
                    refundedAmount=amount,
                    balance=new_balance,
                )
                return self._outgoing(MONEY_REFUNDED, envelope.correlationId, payload, at)

            try:
                if entry is None:
                    # Reembolso antes do débito (reordenação): lápide, para o débito atrasado ser recusado.
                    tombstone = MoneyEntry(
                        operation_id=p.operationId,
                        character_id=p.characterId,
                        kind="PURCHASE",
                        amount=0,
                        status=MoneyStatus.REFUNDED,
                        campaign_id=p.campaignId,
                        user_id=p.userId,
                        reason="reembolso antes do débito",
                        tombstone=True,
                        created_at=now,
                        updated_at=now,
                    )
                    self._store.create_money_tombstone(
                        self._inbox(envelope, Outcome.TOMBSTONE_CREATED, "reembolso antes do débito", now),
                        tombstone,
                        refunded(0, balance),
                    )
                    log.info("money.tombstone_created", extra={"operationId": p.operationId})
                    result = HandlingResult(Outcome.TOMBSTONE_CREATED, "nada a reembolsar", MONEY_REFUNDED.type)
                elif entry.status is MoneyStatus.DEBITED:
                    self._store.refund_money(
                        self._inbox(envelope, Outcome.MONEY_REFUNDED, "", now),
                        entry.evolve(status=MoneyStatus.REFUNDED, updated_at=now),
                        refunded(entry.amount, balance + entry.amount),
                    )
                    log.info("money.refunded", extra={"operationId": p.operationId, "amount": entry.amount})
                    result = HandlingResult(Outcome.MONEY_REFUNDED, "", MONEY_REFUNDED.type)
                else:
                    # Já reembolsado: confirma de novo sem creditar outra vez.
                    amount = 0 if entry.tombstone else entry.amount
                    self._store.record_outcome(
                        self._inbox(envelope, Outcome.ALREADY_APPLIED, "já REFUNDED", now), refunded(amount, balance)
                    )
                    result = HandlingResult(Outcome.ALREADY_APPLIED, "operação já reembolsada", MONEY_REFUNDED.type)
            except DuplicateMessage:
                return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
            except ConcurrencyConflict:
                continue
            self._notify()
            return result
        raise TransientProcessingError(f"conflitos persistentes no reembolso da operação {p.operationId}")

    # --- Participantes das campanhas (projeção dos eventos do S1) -------------------------------

    def handle_member_joined(self, envelope: Envelope) -> HandlingResult:
        p = self._parse(CampaignMemberJoinedPayload, envelope)
        membership = CampaignMembership(p.campaignId, p.userId, p.role, True, p.joinedAt, p.username)
        return self._apply_membership(envelope, membership)

    def handle_member_removed(self, envelope: Envelope) -> HandlingResult:
        p = self._parse(CampaignMemberRemovedPayload, envelope)
        current = self._store.get_membership(p.campaignId, p.userId)
        # o papel continua o que era; a saída só desliga a participação
        membership = CampaignMembership(p.campaignId, p.userId, current.role if current else "PLAYER", False, p.removedAt)
        return self._apply_membership(envelope, membership)

    def _apply_membership(self, envelope: Envelope, membership: CampaignMembership) -> HandlingResult:
        if self._store.get_inbox(str(envelope.messageId)) is not None:
            return HandlingResult(Outcome.DUPLICATE, "messageId já processado")
        now = self._clock()
        try:
            self._store.apply_membership(self._inbox(envelope, Outcome.MEMBERSHIP_APPLIED, "", now), membership)
        except DuplicateMessage:
            return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
        except ConcurrencyConflict:
            # Evento mais antigo que o gravado (chegou fora de ordem): registra e não muda nada.
            try:
                self._store.record_outcome(self._inbox(envelope, Outcome.STALE, "evento antigo", now), None)
            except DuplicateMessage:
                return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
            return HandlingResult(Outcome.STALE, "evento mais antigo que o gravado")
        log.info(
            "campaign.membership_applied",
            extra={"campaignId": membership.campaign_id, "userId": membership.user_id, "active": membership.active},
        )
        return HandlingResult(Outcome.MEMBERSHIP_APPLIED)

    # --- Modelo de ficha das campanhas (evento do S1) -------------------------------------------

    def handle_template_assigned(self, envelope: Envelope) -> HandlingResult:
        p = self._parse(CampaignTemplateAssignedPayload, envelope)
        assigned = CampaignTemplate(p.campaignId, p.templateId, p.templateVersion, p.templateName, p.assignedAt)
        if self._store.get_inbox(str(envelope.messageId)) is not None:
            return HandlingResult(Outcome.DUPLICATE, "messageId já processado")
        now = self._clock()
        try:
            self._store.apply_campaign_template(self._inbox(envelope, Outcome.CAMPAIGN_TEMPLATE_APPLIED, "", now), assigned)
        except DuplicateMessage:
            return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
        except ConcurrencyConflict:
            # Definição mais antiga que a gravada (chegou fora de ordem): registra e não muda nada.
            try:
                self._store.record_outcome(self._inbox(envelope, Outcome.STALE, "evento antigo", now), None)
            except DuplicateMessage:
                return HandlingResult(Outcome.DUPLICATE, "messageId gravado por processamento concorrente")
            return HandlingResult(Outcome.STALE, "evento mais antigo que o gravado")
        log.info(
            "campaign.template_applied",
            extra={"campaignId": assigned.campaign_id, "templateId": assigned.template_id, "version": assigned.version},
        )
        return HandlingResult(Outcome.CAMPAIGN_TEMPLATE_APPLIED)

    # --- Auxiliares ---------------------------------------------------------------------------

    def _parse(self, model: type[P], envelope: Envelope) -> P:
        try:
            return model.model_validate(envelope.payload)
        except ValidationError as exc:
            raise PoisonMessage(f"payload inválido para {envelope.type}: {summarize_validation_error(exc)}") from exc

    def _inbox(self, envelope: Envelope, outcome: Outcome, detail: str, now: Any) -> InboxRecord:
        return InboxRecord(
            message_id=str(envelope.messageId),
            type=envelope.type,
            correlation_id=envelope.correlationId,
            outcome=outcome.value,
            received_at=now,
            detail=detail[:500],
        )

    def _outgoing(self, spec: EventSpec, correlation_id: str, payload: BaseModel, now: Any) -> OutboxRecord:
        message_id = str(uuid.uuid4())
        envelope = build_envelope(
            event_type=spec.type,
            version=spec.version,
            correlation_id=correlation_id,
            payload=payload.model_dump(mode="json"),
            occurred_at=now,
            message_id=message_id,
        )
        if self._validate_outgoing is not None:
            self._validate_outgoing(spec, envelope)
        return OutboxRecord(
            message_id=message_id,
            type=spec.type,
            routing_key=spec.routing_key,
            correlation_id=correlation_id,
            envelope=envelope,
            created_at=now,
            trace_context=current_carrier(),
        )

    def _anomaly(self, envelope: Envelope, detail: str, now: Any) -> HandlingResult:
        """Evento inesperado para o estado local: registra para auditoria e não altera capacidade."""
        self._store.record_outcome(self._inbox(envelope, Outcome.ANOMALY, detail, now), None)
        log.warning("saga.anomaly", extra={"type": envelope.type, "detail": detail})
        return HandlingResult(Outcome.ANOMALY, detail)
