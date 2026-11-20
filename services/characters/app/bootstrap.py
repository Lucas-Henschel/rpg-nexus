"""Composition root: monta os adaptadores conforme a configuração.

Os imports de boto3/aio-pika são feitos sob demanda: no modo ``STORE_BACKEND=memory`` +
``MESSAGING_ENABLED=false`` o serviço sobe sem AWS nem broker (útil para o frontend e para testes).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.application.characters import CharacterService
from app.application.handlers import MessageHandlers
from app.application.ports import CharacterStore, ObjectStorage, TemplateStore
from app.application.read_model import Projector, ReadModelStore, RosterQuery
from app.application.templates import TemplateService
from app.config import Settings
from app.messaging.contracts import ContractRegistry
from app.messaging.faults import FaultInjector
from app.messaging.retry import RetryPolicy
from app.security import TokenVerifier

log = logging.getLogger(__name__)


@dataclass
class Container:
    settings: Settings
    store: CharacterStore
    storage: ObjectStorage | None
    handlers: MessageHandlers
    characters: CharacterService
    read_model: ReadModelStore
    projector: Projector
    roster: RosterQuery
    templates: TemplateService
    verifier: TokenVerifier
    contracts: ContractRegistry | None = None
    bus: Any | None = None  # RabbitMQBus
    relay: Any | None = None  # OutboxRelay


def build_store(settings: Settings) -> CharacterStore:
    if settings.store_backend == "memory":
        from app.adapters.memory_store import InMemoryCharacterStore

        log.warning("store.memory_backend", extra={"note": "dados NÃO persistem; use apenas em desenvolvimento"})
        return InMemoryCharacterStore()
    from app.adapters.dynamodb_store import DynamoDBCharacterStore

    return DynamoDBCharacterStore(
        region=settings.aws_region,
        endpoint_url=settings.dynamodb_endpoint_url,
        table_characters=settings.table_characters,
        table_inbox=settings.table_inbox,
        table_outbox=settings.table_outbox,
        inbox_ttl_days=settings.inbox_ttl_days,
        outbox_published_ttl_days=settings.outbox_published_ttl_days,
    )


def build_template_store(settings: Settings) -> TemplateStore:
    if settings.store_backend == "memory":
        from app.adapters.memory_store import InMemoryTemplateStore

        return InMemoryTemplateStore()
    from app.adapters.dynamodb_templates import DynamoDBTemplateStore

    return DynamoDBTemplateStore(
        region=settings.aws_region, endpoint_url=settings.dynamodb_endpoint_url, table=settings.table_templates
    )


def build_read_model(settings: Settings) -> ReadModelStore:
    if settings.store_backend == "memory":
        from app.adapters.memory_store import InMemoryReadModel

        return InMemoryReadModel()
    from app.adapters.dynamodb_read_model import DynamoDBReadModel

    return DynamoDBReadModel(
        region=settings.aws_region, endpoint_url=settings.dynamodb_endpoint_url, table=settings.table_read_model
    )


def build_storage(settings: Settings) -> ObjectStorage:
    if settings.storage_backend == "memory":
        from app.adapters.memory_store import InMemoryObjectStorage

        return InMemoryObjectStorage()
    from app.adapters.s3_storage import S3ObjectStorage

    return S3ObjectStorage(
        bucket=settings.s3_bucket,
        region=settings.aws_region,
        endpoint_url=settings.s3_endpoint_url,
        public_endpoint_url=settings.s3_public_endpoint_url,
        force_path_style=settings.s3_force_path_style,
    )


def build_container(
    settings: Settings,
    *,
    store: CharacterStore | None = None,
    storage: ObjectStorage | None = None,
    read_model: ReadModelStore | None = None,
    template_store: TemplateStore | None = None,
) -> Container:
    store = store or build_store(settings)
    # O modelo definido numa campanha (eventos do S1) fica liberado para os participantes dela.
    templates = TemplateService(template_store or build_template_store(settings), campaigns=store)
    verifier = TokenVerifier(settings.jwt_secret, settings.jwt_issuer, settings.jwt_audience)
    storage = storage or build_storage(settings)
    read_model = read_model or build_read_model(settings)
    # CQRS: o projetor mantém o modelo de leitura; as consultas de campanha leem só dele.
    projector = Projector(store, read_model)

    contracts: ContractRegistry | None = None
    if settings.validate_outgoing_events:
        try:
            contracts = ContractRegistry(settings.contracts_dir)
        except FileNotFoundError:
            log.warning("contracts.not_found", extra={"dir": str(settings.contracts_dir)})

    handlers = MessageHandlers(store, outgoing_validator=contracts.validate_event if contracts else None)
    characters = CharacterService(
        store,
        storage,
        default_max_items=settings.default_max_items,
        portrait_prefix=settings.s3_portrait_prefix,
        portrait_max_bytes=settings.portrait_max_bytes,
        presign_expires_seconds=settings.s3_presign_expires_seconds,
        on_change=projector.project_safely,
    )
    container = Container(
        settings,
        store,
        storage,
        handlers,
        characters,
        read_model,
        projector,
        RosterQuery(read_model),
        templates,
        verifier,
        contracts,
    )

    if settings.messaging_enabled:
        from app.messaging.outbox_relay import OutboxRelay
        from app.messaging.rabbitmq import RabbitMQBus

        bus = RabbitMQBus(
            url=settings.rabbitmq_url,
            exchange_name=settings.rabbitmq_exchange,
            prefetch=settings.rabbitmq_prefetch,
            declare_topology=settings.rabbitmq_declare_topology,
            reconnect_initial_ms=settings.rabbitmq_reconnect_initial_ms,
            reconnect_max_ms=settings.rabbitmq_reconnect_max_ms,
            service_name=settings.service_name,
            dispatcher=projector.after(handlers.dispatch),
            policy=RetryPolicy(
                max_retries=settings.max_retries,
                base_delay_ms=settings.retry_base_delay_ms,
                max_delay_ms=settings.retry_max_delay_ms,
                poison_direct_to_dlq=settings.poison_direct_to_dlq,
            ),
            fault=FaultInjector(settings.fault_crash_before_ack, settings.fault_marker_file),
            simulated_delay_ms=settings.consumer_simulated_delay_ms,
        )
        relay = OutboxRelay(
            store,
            bus,
            batch_size=settings.outbox_batch_size,
            poll_interval_ms=settings.outbox_poll_interval_ms,
            lease_seconds=settings.outbox_lease_seconds,
        )
        handlers.set_outbox_notifier(relay.notify)
        container.bus = bus
        container.relay = relay
    return container
