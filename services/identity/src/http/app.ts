import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Env } from "../config.js";
import type { IdentityService } from "../services/identity.js";
import type { HistoryService } from "../services/history.js";
import { authRoutes } from "./auth.js";
import { errorHandler } from "./errors.js";
import { type HealthChecks, healthRoutes } from "./health.js";
import { historyRoutes } from "./history.js";

export interface AppDeps extends HealthChecks {
  env: Env;
  identity: IdentityService;
  history: HistoryService;
  logger?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? {
      redact: ["req.headers.authorization", "req.body.password", "req.body.refreshToken", "res.headers.authorization"],
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.register(cors, { origin: deps.env.CORS_ORIGINS });
  app.register(healthRoutes(deps));
  app.register(authRoutes(deps.identity));
  app.register(historyRoutes(deps.history, deps.identity));
  return app;
}
