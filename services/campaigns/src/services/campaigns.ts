// Regras de campanhas e participantes. As rotas HTTP e o consumidor usam este serviço, nunca os repositórios direto.
import { randomUUID } from "node:crypto";
import type { Acquisition } from "../domain/acquisition.js";
import type { Campaign, CampaignView } from "../domain/campaign.js";
import { CampaignNotFound } from "../domain/errors.js";
import type { AcquisitionRepository } from "../repositories/acquisition-repository.js";
import type { ActivityRepository } from "../repositories/activity-repository.js";
import type { CampaignRepository } from "../repositories/campaign-repository.js";
import type { MemberRepository } from "../repositories/member-repository.js";

export interface Repositories {
  campaigns: CampaignRepository;
  members: MemberRepository;
  activity: ActivityRepository;
  acquisitions: AcquisitionRepository;
}

export interface NewCampaign {
  name: string;
  gameMaster?: string;
  campaignId?: string;
}

export interface NewMember {
  characterId: string;
  characterName: string;
}

/** Data e hora atuais em ISO 8601; os testes passam uma fixa. */
export type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

export function createCampaignService(
  { campaigns, members, activity, acquisitions }: Repositories,
  clock: Clock = systemClock,
) {
  async function requireCampaign(campaignId: string): Promise<Campaign> {
    const campaign = await campaigns.find(campaignId);

    if (!campaign) {
      throw new CampaignNotFound(campaignId);
    }

    return campaign;
  }

  return {
    /** Sem código, gera um UUID. Lança CampaignAlreadyExists se o código já estiver em uso. */
    async create({ name, gameMaster, campaignId = randomUUID() }: NewCampaign): Promise<Campaign> {
      const campaign: Campaign = {
        campaignId,
        name,
        gameMaster: gameMaster ?? null,
        createdAt: clock(),
      };

      await campaigns.create(campaign);

      return campaign;
    },

    list() {
      return campaigns.list();
    },

    /** A campanha com participantes e atividade recente. Lança CampaignNotFound se não existir. */
    async get(campaignId: string): Promise<CampaignView> {
      const campaign = await requireCampaign(campaignId);

      const [campaignMembers, recentActivity] = await Promise.all([
        members.list(campaignId),
        activity.listRecent(campaignId),
      ]);

      return { ...campaign, members: campaignMembers, recentActivity };
    },

    /** Adiciona o personagem ou só atualiza o nome. Lança CampaignNotFound se a campanha não existir. */
    async addMember(campaignId: string, member: NewMember) {
      await requireCampaign(campaignId);

      return members.save(campaignId, member, clock());
    },

    /** Item conquistado (evento do RabbitMQ): vira atividade e soma no contador do participante. */
    recordAcquisition(acquisition: Acquisition) {
      return acquisitions.record(acquisition, clock());
    },
  };
}

export type CampaignService = ReturnType<typeof createCampaignService>;
