// Regras de campanhas e participantes. As rotas HTTP usam este serviço, nunca o repositório direto.
import { randomUUID } from "node:crypto";
import type { Acquisition } from "../domain/acquisition.js";
import type { CampaignRepository } from "../domain/repository.js";
import { CampaignNotFound } from "../domain/errors.js";

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

export function createCampaignService(repository: CampaignRepository, clock: Clock = systemClock) {
  return {
    /** Lança CampaignAlreadyExists se o código já estiver em uso. */
    create({ name, gameMaster, campaignId = randomUUID() }: NewCampaign) {
      return repository.createCampaign({ campaignId, name, gameMaster: gameMaster ?? null }, clock());
    },

    list() {
      return repository.listCampaigns();
    },

    /** A campanha com participantes e atividade recente. Lança CampaignNotFound se não existir. */
    async get(campaignId: string) {
      const campaign = await repository.getCampaign(campaignId);

      if (!campaign) {
        throw new CampaignNotFound(campaignId);
      }

      return campaign;
    },

    /** Adiciona o personagem ou só atualiza o nome. Lança CampaignNotFound se a campanha não existir. */
    addMember(campaignId: string, { characterId, characterName }: NewMember) {
      return repository.addMember(campaignId, characterId, characterName, clock());
    },

    /** Item conquistado (evento do RabbitMQ): vira atividade e soma no contador do participante. */
    recordAcquisition(acquisition: Acquisition) {
      return repository.recordAcquisition(acquisition, clock());
    },
  };
}

export type CampaignService = ReturnType<typeof createCampaignService>;
