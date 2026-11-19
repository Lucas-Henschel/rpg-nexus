// Rotas de campanhas e participantes. Todas exigem login; os erros (401, 403, 404, 409) são tratados no errors.ts.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { TokenVerifier } from "../security/tokens.js";
import type { CampaignService } from "../services/campaigns.js";
import { requireLogin, userOf } from "./auth.js";
import {
  CampaignParams,
  ChooseCharacterBody,
  CreateCampaignBody,
  JoinCampaignBody,
  MemberParams,
} from "./schemas.js";

export function campaignRoutes(
  service: CampaignService,
  verify: TokenVerifier,
): FastifyPluginAsyncZod {
  return async (app) => {
    requireLogin(app, verify);

    app.post("/campaigns", { schema: { body: CreateCampaignBody } }, async (request, reply) => {
      const campaign = await service.create(request.body, userOf(request));

      return reply.status(201).send(campaign);
    });

    app.get("/users/me/campaigns", async (request) => {
      return { items: await service.listMine(userOf(request)) };
    });

    app.post("/campaigns/join", { schema: { body: JoinCampaignBody } }, async (request, reply) => {
      const { campaign, created } = await service.join(request.body.joinCode, userOf(request));

      return reply.status(created ? 201 : 200).send(campaign);
    });

    app.get("/campaigns/:campaignId", { schema: { params: CampaignParams } }, async (request) => {
      return service.get(request.params.campaignId, userOf(request));
    });

    app.get(
      "/campaigns/:campaignId/members",
      { schema: { params: CampaignParams } },
      async (request) => {
        return { items: await service.listMembers(request.params.campaignId, userOf(request)) };
      },
    );

    app.put(
      "/campaigns/:campaignId/members/me/character",
      { schema: { params: CampaignParams, body: ChooseCharacterBody } },
      async (request) => {
        return service.chooseCharacter(request.params.campaignId, userOf(request), request.body);
      },
    );

    app.delete(
      "/campaigns/:campaignId/members/:userId",
      { schema: { params: MemberParams } },
      async (request, reply) => {
        const { campaignId, userId } = request.params;

        await service.removeMember(campaignId, userOf(request), userId);

        return reply.status(204).send();
      },
    );
  };
}
