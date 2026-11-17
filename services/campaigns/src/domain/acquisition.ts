export interface Acquisition {
  messageId: string;
  occurredAt: string;
  operationId: string;
  campaignId: string;
  characterId: string;
  itemId: string;
  quantity: number;
  itemName?: string;
}

export type AcquisitionResult = "applied" | "duplicate" | "unknown-campaign";
