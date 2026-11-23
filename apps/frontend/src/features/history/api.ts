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
  const all: HistoryEntry[] = [];
  let cursor: string | null = null;
  do {
    const path = `/campaigns/${encodeURIComponent(campaignId)}/history/page?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page: { items: HistoryEntry[]; nextCursor: string | null } =
      (await authorizedRequest<{ items: HistoryEntry[]; nextCursor: string | null }>(services.actions.url, path)).data;
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  return all;
}
