import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Env } from "../config.js";

export interface AppDeps {
  env: Env;
  repository: { ping(): Promise<void> };
  isBusConnected: () => boolean;
  logger?: boolean;
}

/** Formato de erro combinado entre os serviços: {"error": {"code", "message", "details"}}. */
export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? true });

  // As rotas declaram corpo e parâmetros com zod.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(cors, { origin: deps.env.CORS_ORIGINS });

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        field: issue.instancePath.slice(1).replaceAll("/", "."),
        message: issue.message,
      }));

      return reply.status(422).send(errorBody("VALIDATION_ERROR", "requisição inválida", details));
    }

    request.log.error({ err: error }, "http.unhandled_error");

    return reply.status(500).send(errorBody("INTERNAL_ERROR", "erro interno"));
  });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
