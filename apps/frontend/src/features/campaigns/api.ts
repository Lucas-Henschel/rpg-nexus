/** Adaptador tipado do S1 Campanhas. As telas nunca chamam fetch direto. */
import { services } from "../../shared/config";
import { jsonBody, request } from "../../shared/http";

const base = services.campaigns.url;

export interface Campaign {
  campaignId: string;
  name: string;
  gameMaster: string | null;
  createdAt: string;
}

export interface Member {
  characterId: string;
  /** null quando o personagem entrou sozinho, ao conquistar um item, sem ter sido adicionado. */
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

/** A campanha com participantes e as últimas atividades, da mais nova para a mais antiga. */
export interface CampaignView extends Campaign {
  members: Member[];
  recentActivity: Activity[];
}

export interface CampaignInput {
  name: string;
  gameMaster?: string;
  /** Código escolhido (ex.: c1); sem ele, o serviço gera um. */
  campaignId?: string;
}

export async function listCampaigns(): Promise<Campaign[]> {
  return (await request<{ items: Campaign[] }>(base, "/campaigns")).data.items;
}

export async function getCampaign(id: string): Promise<CampaignView> {
  return (await request<CampaignView>(base, `/campaigns/${encodeURIComponent(id)}`)).data;
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  return (await request<Campaign>(base, "/campaigns", { method: "POST", ...jsonBody(input) })).data;
}

/** Adiciona o personagem ou, se ele já participa, só troca o nome. */
export async function addMember(
  campaignId: string,
  characterId: string,
  characterName: string,
): Promise<Member> {
  const init = { method: "POST", ...jsonBody({ characterId, characterName }) };

  return (await request<Member>(base, `/campaigns/${encodeURIComponent(campaignId)}/members`, init))
    .data;
}
