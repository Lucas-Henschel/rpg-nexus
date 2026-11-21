import { services } from "../../shared/config";
import { authorizedRequest } from "../auth/session";

export type HistoryEventType =
  | "CAMPAIGN_CREATED"
  | "MEMBER_JOINED"
  | "MEMBER_REMOVED"
  | "SHOP_ITEM_PURCHASED"
  | "ITEM_ACQUIRED"
  | "ACQUISITION_CANCELLED";

export type HistoryReason =
  | "CHARACTER_REJECTED"
  | "EXTERNAL_VALIDATION_FAILED"
  | "DEADLINE_EXPIRED"
  | "PAYMENT_REJECTED"
  | "LEFT"
  | "REMOVED";

export interface HistoryEntry {
  type: HistoryEventType;
  campaignId: string;
  occurredAt: string;
  recordedAt: string;
  operationId?: string;
  userId?: string;
  username?: string;
  role?: "OWNER" | "PLAYER";
  campaignName?: string;
  ownerName?: string;
  removedBy?: string;
  characterId?: string;
  itemId?: string;
  itemName?: string;
  quantity?: number;
  amount?: number;
  reason?: HistoryReason;
  detail?: string;
}

export async function listHistory(campaignId: string): Promise<HistoryEntry[]> {
  const path = `/campaigns/${encodeURIComponent(campaignId)}/history?limit=100`;
  return (await authorizedRequest<{ items: HistoryEntry[] }>(services.actions.url, path)).data.items;
}
