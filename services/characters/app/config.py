"""Configuração lida exclusivamente de variáveis de ambiente.

Nenhum endpoint, credencial ou nome de recurso fica fixo no código: tudo pode ser trocado pelo
Docker Compose ou pelo ambiente de avaliação. As credenciais AWS seguem a cadeia padrão do boto3
(AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) e por isso não aparecem aqui.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

_TRUE = {"1", "true", "yes", "on", "sim"}
_FALSE = {"0", "false", "no", "off", "nao", "não"}


class ConfigError(ValueError):
    """Valor de configuração inválido: o serviço não deve subir com ele."""


class _Env:
    def __init__(self, env: Mapping[str, str]) -> None:
        self._env = env

    def _raw(self, name: str) -> str | None:
        value = self._env.get(name)
        if value is None or value.strip() == "":
            return None
        return value.strip()

    def str(self, name: str, default: str) -> str:
        return self._raw(name) or default

    def opt(self, name: str) -> str | None:
        return self._raw(name)

    def int(self, name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
        raw = self._raw(name)
        if raw is None:
            value = default
        else:
            try:
                value = int(raw)
            except ValueError as exc:
                raise ConfigError(f"{name} deve ser inteiro, recebido {raw!r}") from exc
        if minimum is not None and value < minimum:
            raise ConfigError(f"{name} deve ser >= {minimum}, recebido {value}")
        if maximum is not None and value > maximum:
            raise ConfigError(f"{name} deve ser <= {maximum}, recebido {value}")
        return value

    def bool(self, name: str, default: bool) -> bool:
        raw = self._raw(name)
        if raw is None:
            return default
        lowered = raw.lower()
        if lowered in _TRUE:
            return True
        if lowered in _FALSE:
            return False
        raise ConfigError(f"{name} deve ser booleano (true/false), recebido {raw!r}")

    def choice(self, name: str, default: str, choices: set[str]) -> str:
        value = self.str(name, default).lower()
        if value not in choices:
            raise ConfigError(f"{name} deve ser um de {sorted(choices)}, recebido {value!r}")
        return value

    def csv(self, name: str, default: str) -> tuple[str, ...]:
        return tuple(part.strip() for part in self.str(name, default).split(",") if part.strip())


def _default_dir(name: str) -> Path:
    """Localiza contracts/ tanto no monorepo quanto na imagem Docker (/app/contracts)."""
    here = Path(__file__).resolve()
    candidates = [here.parents[1] / name]  # /app/<name> na imagem
    if len(here.parents) > 3:
        candidates.append(here.parents[3] / name)  # rpg-nexus/<name> no monorepo
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[-1]


@dataclass(frozen=True)
class Settings:
    # Serviço
    service_name: str = "characters"
    environment: str = "local"
    log_level: str = "INFO"
    log_format: str = "json"
    cors_origins: tuple[str, ...] = ("http://localhost:5173",)
    enable_internal_endpoints: bool = True

    # Persistência
    store_backend: str = "dynamodb"  # dynamodb | memory
    aws_region: str = "us-east-1"
    dynamodb_endpoint_url: str | None = None
    table_characters: str = "characters"
    table_inbox: str = "character_inbox"
    table_outbox: str = "character_outbox"
    #: Modelo de leitura (CQRS): resumo por personagem, consultado por campanha.
    table_read_model: str = "character_read_model"
    inbox_ttl_days: int = 7
    outbox_published_ttl_days: int = 3

    # Armazenamento de objetos
    storage_backend: str = "s3"  # s3 | memory
    s3_endpoint_url: str | None = None
    s3_public_endpoint_url: str | None = None
    s3_bucket: str = "rpg-nexus-assets"
    s3_portrait_prefix: str = "characters/"
    s3_presign_expires_seconds: int = 300
    s3_force_path_style: bool = True
    portrait_max_bytes: int = 2 * 1024 * 1024

    # Mensageria
    messaging_enabled: bool = True
    rabbitmq_url: str = "amqp://guest:guest@rabbitmq:5672/"
    rabbitmq_exchange: str = "rpg.events"
    rabbitmq_prefetch: int = 16
    rabbitmq_declare_topology: bool = True
    rabbitmq_reconnect_initial_ms: int = 500
    rabbitmq_reconnect_max_ms: int = 15_000
    max_retries: int = 3
    retry_base_delay_ms: int = 1_000
    retry_max_delay_ms: int = 15_000
    poison_direct_to_dlq: bool = False
    outbox_poll_interval_ms: int = 500
    outbox_batch_size: int = 25
    outbox_lease_seconds: int = 30
    validate_outgoing_events: bool = True

    # Tracing distribuído (OpenTelemetry). O endpoint vem de OTEL_EXPORTER_OTLP_ENDPOINT, lido pelo SDK.
    tracing_enabled: bool = False

    # Atraso artificial por mensagem consumida (somente demonstração da autoescala; 0 = desligado)
    consumer_simulated_delay_ms: int = 0

    # Domínio
    default_max_items: int = 10

    # Injeção de falhas (somente para demonstração F2)
    fault_crash_before_ack: str = "off"  # off | once | always
    fault_marker_file: str = "/tmp/characters-fault-crash-once"

    contracts_dir: Path = field(default_factory=lambda: _default_dir("contracts"))
    manifest_path: Path = field(default_factory=lambda: _default_dir("infra") / "manifests" / "characters.json")

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        e = _Env(os.environ if env is None else env)
        aws_endpoint = e.opt("AWS_ENDPOINT_URL")
        s3_endpoint = e.opt("S3_ENDPOINT_URL") or aws_endpoint
        defaults = cls()
        manifest_env = e.opt("MANIFEST_PATH")
        contracts_env = e.opt("CONTRACTS_DIR")
        return cls(
            service_name=e.str("SERVICE_NAME", defaults.service_name),
            environment=e.str("APP_ENV", defaults.environment),
            log_level=e.choice("LOG_LEVEL", "INFO", {"debug", "info", "warning", "error"}).upper(),
            log_format=e.choice("LOG_FORMAT", "json", {"json", "text"}),
            cors_origins=e.csv("CORS_ORIGINS", ",".join(defaults.cors_origins)),
            enable_internal_endpoints=e.bool("ENABLE_INTERNAL_ENDPOINTS", True),
            store_backend=e.choice("STORE_BACKEND", "dynamodb", {"dynamodb", "memory"}),
            aws_region=e.str("AWS_REGION", e.str("AWS_DEFAULT_REGION", defaults.aws_region)),
            dynamodb_endpoint_url=e.opt("DYNAMODB_ENDPOINT_URL") or aws_endpoint,
            table_characters=e.str("TABLE_CHARACTERS", defaults.table_characters),
            table_inbox=e.str("TABLE_INBOX", defaults.table_inbox),
            table_outbox=e.str("TABLE_OUTBOX", defaults.table_outbox),
            table_read_model=e.str("TABLE_READ_MODEL", defaults.table_read_model),
            inbox_ttl_days=e.int("INBOX_TTL_DAYS", defaults.inbox_ttl_days, minimum=1),
            outbox_published_ttl_days=e.int("OUTBOX_PUBLISHED_TTL_DAYS", defaults.outbox_published_ttl_days, minimum=1),
            storage_backend=e.choice("STORAGE_BACKEND", "s3", {"s3", "memory"}),
            s3_endpoint_url=s3_endpoint,
            s3_public_endpoint_url=e.opt("S3_PUBLIC_ENDPOINT_URL") or s3_endpoint,
            s3_bucket=e.str("S3_BUCKET", defaults.s3_bucket),
            s3_portrait_prefix=e.str("S3_PORTRAIT_PREFIX", defaults.s3_portrait_prefix),
            s3_presign_expires_seconds=e.int("S3_PRESIGN_EXPIRES_SECONDS", 300, minimum=30, maximum=3600),
            s3_force_path_style=e.bool("S3_FORCE_PATH_STYLE", True),
            portrait_max_bytes=e.int("PORTRAIT_MAX_BYTES", defaults.portrait_max_bytes, minimum=1024),
            messaging_enabled=e.bool("MESSAGING_ENABLED", True),
            rabbitmq_url=e.str("RABBITMQ_URL", defaults.rabbitmq_url),
            rabbitmq_exchange=e.str("RABBITMQ_EXCHANGE", defaults.rabbitmq_exchange),
            rabbitmq_prefetch=e.int("RABBITMQ_PREFETCH", defaults.rabbitmq_prefetch, minimum=1, maximum=1000),
            rabbitmq_declare_topology=e.bool("RABBITMQ_DECLARE_TOPOLOGY", True),
            rabbitmq_reconnect_initial_ms=e.int("RABBITMQ_RECONNECT_INITIAL_MS", 500, minimum=50),
            rabbitmq_reconnect_max_ms=e.int("RABBITMQ_RECONNECT_MAX_MS", 15_000, minimum=100),
            max_retries=e.int("MAX_RETRIES", defaults.max_retries, minimum=0, maximum=50),
            retry_base_delay_ms=e.int("RETRY_BASE_DELAY_MS", defaults.retry_base_delay_ms, minimum=0),
            retry_max_delay_ms=e.int("RETRY_MAX_DELAY_MS", defaults.retry_max_delay_ms, minimum=0),
            poison_direct_to_dlq=e.bool("POISON_DIRECT_TO_DLQ", False),
            outbox_poll_interval_ms=e.int("OUTBOX_POLL_INTERVAL_MS", 500, minimum=10),
            outbox_batch_size=e.int("OUTBOX_BATCH_SIZE", 25, minimum=1, maximum=100),
            outbox_lease_seconds=e.int("OUTBOX_LEASE_SECONDS", 30, minimum=1),
            validate_outgoing_events=e.bool("VALIDATE_OUTGOING_EVENTS", True),
            tracing_enabled=e.bool("TRACING_ENABLED", False),
            consumer_simulated_delay_ms=e.int("CONSUMER_SIMULATED_DELAY_MS", 0, minimum=0, maximum=60_000),
            default_max_items=e.int("DEFAULT_MAX_ITEMS", defaults.default_max_items, minimum=0, maximum=1000),
            fault_crash_before_ack=e.choice("FAULT_CRASH_BEFORE_ACK", "off", {"off", "once", "always"}),
            fault_marker_file=e.str("FAULT_MARKER_FILE", defaults.fault_marker_file),
            contracts_dir=Path(contracts_env) if contracts_env else defaults.contracts_dir,
            manifest_path=Path(manifest_env) if manifest_env else defaults.manifest_path,
        )
