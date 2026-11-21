import { CampaignHistoryForbidden } from "../domain/errors.js";
import type { HistoryEvent } from "../domain/history.js";
import type { HistoryRepository } from "../repositories/history-repository.js";

export function createHistoryService(repository: HistoryRepository) {
  return {
    record(event: HistoryEvent) {
      return repository.record(event, new Date().toISOString());
    },
    async list(campaignId: string, userId: string, limit: number) {
      if (!(await repository.isMember(campaignId, userId))) throw new CampaignHistoryForbidden();
      return repository.list(campaignId, limit);
    },
  };
}

export type HistoryService = ReturnType<typeof createHistoryService>;
