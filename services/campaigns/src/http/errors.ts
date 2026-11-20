import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import {
  CampaignNotFound,
  CharacterInUse,
  CharactersUnavailable,
  JoinCodeNotFound,
  MemberNotFound,
  NotCampaignMember,
  NotCampaignOwner,
  OwnerCannotLeave,
  TemplateNotFound,
  Unauthenticated,
} from "../domain/errors.js";

/** Formato de erro combinado entre os serviços: {"error": {"code", "message", "details"}}. */
export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}

/** Todo erro lançado por uma rota chega aqui e vira a resposta HTTP correspondente. */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map((issue) => ({
      field: issue.instancePath.slice(1).replaceAll("/", "."),
      message: issue.message,
    }));

    return reply.status(422).send(errorBody("VALIDATION_ERROR", "requisição inválida", details));
  }

  const known = domainError(error);

  if (known) {
    return reply.status(known.status).send(errorBody(known.code, known.message, known.details));
  }

  // Erros do próprio Fastify por culpa de quem chamou (JSON malformado, corpo vazio, tipo de conteúdo).
  if (error.statusCode !== undefined && error.statusCode < 500) {
    const details = { reason: error.message };

    return reply
      .status(error.statusCode)
      .send(errorBody("INVALID_REQUEST", "requisição inválida", details));
  }

  request.log.error({ err: error }, "http.unhandled_error");

  return reply.status(500).send(errorBody("INTERNAL_ERROR", "erro interno"));
}

/** Erros das regras de campanha: status, código e mensagem de cada um. */
function domainError(error: unknown) {
  if (error instanceof Unauthenticated) {
    return { status: 401, code: "UNAUTHENTICATED", message: "faça login para continuar" };
  }

  if (error instanceof NotCampaignMember) {
    const details = { campaignId: error.campaignId };

    return {
      status: 403,
      code: "NOT_A_MEMBER",
      message: "você não participa da campanha",
      details,
    };
  }

  if (error instanceof NotCampaignOwner) {
    const details = { campaignId: error.campaignId };
    const message = "só o dono da campanha pode fazer isso";

    return { status: 403, code: "NOT_CAMPAIGN_OWNER", message, details };
  }

  if (error instanceof CampaignNotFound) {
    const details = { campaignId: error.campaignId };

    return { status: 404, code: "CAMPAIGN_NOT_FOUND", message: "campanha não encontrada", details };
  }

  if (error instanceof JoinCodeNotFound) {
    const details = { joinCode: error.joinCode };
    const message = "nenhuma campanha com esse código";

    return { status: 404, code: "JOIN_CODE_NOT_FOUND", message, details };
  }

  if (error instanceof MemberNotFound) {
    const details = { campaignId: error.campaignId, userId: error.userId };
    const message = "esse usuário não participa da campanha";

    return { status: 404, code: "MEMBER_NOT_FOUND", message, details };
  }

  if (error instanceof OwnerCannotLeave) {
    const details = { campaignId: error.campaignId };
    const message = "o dono não pode sair da campanha";

    return { status: 409, code: "OWNER_CANNOT_LEAVE", message, details };
  }

  if (error instanceof CharacterInUse) {
    const details = { campaignId: error.campaignId, characterId: error.characterId };
    const message = "outro participante já usa esse personagem";

    return { status: 409, code: "CHARACTER_IN_USE", message, details };
  }

  if (error instanceof TemplateNotFound) {
    const details = { templateId: error.templateId, version: error.version };
    const message = "modelo não encontrado entre os seus";

    return { status: 404, code: "TEMPLATE_NOT_FOUND", message, details };
  }

  if (error instanceof CharactersUnavailable) {
    const message = "o serviço de personagens não respondeu; tente de novo";

    return { status: 503, code: "CHARACTERS_UNAVAILABLE", message };
  }

  return null;
}
