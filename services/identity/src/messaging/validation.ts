import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type {
  ExternalValidationRequest,
  ExternalValidationResponse,
} from "../domain/validation.js";
import type { ValidationRepository } from "../repositories/validation-repository.js";
import { PoisonMessage } from "./events.js";
import type { Outcome } from "./handle-delivery.js";
import { decideRetry, readRetryCount, type RetryPolicy } from "./retry.js";

interface Envelope {
  messageId: string;
  correlationId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

const addFormats = addFormatsModule.default;

export function createValidationRequestParser(contractsDir: string) {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  ajv.addKeyword("x-routing");
  ajv.addSchema(JSON.parse(readFileSync(resolve(contractsDir, "envelope.schema.json"), "utf8")));
  const validate = ajv.compile<Envelope>(JSON.parse(readFileSync(
    resolve(contractsDir, "events/external-validation-requested.v1.schema.json"),
    "utf8",
  )));

  return (body: Buffer): ExternalValidationRequest => {
    let value: unknown;
    try {
      value = JSON.parse(body.toString("utf8"));
    } catch {
      throw new PoisonMessage("o corpo da validação externa não é JSON");
    }
    if (!validate(value)) throw new PoisonMessage(ajv.errorsText(validate.errors));
    const envelope = value as Envelope;
    const payload = envelope.payload;
    if (envelope.correlationId !== payload.operationId) {
      throw new PoisonMessage("correlationId difere do operationId");
    }
    return {
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      occurredAt: envelope.occurredAt,
      operationId: payload.operationId as string,
      campaignId: payload.campaignId as string,
      characterId: payload.characterId as string,
      itemId: payload.itemId as string,
      quantity: payload.quantity as number,
      deadlineAt: payload.deadlineAt as string | undefined,
    };
  };
}

export function createValidationResponse(
  request: ExternalValidationRequest,
  now: Date,
  failureRate: number,
  random: () => number,
): ExternalValidationResponse {
  const common = {
    messageId: randomUUID(),
    correlationId: request.correlationId,
    version: 1 as const,
    occurredAt: now.toISOString(),
  };
  const payload = {
    operationId: request.operationId,
    campaignId: request.campaignId,
    characterId: request.characterId,
    itemId: request.itemId,
    quantity: request.quantity,
  };
  if (request.deadlineAt && Date.parse(request.deadlineAt) <= now.getTime()) {
    return {
      ...common,
      type: "rpg.external.validation-failed.v1",
      payload: { ...payload, reason: "DEADLINE_EXPIRED", detail: "O prazo da Saga expirou antes da validação externa." },
    };
  }
  if (random() < failureRate) {
    return {
      ...common,
      type: "rpg.external.validation-failed.v1",
      payload: { ...payload, reason: "SIMULATED_FAILURE", detail: "Falha configurável da dependência externa simulada." },
    };
  }
  return { ...common, type: "rpg.external.validation-succeeded.v1", payload };
}

export interface ValidationDeliveryDeps {
  parse: (body: Buffer) => ExternalValidationRequest;
  repository: Pick<ValidationRepository, "record">;
  policy: RetryPolicy;
  failureRate: number;
  minDelayMs: number;
  maxDelayMs: number;
  now?: () => Date;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function handleValidationDelivery(
  deps: ValidationDeliveryDeps,
  body: Buffer,
  headers: Record<string, unknown> | undefined,
): Promise<Outcome> {
  let request: ExternalValidationRequest;
  try {
    request = deps.parse(body);
  } catch (error) {
    if (error instanceof PoisonMessage) return { kind: "dead-letter", reason: error.message };
    throw error;
  }
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms)));
  const delay = deps.minDelayMs + Math.floor(random() * (deps.maxDelayMs - deps.minDelayMs + 1));
  await sleep(delay);
  const response = createValidationResponse(request, (deps.now ?? (() => new Date()))(), deps.failureRate, random);
  try {
    const result = await deps.repository.record(request, response);
    return { kind: "ack", campaignId: request.campaignId, result };
  } catch (error) {
    const reason = error instanceof Error ? error.message || error.name : String(error);
    const decision = decideRetry(deps.policy, readRetryCount(headers));
    return decision.action === "retry"
      ? { kind: "retry", attempt: decision.attempt, delayMs: decision.delayMs, reason }
      : { kind: "dead-letter", reason };
  }
}
