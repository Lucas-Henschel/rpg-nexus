// Regras de campanhas e participantes. As rotas HTTP e o consumidor usam este serviço, nunca os repositórios direto.
import { randomUUID } from "node:crypto";
import type { Acquisition } from "../domain/acquisition.js";
import type { AssignedTemplate, Campaign, CampaignView } from "../domain/campaign.js";
import {
  CampaignNotFound,
  CharacterInUse,
  CharactersUnavailable,
  JoinCodeNotFound,
  JoinCodeTaken,
  MemberNotFound,
  NotCampaignMember,
  NotCampaignOwner,
  OwnerCannotLeave,
  TemplateNotFound,
} from "../domain/errors.js";
import { randomJoinCode } from "../domain/join-code.js";
import type { Member } from "../domain/member.js";
import type { AuthUser } from "../domain/user.js";
import {
  campaignCreated,
  memberCharacterChosen,
  memberJoined,
  memberRemoved,
  templateAssigned,
} from "../messaging/outgoing.js";
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

/** O modelo que o dono escolheu; sem versão, vale a atual. */
export interface TemplateChoice {
  templateId: string;
  version?: number;
}

/** Um modelo como o S2 o mostra a quem perguntou. */
export interface TemplateRef {
  templateId: string;
  version: number;
  name: string;
}

/** Os modelos de ficha do S2. */
export interface TemplateCatalog {
  /**
   * O modelo nessa versão (sem versão, a atual), visto com o token de quem chamou. null se ele não
   * existe ou não é dessa pessoa. Lança CharactersUnavailable se o S2 não responder.
   */
  find(
    templateId: string,
    version: number | undefined,
    authorization: string,
  ): Promise<TemplateRef | null>;
}

/** Sem o S2 configurado, escolher modelo responde como se ele estivesse fora. */
const noTemplates: TemplateCatalog = {
  async find() {
    throw new CharactersUnavailable();
  },
};

/** Data e hora atuais em ISO 8601; os testes passam uma fixa. */
export type Clock = () => string;

export interface ServiceOptions {
  clock?: Clock;
  /** Sorteia um código de entrada; os testes passam uma sequência conhecida. */
  joinCode?: () => string;
  templates?: TemplateCatalog;
}

/** Tentativas de sortear um código livre. Com um milhão de códigos, repetir cinco vezes é quase impossível. */
const JOIN_CODE_ATTEMPTS = 5;

export function createCampaignService(
  { campaigns, members, activity, acquisitions }: Repositories,
  {
    clock = () => new Date().toISOString(),
    joinCode = randomJoinCode,
    templates = noTemplates,
  }: ServiceOptions = {},
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
    /**
     * Quem cria vira o dono (OWNER). A campanha ganha um código de entrada de seis dígitos que não se
     * repete. Publica CampaignCreated e a entrada do dono (CampaignMemberJoined).
     */
    async create({ name }: NewCampaign, user: AuthUser): Promise<Campaign> {
      for (let attempt = 1; attempt <= JOIN_CODE_ATTEMPTS; attempt++) {
        const campaign: Campaign = {
          campaignId: randomUUID(),
          name,
          ownerId: user.userId,
          ownerName: user.username,
          joinCode: joinCode(),
          createdAt: clock(),
          template: null,
        };

        const owner = newMember(user, "OWNER");

        try {
          await campaigns.create(campaign, owner, [
            campaignCreated(campaign),
            memberJoined(campaign.campaignId, owner),
          ]);

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

    /** Entra como PLAYER pelo código e publica CampaignMemberJoined. Repetir não duplica nem rebaixa o dono. */
    async join(code: string, user: AuthUser): Promise<{ campaign: Campaign; created: boolean }> {
      const campaign = await campaigns.findByJoinCode(code);

      if (!campaign) {
        throw new JoinCodeNotFound(code);
      }

      const member = newMember(user, "PLAYER");
      const { created } = await members.add(
        campaign.campaignId,
        member,
        memberJoined(campaign.campaignId, member),
      );

      return { campaign, created };
    },

    /** O personagem que o participante usa nesta campanha. Dois participantes não usam o mesmo. */
    async chooseCharacter(campaignId: string, user: AuthUser, character: ChosenCharacter) {
      const { member } = await requireMember(campaignId, user);

      const taken = (await members.list(campaignId)).some(
        (member) => member.characterId === character.characterId && member.userId !== user.userId,
      );

      if (taken) {
        throw new CharacterInUse(campaignId, character.characterId);
      }

      // O mesmo personagem de novo não muda nada: nem grava, nem publica outro evento.
      if (
        member.characterId === character.characterId &&
        member.characterName === character.characterName
      ) {
        return member;
      }

      const updated: Member = { ...member, ...character };

      // Se o participante saiu ou foi removido no meio do caminho, ele já não participa.
      if (
        !(await members.setCharacter(
          campaignId,
          user.userId,
          character,
          memberCharacterChosen(campaignId, updated, clock()),
        ))
      ) {
        throw new NotCampaignMember(campaignId);
      }

      return updated;
    },

    /** O jogador sai, ou o dono remove um jogador, e publica CampaignMemberRemoved. O dono não sai. */
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

      const leaving = userId === user.userId;

      // Se outra requisição removeu antes, não há o que fazer: o evento dela já foi gravado.
      await members.remove(
        campaignId,
        userId,
        memberRemoved(campaignId, {
          userId,
          removedBy: user.userId,
          reason: leaving ? "LEFT" : "REMOVED",
          removedAt: clock(),
        }),
      );
    },

    /**
     * O dono escolhe, entre os modelos dele no S2, o que os jogadores usam, numa versão fixa, e
     * publica CampaignTemplateAssigned. Escolher de novo o mesmo modelo e a mesma versão não publica.
     * `authorization` é o cabeçalho de quem chamou, repassado ao S2.
     */
    async assignTemplate(
      campaignId: string,
      user: AuthUser,
      { templateId, version }: TemplateChoice,
      authorization: string,
    ): Promise<Campaign> {
      const { campaign, member } = await requireMember(campaignId, user);

      if (member.role !== "OWNER") {
        throw new NotCampaignOwner(campaignId);
      }

      const found = await templates.find(templateId, version, authorization);

      if (!found) {
        throw new TemplateNotFound(templateId, version);
      }

      if (
        campaign.template?.templateId === found.templateId &&
        campaign.template.version === found.version
      ) {
        return campaign;
      }

      const template: AssignedTemplate = { ...found, assignedAt: clock() };

      await campaigns.assignTemplate(
        campaignId,
        template,
        templateAssigned(campaignId, user.userId, template),
      );

      return { ...campaign, template };
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
