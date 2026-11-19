// Regras de campanhas e participantes. As rotas HTTP e o consumidor usam este serviço, nunca os repositórios direto.
import { randomUUID } from "node:crypto";
import type { Acquisition } from "../domain/acquisition.js";
import type { Campaign, CampaignView } from "../domain/campaign.js";
import {
  CampaignNotFound,
  CharacterInUse,
  JoinCodeNotFound,
  JoinCodeTaken,
  MemberNotFound,
  NotCampaignMember,
  NotCampaignOwner,
  OwnerCannotLeave,
} from "../domain/errors.js";
import { randomJoinCode } from "../domain/join-code.js";
import type { Member } from "../domain/member.js";
import type { AuthUser } from "../domain/user.js";
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
}

export interface ChosenCharacter {
  characterId: string;
  characterName: string;
}

/** Data e hora atuais em ISO 8601; os testes passam uma fixa. */
export type Clock = () => string;

export interface ServiceOptions {
  clock?: Clock;
  /** Sorteia um código de entrada; os testes passam uma sequência conhecida. */
  joinCode?: () => string;
}

/** Tentativas de sortear um código livre. Com um milhão de códigos, repetir cinco vezes é quase impossível. */
const JOIN_CODE_ATTEMPTS = 5;

export function createCampaignService(
  { campaigns, members, activity, acquisitions }: Repositories,
  { clock = () => new Date().toISOString(), joinCode = randomJoinCode }: ServiceOptions = {},
) {
  async function requireCampaign(campaignId: string): Promise<Campaign> {
    const campaign = await campaigns.find(campaignId);

    if (!campaign) {
      throw new CampaignNotFound(campaignId);
    }

    return campaign;
  }

  /** A campanha e o participante que fez a requisição. Lança NotCampaignMember se ele não participa. */
  async function requireMember(campaignId: string, user: AuthUser) {
    const campaign = await requireCampaign(campaignId);
    const member = await members.find(campaignId, user.userId);

    if (!member) {
      throw new NotCampaignMember(campaignId);
    }

    return { campaign, member };
  }

  const newMember = (user: AuthUser, role: Member["role"]): Member => ({
    userId: user.userId,
    username: user.username,
    role,
    characterId: null,
    characterName: null,
    itemsAcquired: 0,
    joinedAt: clock(),
  });

  return {
    /** Quem cria vira o dono (OWNER). A campanha ganha um código de entrada de seis dígitos que não se repete. */
    async create({ name }: NewCampaign, user: AuthUser): Promise<Campaign> {
      for (let attempt = 1; attempt <= JOIN_CODE_ATTEMPTS; attempt++) {
        const campaign: Campaign = {
          campaignId: randomUUID(),
          name,
          ownerId: user.userId,
          ownerName: user.username,
          joinCode: joinCode(),
          createdAt: clock(),
        };

        try {
          await campaigns.create(campaign, newMember(user, "OWNER"));

          return campaign;
        } catch (error) {
          if (!(error instanceof JoinCodeTaken)) {
            throw error;
          }
        }
      }

      throw new Error(`nenhum código de entrada livre em ${JOIN_CODE_ATTEMPTS} tentativas`);
    },

    /** As campanhas de que o usuário participa, da mais antiga para a mais nova. */
    async listMine(user: AuthUser): Promise<Campaign[]> {
      const found = await campaigns.findMany(await members.campaignIdsOf(user.userId));

      return found.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    /** A campanha com participantes e atividade recente. Só para quem participa. */
    async get(campaignId: string, user: AuthUser): Promise<CampaignView> {
      const { campaign } = await requireMember(campaignId, user);

      const [campaignMembers, recentActivity] = await Promise.all([
        members.list(campaignId),
        activity.listRecent(campaignId),
      ]);

      return { ...campaign, members: sortMembers(campaignMembers), recentActivity };
    },

    async listMembers(campaignId: string, user: AuthUser): Promise<Member[]> {
      await requireMember(campaignId, user);

      return sortMembers(await members.list(campaignId));
    },

    /** Entra como PLAYER pelo código. Repetir não duplica nem rebaixa o dono. */
    async join(code: string, user: AuthUser): Promise<{ campaign: Campaign; created: boolean }> {
      const campaign = await campaigns.findByJoinCode(code);

      if (!campaign) {
        throw new JoinCodeNotFound(code);
      }

      const { created } = await members.add(campaign.campaignId, newMember(user, "PLAYER"));

      return { campaign, created };
    },

    /** O personagem que o participante usa nesta campanha. Dois participantes não usam o mesmo. */
    async chooseCharacter(campaignId: string, user: AuthUser, character: ChosenCharacter) {
      await requireMember(campaignId, user);

      const taken = (await members.list(campaignId)).some(
        (member) => member.characterId === character.characterId && member.userId !== user.userId,
      );

      if (taken) {
        throw new CharacterInUse(campaignId, character.characterId);
      }

      return members.setCharacter(campaignId, user.userId, character);
    },

    /** O jogador sai, ou o dono remove um jogador. O dono não sai. */
    async removeMember(campaignId: string, user: AuthUser, userId: string): Promise<void> {
      const { member: actor } = await requireMember(campaignId, user);

      if (userId !== user.userId && actor.role !== "OWNER") {
        throw new NotCampaignOwner(campaignId);
      }

      const target = userId === user.userId ? actor : await members.find(campaignId, userId);

      if (!target) {
        throw new MemberNotFound(campaignId, userId);
      }

      if (target.role === "OWNER") {
        throw new OwnerCannotLeave(campaignId);
      }

      await members.remove(campaignId, userId);
    },

    /** Item conquistado (evento do RabbitMQ): vira atividade e soma no participante que usa o personagem. */
    async recordAcquisition(acquisition: Acquisition) {
      const owner = (await members.list(acquisition.campaignId)).find(
        (member) => member.characterId === acquisition.characterId,
      );

      return acquisitions.record(acquisition, clock(), owner?.userId ?? null);
    },
  };
}

/** O dono primeiro; depois por ordem de entrada. */
function sortMembers(list: Member[]): Member[] {
  return [...list].sort(
    (a, b) =>
      Number(b.role === "OWNER") - Number(a.role === "OWNER") ||
      a.joinedAt.localeCompare(b.joinedAt),
  );
}

export type CampaignService = ReturnType<typeof createCampaignService>;
