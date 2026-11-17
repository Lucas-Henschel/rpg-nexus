// Rotas de campanhas e participantes. Os erros (404, 409) são tratados no app.ts.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { CampaignService } from "../services/campaigns.js";
import { AddMemberBody, CampaignParams, CreateCampaignBody } from "./schemas.js";

export function campaignRoutes(service: CampaignService): FastifyPluginAsyncZod {
  return async (app) => {
    app.post("/campaigns", { schema: { body: CreateCampaignBody } }, async (request, reply) => {
      const campaign = await service.create(request.body);

      return reply.status(201).send(campaign);
    });

    app.get("/campaigns", async () => {
      return { items: await service.list() };
    });

    app.get("/campaigns/:campaignId", { schema: { params: CampaignParams } }, async (request) => {
      return service.get(request.params.campaignId);
    });

    app.post(
      "/campaigns/:campaignId/members",
      { schema: { params: CampaignParams, body: AddMemberBody } },
      async (request, reply) => {
        const { member, created } = await service.addMember(request.params.campaignId, request.body);

        return reply.status(created ? 201 : 200).send(member);
      },
    );
  };
}
