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
}

/** A campanha como a página de Campanhas mostra: com participantes e atividade recente. */
export interface CampaignView extends Campaign {
  members: Member[];
  recentActivity: Activity[];
}
