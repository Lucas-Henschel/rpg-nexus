import type { Campaign } from "../src/domain/campaign.js";
import { CampaignAlreadyExists } from "../src/domain/errors.js";
import type { Member } from "../src/domain/member.js";
import type { Repositories } from "../src/services/campaigns.js";

/** Repositórios em memória, para testar o serviço e as rotas sem DynamoDB. */
export function fakeRepositories(): Repositories {
  const campaigns = new Map<string, Campaign>();
  const members = new Map<string, Member>(); // chave: campaignId/characterId

  return {
    campaigns: {
      async create(campaign) {
        if (campaigns.has(campaign.campaignId)) {
          throw new CampaignAlreadyExists(campaign.campaignId);
        }

        campaigns.set(campaign.campaignId, campaign);
      },
      async find(campaignId) {
        return campaigns.get(campaignId) ?? null;
      },
      async list() {
        return [...campaigns.values()];
      },
    },

    members: {
      async list(campaignId) {
        return [...members.entries()].filter(([key]) => key.startsWith(`${campaignId}/`)).map(([, member]) => member);
      },
      async save(campaignId, { characterId, characterName }, now) {
        const key = `${campaignId}/${characterId}`;
        const old = members.get(key);
        const member = { characterId, characterName, itemsAcquired: old?.itemsAcquired ?? 0, joinedAt: old?.joinedAt ?? now };

        members.set(key, member);

        return { member, created: old === undefined };
      },
    },

    activity: {
      async listRecent() {
        return [];
      },
    },

    acquisitions: {
      async record() {
        return "applied";
      },
    },
  };
}
