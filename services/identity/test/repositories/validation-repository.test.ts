import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/db/client.js";
import { createValidationRepository } from "../../src/repositories/validation-repository.js";

const tables = {
  users: "users", identities: "identities", sessions: "sessions", loginAttempts: "attempts",
  history: "history", historyInbox: "inbox", historyMemberships: "memberships",
  validationInbox: "validation-inbox", validationOutbox: "validation-outbox",
};

const pendingItem = {
  messageId: "m2",
  routingKey: "external.validation.succeeded.v1",
  envelope: { messageId: "m2" },
  status: "PENDING",
};

describe("outbox do validador", () => {
  it("acha resposta pendente mesmo quando a primeira página do scan só tem respostas já publicadas", async () => {
    // No DynamoDB o Limit conta os itens lidos antes do filtro: uma página pode vir vazia e ainda haver mais.
    const pages = [
      { Items: [], LastEvaluatedKey: { messageId: "m1" } },
      { Items: [pendingItem] },
    ];
    const send = vi.fn(async (_command: unknown): Promise<object> => pages.shift() ?? { Items: [] });
    const repository = createValidationRepository({ doc: { send }, tables } as unknown as Db, 7);

    const pending = await repository.pending();

    expect(pending).toEqual([{ messageId: "m2", routingKey: "external.validation.succeeded.v1", envelope: { messageId: "m2" }, traceContext: {} }]);
    const second = send.mock.calls[1]![0] as unknown as { input: { ExclusiveStartKey?: object } };
    expect(second.input.ExclusiveStartKey).toEqual({ messageId: "m1" });
  });

  it("para de ler quando junta o limite de respostas pendentes", async () => {
    const send = vi.fn(async (): Promise<object> => ({
      Items: [pendingItem, { ...pendingItem, messageId: "m3" }],
      LastEvaluatedKey: { messageId: "m3" },
    }));
    const repository = createValidationRepository({ doc: { send }, tables } as unknown as Db, 7);

    const pending = await repository.pending(2);

    expect(pending).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("persiste o contexto W3C com a resposta na outbox", async () => {
    let transaction: unknown;
    const send = vi.fn(async (command: unknown): Promise<object> => { transaction = command; return {}; });
    const repository = createValidationRepository({ doc: { send }, tables } as unknown as Db, 7);
    const request = {
      messageId: "request-1", correlationId: "op-1", occurredAt: "2026-11-21T12:00:00.000Z",
      operationId: "op-1", campaignId: "camp-1", characterId: "char-1", itemId: "item-1", quantity: 1,
    };
    const response = {
      messageId: "response-1", correlationId: "op-1", version: 1 as const,
      type: "rpg.external.validation-succeeded.v1" as const, occurredAt: "2026-11-21T12:00:01.000Z",
      payload: { operationId: "op-1", campaignId: "camp-1", characterId: "char-1", itemId: "item-1", quantity: 1 },
    };
    const traceContext = { traceparent: "00-11111111111111111111111111111111-2222222222222222-01" };

    await repository.record(request, response, traceContext);
    const input = (transaction as { input: { TransactItems: Array<{ Put?: { Item: Record<string, unknown> } }> } }).input;
    expect(input.TransactItems[1]?.Put?.Item.traceContext).toEqual(traceContext);
  });
});
