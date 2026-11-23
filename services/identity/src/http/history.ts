import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { HistoryService } from "../services/history.js";
import type { IdentityService } from "../services/identity.js";
import { bearerToken } from "./auth.js";
import { HistoryParams, HistoryQuery } from "./schemas.js";
import { z } from "zod";

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
    app.get(
      "/campaigns/:campaignId/history/page",
      { schema: { params: HistoryParams, querystring: HistoryQuery.extend({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
      }) } },
      async (request) => {
        const user = await identity.me(bearerToken(request.headers.authorization));
        return history.listPage(request.params.campaignId, user.userId, request.query.limit, request.query.cursor);
      },
    );
  };
}
