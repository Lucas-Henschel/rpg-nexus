import type { Acquisition, AcquisitionResult } from "./acquisition.js";
import type { Campaign, CampaignView } from "./campaign.js";
import type { Member } from "./member.js";

/** O que as rotas e o consumidor precisam guardar e ler; a implementação fica em db/. */
export interface CampaignRepository {
  ping(): Promise<void>;
  createCampaign(
    input: { campaignId: string; name: string; gameMaster: string | null },
    now: string,
  ): Promise<Campaign>;
  listCampaigns(): Promise<Campaign[]>;
  getCampaign(campaignId: string): Promise<CampaignView | null>;
  addMember(
    campaignId: string,
    characterId: string,
    characterName: string,
    now: string,
  ): Promise<{ member: Member; created: boolean }>;
  recordAcquisition(acquisition: Acquisition, now: string): Promise<AcquisitionResult>;
}
