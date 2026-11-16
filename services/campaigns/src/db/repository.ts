// Junta as funções de db/ na interface que as rotas e o consumidor usam.
import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { CampaignRepository } from "../domain/repository.js";
import { listRecentActivity, recordAcquisition } from "./acquisitions.js";
import { createCampaign, findCampaign, listCampaigns } from "./campaigns.js";
import type { Db } from "./client.js";
import { addMember, listMembers } from "./members.js";
import type { Tables } from "./tables.js";

export function createRepository(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  inboxTtlDays: number,
): CampaignRepository {
  const db: Db = { doc, tables };

  return {
    async ping() {
      await doc.send(new DescribeTableCommand({ TableName: tables.campaigns }));
    },

    createCampaign: (input, now) => createCampaign(db, input, now),

    listCampaigns: () => listCampaigns(db),

    async getCampaign(campaignId) {
      const campaign = await findCampaign(db, campaignId);

      if (!campaign) {
        return null;
      }

      const [members, recentActivity] = await Promise.all([
        listMembers(db, campaignId),
        listRecentActivity(db, campaignId),
      ]);

      return { ...campaign, members, recentActivity };
    },

    addMember: (campaignId, characterId, characterName, now) =>
      addMember(db, campaignId, characterId, characterName, now),

    recordAcquisition: (acquisition, now) => recordAcquisition(db, acquisition, now, inboxTtlDays),
  };
}
