import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import {
  InvalidAccessToken,
  InvalidCredentials,
  InvalidRefreshToken,
  UserAlreadyExists,
  UserInactive,
} from "../domain/errors.js";

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map((issue) => ({
      field: issue.instancePath.slice(1).replaceAll("/", "."),
      message: issue.message,
    }));
    return reply.status(422).send(errorBody("VALIDATION_ERROR", "requisição inválida", details));
  }

  if (error instanceof UserAlreadyExists) {
    return reply.status(409).send(errorBody("USER_ALREADY_EXISTS", "e-mail ou nome de usuário já cadastrado"));
  }

  if (error instanceof InvalidCredentials) {
    return reply.status(401).send(errorBody("INVALID_CREDENTIALS", "credenciais inválidas"));
  }

  if (error instanceof InvalidRefreshToken) {
    return reply.status(401).send(errorBody("INVALID_REFRESH_TOKEN", "sessão inválida ou expirada"));
  }

  if (error instanceof InvalidAccessToken) {
    return reply.status(401).send(errorBody("INVALID_ACCESS_TOKEN", "token ausente, inválido ou expirado"));
  }

  if (error instanceof UserInactive) {
    return reply.status(403).send(errorBody("USER_INACTIVE", "usuário desativado"));
  }

  if (error.statusCode !== undefined && error.statusCode < 500) {
    return reply.status(error.statusCode).send(errorBody("INVALID_REQUEST", "requisição inválida"));
  }

  request.log.error({ err: error }, "http.unhandled_error");
  return reply.status(500).send(errorBody("INTERNAL_ERROR", "erro interno"));
}
