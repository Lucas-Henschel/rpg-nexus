import type { Campaign } from "../src/domain/campaign.js";
import { JoinCodeTaken } from "../src/domain/errors.js";
import type { Member } from "../src/domain/member.js";
import type { OutboxMessage } from "../src/messaging/outgoing.js";
import type { Repositories } from "../src/services/campaigns.js";

/**
 * Repositórios em memória, para testar o serviço e as rotas sem DynamoDB. `outbox` guarda os eventos
 * gravados junto com cada mudança, na ordem.
 */
export function fakeRepositories(): Repositories & { outbox: OutboxMessage[] } {
  const campaigns = new Map<string, Campaign>();
  const members = new Map<string, Member>(); // chave: campaignId/userId
  const key = (campaignId: string, userId: string) => `${campaignId}/${userId}`;
  const outbox: OutboxMessage[] = [];

  return {
    outbox,

    campaigns: {
      async create(campaign, owner, events) {
        if ([...campaigns.values()].some((c) => c.joinCode === campaign.joinCode)) {
          throw new JoinCodeTaken(campaign.joinCode);
        }

        campaigns.set(campaign.campaignId, campaign);
        members.set(key(campaign.campaignId, owner.userId), owner);
        outbox.push(...events);
      },
      async find(campaignId) {
        return campaigns.get(campaignId) ?? null;
      },
      async assignTemplate(campaignId, template, event) {
        campaigns.set(campaignId, { ...campaigns.get(campaignId)!, template });
        outbox.push(event);
      },
      async findByJoinCode(joinCode) {
        return [...campaigns.values()].find((c) => c.joinCode === joinCode) ?? null;
      },
      async findMany(campaignIds) {
        return campaignIds.flatMap((id) => campaigns.get(id) ?? []);
      },
    },

    members: {
      async list(campaignId) {
        return [...members.entries()]
          .filter(([k]) => k.startsWith(`${campaignId}/`))
          .map(([, member]) => member);
      },
      async find(campaignId, userId) {
        return members.get(key(campaignId, userId)) ?? null;
      },
      async add(campaignId, member, event) {
        const old = members.get(key(campaignId, member.userId));

        if (old) {
          return { member: old, created: false };
        }

        members.set(key(campaignId, member.userId), member);
        outbox.push(event);

        return { member, created: true };
      },
      async campaignIdsOf(userId) {
        return [...members.keys()]
          .filter((k) => k.endsWith(`/${userId}`))
          .map((k) => k.slice(0, k.lastIndexOf("/")));
      },
      async setCharacter(campaignId, userId, { characterId, characterName }, event) {
        const member = members.get(key(campaignId, userId));

        if (!member) {
          return false;
        }

        members.set(key(campaignId, userId), { ...member, characterId, characterName });
        outbox.push(event);

        return true;
      },
      async remove(campaignId, userId, event) {
        if (!members.delete(key(campaignId, userId))) {
          return false;
        }

        outbox.push(event);

        return true;
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
