export interface ExternalValidationRequest {
  messageId: string;
  correlationId: string;
  occurredAt: string;
  operationId: string;
  campaignId: string;
  characterId: string;
  itemId: string;
  quantity: number;
  deadlineAt?: string;
}

export type ExternalValidationFailureReason = "SIMULATED_FAILURE" | "DEADLINE_EXPIRED";

export interface ExternalValidationResponse {
  messageId: string;
  correlationId: string;
  type: "rpg.external.validation-succeeded.v1" | "rpg.external.validation-failed.v1";
  version: 1;
  occurredAt: string;
  payload: {
    operationId: string;
    campaignId: string;
    characterId: string;
    itemId: string;
    quantity: number;
    reason?: ExternalValidationFailureReason;
    detail?: string;
  };
}

export interface PendingValidationResponse {
  messageId: string;
  routingKey: "external.validation.succeeded.v1" | "external.validation.failed.v1";
  envelope: ExternalValidationResponse;
}
