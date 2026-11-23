"""Rotas HTTP do S2.

Endpoints síncronos (``def``) rodam no threadpool do Starlette, adequado ao boto3 (bloqueante).
"""

from __future__ import annotations

from functools import partial
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, RedirectResponse

from app import __version__
from app.application.dto import (
    CharacterAssignCampaign,
    CharacterCreate,
    CharacterFromTemplate,
    CharacterOut,
    CharacterPageOut,
    CharacterPatch,
    CharacterSummaryOut,
    HoldOut,
    MoneyEntryOut,
    PortraitUploadRequest,
    PortraitUrlOut,
    PresignedUploadOut,
    RosterOut,
    TemplateCreate,
    TemplateOut,
    TemplatePatch,
)
from app.bootstrap import Container
from app.domain.errors import DomainError, InvalidPortrait, VersionConflict
from app.domain.models import Character
from app.security import AuthUser, bearer_token

from .errors import error_response

CharacterId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="ID do personagem")]

router = APIRouter()


class BadRequest(DomainError):
    code = "BAD_REQUEST"
    http_status = 400


class PayloadTooLarge(DomainError):
    code = "PAYLOAD_TOO_LARGE"
    http_status = 413


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]

#: Dono dos modelos quando a autenticação está desligada (só desenvolvimento local, AUTH_REQUIRED=false).
LOCAL_USER = AuthUser(user_id="local-dev", username="local-dev")


def current_user(c: ContainerDep, authorization: Annotated[str | None, Header()] = None) -> AuthUser | None:
    """Quem fez a requisição, pelo access token do S4. ``None`` só com AUTH_REQUIRED=false."""
    if not c.settings.auth_required:
        return None
    return c.verifier.verify(bearer_token(authorization))


UserDep = Annotated[AuthUser | None, Depends(current_user)]


def _uid(user: AuthUser | None) -> str | None:
    """user_id para as checagens de dono; None (sem checagem) só com a autenticação desligada."""
    return user.user_id if user else None


def _owner(user: AuthUser | None) -> str:
    return (user or LOCAL_USER).user_id


def _etag(character: Character) -> str:
    return f'"{character.version}"'


def _parse_if_match(value: str | None) -> int | None:
    if value is None:
        return None
    cleaned = value.strip().removeprefix("W/").strip('"')
    if not cleaned.isdigit():
        raise BadRequest('If-Match deve conter a versão da ficha, ex.: "3"', ifMatch=value)
    return int(cleaned)


def _character_response(character: Character, response: Response, c: Container, user: AuthUser | None) -> CharacterOut:
    response.headers["ETag"] = _etag(character)
    return CharacterOut.from_domain(character, access=c.characters.access(character, _uid(user)))


# --- Saúde ----------------------------------------------------------------------------------------


@router.get("/health", tags=["saúde"], summary="Liveness: o processo está de pé")
def health(c: ContainerDep) -> dict[str, Any]:
    return {"status": "ok", "service": c.settings.service_name, "version": __version__}


@router.get("/ready", tags=["saúde"], summary="Readiness: dependências acessíveis")
def ready(c: ContainerDep) -> JSONResponse:
    checks: dict[str, str] = {}
    probes = (("dynamodb", c.store.ping), ("readModel", c.read_model.ping), ("s3", c.storage.ping if c.storage else None))
    for name, probe in probes:
        if probe is None:
            checks[name] = "disabled"
            continue
        try:
            probe()
            checks[name] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks[name] = f"error: {type(exc).__name__}"
    if c.bus is None:
        checks["rabbitmq"] = "disabled"
    else:
        checks["rabbitmq"] = "ok" if c.bus.is_connected else "disconnected"
    healthy = all(v in ("ok", "disabled") for v in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503, content={"status": "ready" if healthy else "degraded", "checks": checks}
    )


# --- Fichas ---------------------------------------------------------------------------------------


@router.post(
    "/characters",
    tags=["personagens"],
    status_code=201,
    response_model=CharacterOut,
    summary="Criar ficha genérica",
    responses={200: {"description": "Repetição idempotente (mesma Idempotency-Key)"}},
)
def create_character(
    body: CharacterCreate,
    response: Response,
    c: ContainerDep,
    user: UserDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=128)] = None,
) -> CharacterOut:
    character, created = c.characters.create(body, idempotency_key, user_id=_uid(user))
    response.status_code = 201 if created else 200
    response.headers["Location"] = f"/characters/{character.id}"
    return _character_response(character, response, c, user)


@router.get("/characters", tags=["personagens"], response_model=CharacterPageOut, summary="Listar fichas de uma campanha")
def list_characters(
    c: ContainerDep,
    user: UserDep,
    campaign_id: Annotated[str, Query(alias="campaignId", pattern=r"^[A-Za-z0-9_-]{1,64}$")],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
) -> CharacterPageOut:
    try:
        page = c.characters.list_by_campaign(campaign_id, limit, cursor, user_id=_uid(user))
    except (ValueError, KeyError) as exc:
        raise BadRequest("cursor inválido") from exc
    return CharacterPageOut(items=[CharacterOut.from_domain(x) for x in page.items], nextCursor=page.next_cursor)


@router.get("/characters/{character_id}", tags=["personagens"], response_model=CharacterOut, summary="Consultar ficha")
def get_character(character_id: CharacterId, response: Response, c: ContainerDep, user: UserDep) -> CharacterOut:
    return _character_response(c.characters.get(character_id, user_id=_uid(user)), response, c, user)


@router.put("/characters/{character_id}/campaign", tags=["personagens"], response_model=CharacterOut,
            summary="Adicionar uma ficha pessoal a uma campanha")
def assign_character_campaign(character_id: CharacterId, body: CharacterAssignCampaign,
                              response: Response, c: ContainerDep, user: UserDep) -> CharacterOut:
    try:
        character = c.characters.assign_campaign(character_id, body.campaignId, user_id=_uid(user))
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    return _character_response(character, response, c, user)


@router.patch(
    "/characters/{character_id}",
    tags=["personagens"],
    response_model=CharacterOut,
    summary="Alterar ficha (JSON Merge Patch; If-Match opcional para concorrência otimista)",
)
def patch_character(
    character_id: CharacterId,
    body: CharacterPatch,
    response: Response,
    c: ContainerDep,
    user: UserDep,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Any:
    expected = _parse_if_match(if_match)
    try:
        character = c.characters.update(character_id, body, expected, user_id=_uid(user))
    except VersionConflict as exc:
        # Com If-Match a semântica HTTP correta é 412 Precondition Failed
        return error_response(412 if expected is not None else 409, exc.code, exc.message, exc.details)
    return _character_response(character, response, c, user)


@router.get(
    "/characters/{character_id}/holds",
    tags=["personagens"],
    summary="Reservas de capacidade da Saga (evidência para a demonstração)",
)
def list_holds(character_id: CharacterId, c: ContainerDep, user: UserDep) -> dict[str, list[HoldOut]]:
    return {"items": [HoldOut.from_domain(h) for h in c.characters.holds(character_id, user_id=_uid(user))]}


# --- Criação a partir de modelo ------------------------------------------------------------------

TemplateId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="ID do modelo")]


@router.post(
    "/characters/from-template/{template_id}",
    tags=["personagens"],
    status_code=201,
    response_model=CharacterOut,
    summary="Criar ficha copiando um modelo (a versão copiada fica registrada na ficha)",
    responses={200: {"description": "Repetição idempotente (mesma Idempotency-Key)"}},
)
def create_character_from_template(
    template_id: TemplateId,
    body: CharacterFromTemplate,
    response: Response,
    c: ContainerDep,
    user: UserDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=128)] = None,
) -> CharacterOut:
    template = c.templates.for_new_character(_owner(user), template_id, body.version, body.campaignId)
    character, created = c.characters.create_from_template(body, template, idempotency_key, user_id=_uid(user))
    response.status_code = 201 if created else 200
    response.headers["Location"] = f"/characters/{character.id}"
    return _character_response(character, response, c, user)


# --- Dinheiro -------------------------------------------------------------------------------------


@router.get(
    "/characters/{character_id}/money/transactions",
    tags=["dinheiro"],
    summary="Operações de dinheiro da ficha: débitos e reembolsos da loja",
)
def list_money(character_id: CharacterId, c: ContainerDep, user: UserDep) -> dict[str, list[MoneyEntryOut]]:
    entries = c.characters.money_entries(character_id, user_id=_uid(user))
    return {"items": [MoneyEntryOut.from_domain(m) for m in entries]}


# --- Modelos de ficha (templates privados) --------------------------------------------------------


def _template_response(template: Any, response: Response) -> TemplateOut:
    response.headers["ETag"] = f'"{template.version}"'
    return TemplateOut.from_domain(template)


@router.post("/templates", tags=["modelos"], status_code=201, response_model=TemplateOut, summary="Salvar modelo de ficha")
def create_template(body: TemplateCreate, response: Response, c: ContainerDep, user: UserDep) -> TemplateOut:
    template = c.templates.create(_owner(user), body)
    response.headers["Location"] = f"/templates/{template.id}"
    return _template_response(template, response)


@router.get("/templates", tags=["modelos"], summary="Meus modelos (versão atual de cada um)")
def list_templates(c: ContainerDep, user: UserDep) -> dict[str, list[TemplateOut]]:
    return {"items": [TemplateOut.from_domain(t) for t in c.templates.list(_owner(user))]}


@router.get("/templates/{template_id}", tags=["modelos"], response_model=TemplateOut, summary="Consultar modelo")
def get_template(
    template_id: TemplateId,
    response: Response,
    c: ContainerDep,
    user: UserDep,
    version: Annotated[int | None, Query(ge=1, description="Versão; sem ela, a atual")] = None,
) -> TemplateOut:
    return _template_response(c.templates.get(_owner(user), template_id, version), response)


@router.get(
    "/campaigns/{campaign_id}/template",
    tags=["modelos"],
    response_model=TemplateOut,
    summary="Modelo de ficha da campanha, na versão que o dono definiu (para quem participa dela)",
)
def get_campaign_template(
    campaign_id: Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="ID da campanha")],
    response: Response,
    c: ContainerDep,
    user: UserDep,
) -> TemplateOut:
    return _template_response(c.templates.for_campaign(_owner(user), campaign_id), response)


@router.patch(
    "/templates/{template_id}",
    tags=["modelos"],
    response_model=TemplateOut,
    summary="Alterar modelo: grava uma versão nova (fichas já criadas não mudam)",
)
def patch_template(
    template_id: TemplateId,
    body: TemplatePatch,
    response: Response,
    c: ContainerDep,
    user: UserDep,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Any:
    expected = _parse_if_match(if_match)
    try:
        template = c.templates.update(_owner(user), template_id, body, expected)
    except VersionConflict as exc:
        return error_response(412 if expected is not None else 409, exc.code, exc.message, exc.details)
    return _template_response(template, response)


@router.delete("/templates/{template_id}", tags=["modelos"], status_code=204, summary="Apagar modelo")
def delete_template(template_id: TemplateId, c: ContainerDep, user: UserDep) -> Response:
    c.templates.delete(_owner(user), template_id)
    return Response(status_code=204)


# --- Consulta pelo modelo de leitura (CQRS) --------------------------------------------------------


@router.get(
    "/campaigns/{campaign_id}/roster",
    tags=["consultas (CQRS)"],
    response_model=RosterOut,
    summary="Painel da campanha: resumo de cada personagem e totais, lido do modelo de leitura",
)
def campaign_roster(
    campaign_id: Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="ID da campanha")],
    c: ContainerDep,
    user: UserDep,
) -> RosterOut:
    c.characters.require_campaign_member(campaign_id, _uid(user))
    roster = c.roster.by_campaign(campaign_id)
    return RosterOut(
        campaignId=roster.campaign_id,
        totals=roster.totals,
        items=[CharacterSummaryOut.from_summary(s) for s in roster.items],
    )


# --- Retratos (S3) --------------------------------------------------------------------------------


@router.post(
    "/characters/{character_id}/portrait-upload",
    tags=["retratos"],
    response_model=PresignedUploadOut,
    summary="Gerar URL pré-assinada para upload direto ao S3",
)
def create_portrait_upload(
    character_id: CharacterId, body: PortraitUploadRequest, c: ContainerDep, user: UserDep
) -> PresignedUploadOut:
    presigned = c.characters.request_portrait_upload(character_id, body.contentType, user_id=_uid(user))
    return PresignedUploadOut(
        uploadUrl=presigned.url,
        method=presigned.method,
        headers=presigned.headers,
        key=presigned.key,
        expiresIn=presigned.expires_in,
        confirmUrl=f"/characters/{character_id}/portrait/confirm",
    )


@router.post(
    "/characters/{character_id}/portrait/confirm",
    tags=["retratos"],
    response_model=CharacterOut,
    summary="Confirmar upload pré-assinado (o S2 verifica tamanho, tipo e assinatura do arquivo)",
)
def confirm_portrait(character_id: CharacterId, response: Response, c: ContainerDep, user: UserDep) -> CharacterOut:
    return _character_response(c.characters.confirm_portrait(character_id, user_id=_uid(user)), response, c, user)


@router.put(
    "/characters/{character_id}/portrait",
    tags=["retratos"],
    response_model=CharacterOut,
    summary="Upload pelo backend (corpo binário image/png|jpeg|webp) — alternativa à URL pré-assinada",
)
async def upload_portrait(
    character_id: CharacterId, request: Request, response: Response, c: ContainerDep, user: UserDep
) -> CharacterOut:
    limit = c.settings.portrait_max_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise PayloadTooLarge(f"arquivo excede {limit} bytes")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise PayloadTooLarge(f"arquivo excede {limit} bytes")
        chunks.append(chunk)
    content_type = request.headers.get("content-type", "")
    if not content_type:
        raise InvalidPortrait("informe o Content-Type (image/png, image/jpeg ou image/webp)")
    character = await run_in_threadpool(
        partial(c.characters.upload_portrait, user_id=_uid(user)), character_id, b"".join(chunks), content_type
    )
    return _character_response(character, response, c, user)


@router.get(
    "/characters/{character_id}/portrait",
    tags=["retratos"],
    response_model=PortraitUrlOut,
    summary="URL pré-assinada de leitura do retrato (redirect=true para redirecionar)",
)
def get_portrait(character_id: CharacterId, c: ContainerDep, user: UserDep, redirect: Annotated[bool, Query()] = False) -> Any:
    url, content_type = c.characters.portrait_download_url(character_id, user_id=_uid(user))
    if redirect:
        return RedirectResponse(url, status_code=307)
    return PortraitUrlOut(url=url, expiresIn=c.characters.presign_expires_seconds, contentType=content_type)


@router.get(
    "/characters/{character_id}/portrait/content",
    tags=["retratos"],
    summary="Conteúdo do retrato servido pelo backend (fallback quando o S3 não é acessível pelo navegador)",
)
def get_portrait_content(character_id: CharacterId, c: ContainerDep) -> Response:
    data, content_type = c.characters.portrait_content(character_id)
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=60"})


# --- Endpoints internos de observação (demonstração F1–F8) ---------------------------------------

internal = APIRouter(prefix="/internal", tags=["interno (demonstração)"])


@internal.get("/outbox", summary="Eventos pendentes na outbox (F6: acumulam com o broker fora e escoam depois)")
def outbox_stats(c: ContainerDep) -> dict[str, Any]:
    stats = c.store.outbox_stats()
    return {
        "pending": stats.pending,
        "oldestPendingAt": stats.oldest_pending_at,
        "publishedByThisInstance": getattr(c.relay, "published", None),
        **stats.extra,
    }


@internal.get("/inbox/{message_id}", summary="Registro de uma mensagem processada (F2/F3: prova de efeito único)")
def inbox_record(message_id: Annotated[str, Path(max_length=64)], c: ContainerDep) -> Any:
    record = c.store.get_inbox(message_id)
    if record is None:
        return error_response(404, "MESSAGE_NOT_FOUND", "mensagem não consta na inbox")
    return {
        "messageId": record.message_id,
        "type": record.type,
        "correlationId": record.correlation_id,
        "outcome": record.outcome,
        "detail": record.detail,
        "receivedAt": record.received_at,
    }


@internal.post(
    "/read-model/rebuild",
    summary="Reconstrói o modelo de leitura de uma campanha a partir do modelo de escrita (CQRS)",
)
def rebuild_read_model(
    c: ContainerDep, campaign_id: Annotated[str, Query(alias="campaignId", pattern=r"^[A-Za-z0-9_-]{1,64}$")]
) -> dict[str, Any]:
    return {"campaignId": campaign_id, "rebuilt": c.projector.rebuild_campaign(campaign_id), "projector": c.projector.stats}


@internal.get("/read-model", summary="Contadores do projetor do modelo de leitura (CQRS)")
def read_model_stats(c: ContainerDep) -> dict[str, Any]:
    return {"table": c.settings.table_read_model, "projector": c.projector.stats}


@internal.get("/messaging", summary="Estado da conexão RabbitMQ, reconexões e contadores de consumo")
def messaging_stats(c: ContainerDep) -> dict[str, Any]:
    if c.bus is None:
        return {"enabled": False}
    return {"enabled": True, **c.bus.snapshot()}
