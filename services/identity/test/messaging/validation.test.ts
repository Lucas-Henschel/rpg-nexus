import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createValidationRequestParser,
  createValidationResponse,
  handleValidationDelivery,
} from "../../src/messaging/validation.js";

const request = {
  messageId: "d9428888-122b-4f55-8f9d-bf2359e9b123",
  correlationId: "op-1",
  occurredAt: "2026-11-20T00:00:00.000Z",
  operationId: "op-1",
  campaignId: "camp-1",
  characterId: "char-1",
  itemId: "item-1",
  quantity: 1,
  deadlineAt: "2026-11-20T00:01:00.000Z",
};

describe("validação externa simulada", () => {
  it("valida o contrato da solicitação", () => {
    const parse = createValidationRequestParser(resolve("../../contracts"));
    const parsed = parse(Buffer.from(JSON.stringify({
      messageId: request.messageId,
      correlationId: request.correlationId,
      type: "rpg.external.validation-requested.v1",
      version: 1,
      occurredAt: request.occurredAt,
      payload: {
        operationId: request.operationId,
        campaignId: request.campaignId,
        characterId: request.characterId,
        itemId: request.itemId,
        quantity: request.quantity,
        deadlineAt: request.deadlineAt,
      },
    })));
    expect(parsed).toEqual(request);
  });

  it("aprova quando a taxa de falha não é atingida", () => {
    const response = createValidationResponse(request, new Date("2026-11-20T00:00:01.000Z"), 0.25, () => 0.9);
    expect(response.type).toBe("rpg.external.validation-succeeded.v1");
  });

  it("recusa de modo configurável", () => {
    const response = createValidationResponse(request, new Date("2026-11-20T00:00:01.000Z"), 0.25, () => 0.1);
    expect(response).toMatchObject({
      type: "rpg.external.validation-failed.v1",
      payload: { reason: "SIMULATED_FAILURE" },
    });
  });

  it("recusa uma solicitação que ultrapassou o prazo", () => {
    const response = createValidationResponse(request, new Date("2026-11-20T00:02:00.000Z"), 0, () => 0.9);
    expect(response).toMatchObject({
      type: "rpg.external.validation-failed.v1",
      payload: { reason: "DEADLINE_EXPIRED" },
    });
  });

  it("persiste inbox e outbox depois do atraso configurado", async () => {
    const record = vi.fn().mockResolvedValue("applied");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const outcome = await handleValidationDelivery({
      parse: () => request,
      repository: { record },
      policy: { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 },
      failureRate: 0,
      minDelayMs: 100,
      maxDelayMs: 500,
      random: () => 0.5,
      now: () => new Date("2026-11-20T00:00:01.000Z"),
      sleep,
    }, Buffer.from("{}"), undefined);
    expect(sleep).toHaveBeenCalledWith(300);
    expect(record).toHaveBeenCalledOnce();
    expect(outcome.kind).toBe("ack");
  });
});
