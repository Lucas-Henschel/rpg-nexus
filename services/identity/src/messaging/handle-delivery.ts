import type { HistoryEvent, HistoryRecordResult } from "../domain/history.js";
import type { HistoryService } from "../services/history.js";
import { PoisonMessage } from "./events.js";
import { decideRetry, readRetryCount, type RetryPolicy } from "./retry.js";

export type Outcome =
  | { kind: "ack"; campaignId: string; result: HistoryRecordResult }
  | { kind: "retry"; attempt: number; delayMs: number; reason: string }
  | { kind: "dead-letter"; reason: string };

export interface DeliveryDeps {
  parse: (body: Buffer) => HistoryEvent;
  history: Pick<HistoryService, "record">;
  policy: RetryPolicy;
}

export async function handleDelivery(
  deps: DeliveryDeps,
  body: Buffer,
  headers: Record<string, unknown> | undefined,
): Promise<Outcome> {
  let event: HistoryEvent;
  try {
    event = deps.parse(body);
  } catch (error) {
    if (error instanceof PoisonMessage) return { kind: "dead-letter", reason: error.message };
    throw error;
  }

  try {
    const result = await deps.history.record(event);
    return { kind: "ack", campaignId: event.campaignId, result };
  } catch (error) {
    const reason = error instanceof Error ? error.message || error.name : String(error);
    const decision = decideRetry(deps.policy, readRetryCount(headers));
    return decision.action === "retry"
      ? { kind: "retry", attempt: decision.attempt, delayMs: decision.delayMs, reason }
      : { kind: "dead-letter", reason };
  }
}
