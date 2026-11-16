// Decide o que fazer com cada mensagem recebida. Não conhece o RabbitMQ: só devolve a decisão.
import type { Acquisition, AcquisitionResult } from "../domain/acquisition.js";
import type { CampaignService } from "../services/campaigns.js";
import { PoisonMessage } from "./events.js";
import { decideRetry, readRetryCount, type RetryPolicy } from "./retry.js";

export type Outcome =
  | { kind: "ack"; campaignId: string; result: AcquisitionResult }
  | { kind: "retry"; attempt: number; delayMs: number; reason: string }
  | { kind: "dead-letter"; reason: string };

export interface DeliveryDeps {
  parse: (body: Buffer) => Acquisition;
  campaigns: Pick<CampaignService, "recordAcquisition">;
  policy: RetryPolicy;
}

export async function handleDelivery(
  { parse, campaigns, policy }: DeliveryDeps,
  body: Buffer,
  headers: Record<string, unknown> | undefined,
): Promise<Outcome> {
  let acquisition: Acquisition;

  try {
    acquisition = parse(body);
  } catch (error) {
    if (error instanceof PoisonMessage) {
      // Inválida continua inválida: tentar de novo não adianta.
      return { kind: "dead-letter", reason: error.message };
    }

    throw error;
  }

  try {
    // applied, duplicate ou unknown-campaign: em todos os casos a mensagem está resolvida.
    const result = await campaigns.recordAcquisition(acquisition);

    return { kind: "ack", campaignId: acquisition.campaignId, result };
  } catch (error) {
    // Falha de infraestrutura (DynamoDB fora, limite de vazão): pode dar certo mais tarde.
    const reason = error instanceof Error ? error.message || error.name : String(error);
    const decision = decideRetry(policy, readRetryCount(headers));

    return decision.action === "retry"
      ? { kind: "retry", attempt: decision.attempt, delayMs: decision.delayMs, reason }
      : { kind: "dead-letter", reason };
  }
}
