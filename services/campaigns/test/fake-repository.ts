import type { Campaign } from "../src/domain/campaign.js";
import { CampaignAlreadyExists, CampaignNotFound } from "../src/domain/errors.js";
import type { Member } from "../src/domain/member.js";
import type { CampaignRepository } from "../src/domain/repository.js";

/** Repositório em memória, para testar as rotas sem DynamoDB. */
export function fakeRepository(): CampaignRepository {
  const campaigns = new Map<string, Campaign>();
  const members = new Map<string, Map<string, Member>>();

  return {
    async ping() {},

    async createCampaign(input, now) {
      if (campaigns.has(input.campaignId)) {
        throw new CampaignAlreadyExists(input.campaignId);
      }

      const campaign = { ...input, createdAt: now };

      campaigns.set(input.campaignId, campaign);
      members.set(input.campaignId, new Map());

      return campaign;
    },

    async listCampaigns() {
      return [...campaigns.values()];
    },

    async getCampaign(campaignId) {
      const campaign = campaigns.get(campaignId);

      return campaign
        ? { ...campaign, members: [...(members.get(campaignId)?.values() ?? [])], recentActivity: [] }
        : null;
    },

    async addMember(campaignId, characterId, characterName, now) {
      const list = members.get(campaignId);

      if (!list) {
        throw new CampaignNotFound(campaignId);
      }

      const old = list.get(characterId);
      const member = { characterId, characterName, itemsAcquired: old?.itemsAcquired ?? 0, joinedAt: old?.joinedAt ?? now };

      list.set(characterId, member);

      return { member, created: old === undefined };
    },

    async recordAcquisition() {
      return "applied";
    },
  };
}
