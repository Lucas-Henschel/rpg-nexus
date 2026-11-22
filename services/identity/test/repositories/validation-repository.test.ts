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

    expect(pending).toEqual([{ messageId: "m2", routingKey: "external.validation.succeeded.v1", envelope: { messageId: "m2" } }]);
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
});
