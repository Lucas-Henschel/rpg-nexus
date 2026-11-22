import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { HistoryService } from "../services/history.js";
import type { IdentityService } from "../services/identity.js";
import { bearerToken } from "./auth.js";
import { HistoryParams, HistoryQuery } from "./schemas.js";

export function historyRoutes(history: HistoryService, identity: IdentityService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/campaigns/:campaignId/history",
      { schema: { params: HistoryParams, querystring: HistoryQuery } },
      async (request) => {
        const user = await identity.me(bearerToken(request.headers.authorization));
        return {
          items: await history.list(request.params.campaignId, user.userId, request.query.limit),
        };
      },
    );
  };
}
