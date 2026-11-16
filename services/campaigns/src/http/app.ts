import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Env } from "../config.js";
import type { CampaignService } from "../services/campaigns.js";
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
  app.register(cors, { origin: deps.env.CORS_ORIGINS });

  app.register(healthRoutes(deps));
  app.register(campaignRoutes(deps.campaigns));

  return app;
}
