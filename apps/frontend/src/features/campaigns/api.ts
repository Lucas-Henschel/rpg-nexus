/** Adaptador tipado do S1 Campanhas. As telas nunca chamam fetch direto. Toda rota exige login. */
import { services } from "../../shared/config";
import { jsonBody } from "../../shared/http";
import { authorizedRequest } from "../auth/session";

const base = services.campaigns.url;
const path = (campaignId: string) => `/campaigns/${encodeURIComponent(campaignId)}`;

export interface Campaign {
  campaignId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  /** Seis algarismos; é o que os jogadores digitam para entrar. */
  joinCode: string;
  createdAt: string;
  /** O modelo de ficha que os jogadores usam; null até o mestre escolher. */
  template: CampaignTemplate | null;
}

/** Um modelo do S2 numa versão fixa: editar o modelo depois não muda a campanha. */
export interface CampaignTemplate {
  templateId: string;
  version: number;
  name: string;
  assignedAt: string;
}

export type Role = "OWNER" | "PLAYER";

export interface Member {
  userId: string;
  username: string;
  role: Role;
  /** null até o participante escolher o personagem que usa na campanha. */
  characterId: string | null;
  characterName: string | null;
  itemsAcquired: number;
  joinedAt: string;
}

export interface Activity {
  operationId: string;
  characterId: string;
  itemId: string;
  itemName: string | null;
  quantity: number;
  occurredAt: string;
}

/** A campanha com participantes (o dono primeiro) e as últimas atividades, da mais nova para a mais antiga. */
export interface CampaignView extends Campaign {
  members: Member[];
  recentActivity: Activity[];
}

/** As campanhas de que a pessoa logada participa. */
export async function listMyCampaigns(): Promise<Campaign[]> {
  return (await authorizedRequest<{ items: Campaign[] }>(base, "/users/me/campaigns")).data.items;
}

export async function getCampaign(campaignId: string): Promise<CampaignView> {
  return (await authorizedRequest<CampaignView>(base, path(campaignId))).data;
}

/** Quem cria vira o dono; o código de entrada é gerado pelo serviço. */
export async function createCampaign(name: string): Promise<Campaign> {
  const init = { method: "POST", ...jsonBody({ name }) };

  return (await authorizedRequest<Campaign>(base, "/campaigns", init)).data;
}

/** Entra pelo código. Repetir não duplica. */
export async function joinCampaign(joinCode: string): Promise<Campaign> {
  const init = { method: "POST", ...jsonBody({ joinCode }) };

  return (await authorizedRequest<Campaign>(base, "/campaigns/join", init)).data;
}

/** O personagem que a pessoa logada usa nesta campanha. */
export async function chooseCharacter(
  campaignId: string,
  characterId: string,
  characterName: string,
): Promise<Member> {
  const init = { method: "PUT", ...jsonBody({ characterId, characterName }) };

  return (await authorizedRequest<Member>(base, `${path(campaignId)}/members/me/character`, init))
    .data;
}

/** Só o mestre: escolhe, entre os modelos dele, o que os jogadores usam (na versão atual). */
export async function assignTemplate(campaignId: string, templateId: string): Promise<Campaign> {
  const init = { method: "PUT", ...jsonBody({ templateId }) };

  return (await authorizedRequest<Campaign>(base, `${path(campaignId)}/template`, init)).data;
}

/** Sair (o próprio userId) ou, para o dono, remover um jogador. */
export async function removeMember(campaignId: string, userId: string): Promise<void> {
  const url = `${path(campaignId)}/members/${encodeURIComponent(userId)}`;

  await authorizedRequest<null>(base, url, { method: "DELETE" });
}
