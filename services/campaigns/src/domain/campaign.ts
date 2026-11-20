import type { Activity } from "./activity.js";
import type { Member } from "./member.js";

export interface Campaign {
  /** Identificador interno (UUID), usado nas URLs e nos eventos. */
  campaignId: string;
  name: string;
  /** Quem criou a campanha; é o participante OWNER. */
  ownerId: string;
  ownerName: string;
  /** Código que os jogadores digitam para entrar: sempre seis algarismos. */
  joinCode: string;
  createdAt: string;
  /** O modelo de ficha (template do S2) que os jogadores usam; null até o dono escolher. */
  template: AssignedTemplate | null;
}

/** Um modelo do S2 numa versão fixa: editar o modelo depois não muda o que a campanha usa. */
export interface AssignedTemplate {
  templateId: string;
  version: number;
  /** Cópia do nome no momento da escolha, para mostrar sem perguntar ao S2. */
  name: string;
  assignedAt: string;
}

/** A campanha como a página de Campanhas mostra: com participantes e atividade recente. */
export interface CampaignView extends Campaign {
  members: Member[];
  recentActivity: Activity[];
}
