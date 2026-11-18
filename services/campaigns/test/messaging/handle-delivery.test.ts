import { describe, expect, it, vi } from "vitest";
import type { Acquisition, AcquisitionResult } from "../../src/domain/acquisition.js";
import { PoisonMessage } from "../../src/messaging/events.js";
import { handleDelivery } from "../../src/messaging/handle-delivery.js";

const ACQUISITION: Acquisition = {
  messageId: "m1",
  occurredAt: "2026-11-16T12:00:00Z",
  operationId: "op1",
  campaignId: "c1",
  characterId: "ch1",
  itemId: "sword",
  quantity: 1,
};

const policy = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 15000 };
const body = Buffer.from("{}");

function deps(recordAcquisition: (a: Acquisition) => Promise<AcquisitionResult>) {
  return {
    parse: () => ACQUISITION,
    campaigns: { recordAcquisition: vi.fn(recordAcquisition) },
    policy,
  };
}

describe("handleDelivery", () => {
  it("applied → ack", async () => {
    expect(
      await handleDelivery(
        deps(async () => "applied"),
        body,
        undefined,
      ),
    ).toEqual({
      kind: "ack",
      campaignId: "c1",
      result: "applied",
    });
  });

  it("duplicate e unknown-campaign → ack, sem retry", async () => {
    expect(
      await handleDelivery(
        deps(async () => "duplicate"),
        body,
        undefined,
      ),
    ).toEqual({
      kind: "ack",
      campaignId: "c1",
      result: "duplicate",
    });
    expect(
      await handleDelivery(
        deps(async () => "unknown-campaign"),
        body,
        undefined,
      ),
    ).toEqual({
      kind: "ack",
      campaignId: "c1",
      result: "unknown-campaign",
    });
  });

  it("falha ao gravar → retry com attempt 1 e 1000 ms; com x-retry-count 3 → dead-letter", async () => {
    const failing = deps(async () => {
      throw new Error("DynamoDB fora");
    });

    expect(await handleDelivery(failing, body, undefined)).toEqual({
      kind: "retry",
      attempt: 1,
      delayMs: 1000,
      reason: "DynamoDB fora",
    });
    expect(await handleDelivery(failing, body, { "x-retry-count": 3 })).toEqual({
      kind: "dead-letter",
      reason: "DynamoDB fora",
    });
  });

  it("erro sem mensagem (como conexão recusada) usa o nome do erro como motivo", async () => {
    const failing = deps(async () => {
      throw new AggregateError([]);
    });

    expect(await handleDelivery(failing, body, undefined)).toMatchObject({
      kind: "retry",
      reason: "AggregateError",
    });
  });

  it("mensagem inválida → dead-letter sem gravar nada", async () => {
    const invalid = {
      ...deps(async () => "applied"),
      parse: () => {
        throw new PoisonMessage("payload/characterId é obrigatório");
      },
    };

    expect(await handleDelivery(invalid, body, undefined)).toEqual({
      kind: "dead-letter",
      reason: "payload/characterId é obrigatório",
    });
    expect(invalid.campaigns.recordAcquisition).not.toHaveBeenCalled();
  });
});
