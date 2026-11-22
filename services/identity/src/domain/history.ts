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

export interface HistoryEvent {
  messageId: string;
  occurredAt: string;
  type: HistoryEventType;
  campaignId: string;
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

export interface HistoryEntry extends Omit<HistoryEvent, "messageId"> {
  recordedAt: string;
}

export type HistoryRecordResult = "applied" | "duplicate";
