import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Env } from "../config.js";
import { createTokenVerifier } from "../security/tokens.js";
import type { CampaignService } from "../services/campaigns.js";
import { fastifyOtel } from "../tracing/http.js";
import { campaignRoutes } from "./campaigns.js";
import { errorHandler } from "./errors.js";
import { type HealthChecks, healthRoutes } from "./health.js";

export interface AppDeps extends HealthChecks {
  env: Env;
  campaigns: CampaignService;
  logger?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? true });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.register(fastifyOtel.plugin());
  app.register(cors, {
    origin: deps.env.CORS_ORIGINS,
    // O padrão do @fastify/cors permite apenas GET, HEAD e POST. As rotas de
    // participantes usam PUT e DELETE, que precisam constar na resposta do preflight.
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  app.register(healthRoutes(deps));
  app.register(campaignRoutes(deps.campaigns, createTokenVerifier(deps.env)));

  return app;
}
