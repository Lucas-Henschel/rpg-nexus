import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { CampaignAlreadyExists, CampaignNotFound } from "../domain/errors.js";

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

  if (error instanceof CampaignNotFound) {
    const details = { campaignId: error.campaignId };

    return reply.status(404).send(errorBody("CAMPAIGN_NOT_FOUND", "campanha não encontrada", details));
  }

  if (error instanceof CampaignAlreadyExists) {
    const details = { campaignId: error.campaignId };

    return reply.status(409).send(errorBody("CAMPAIGN_ALREADY_EXISTS", "campanha já existe", details));
  }

  request.log.error({ err: error }, "http.unhandled_error");

  return reply.status(500).send(errorBody("INTERNAL_ERROR", "erro interno"));
}
