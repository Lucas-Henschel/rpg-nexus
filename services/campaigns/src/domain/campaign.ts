import type { Activity } from "./activity.js";
import type { Member } from "./member.js";

export interface Campaign {
  campaignId: string;
  name: string;
  gameMaster: string | null;
  createdAt: string;
}

/** A campanha como a página de Campanhas mostra: com participantes e atividade recente. */
export interface CampaignView extends Campaign {
  members: Member[];
  recentActivity: Activity[];
}
