import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/db/client.js";
import type { HistoryEvent } from "../../src/domain/history.js";
import { createHistoryRepository } from "../../src/repositories/history-repository.js";

const tables = {
  users: "users", identities: "identities", sessions: "sessions", loginAttempts: "attempts",
  history: "history", historyInbox: "inbox", historyMemberships: "memberships",
  validationInbox: "validation-inbox", validationOutbox: "validation-outbox",
};
const base: Omit<HistoryEvent, "type"> = {
  messageId: "m1", campaignId: "c1", occurredAt: "2026-11-20T00:00:00.000Z",
};

function repository(result: object = {}) {
  const send = vi.fn(async (_command: unknown): Promise<object> => result);
  const db = { doc: { send }, tables } as unknown as Db;
  return { send, repository: createHistoryRepository(db, 7) };
}

describe("projeção de participantes do histórico", () => {
  it("adiciona participante na mesma transação do evento", async () => {
    const { send, repository: history } = repository();
    await history.record({ ...base, type: "MEMBER_JOINED", userId: "u1", username: "morgana", role: "PLAYER" }, base.occurredAt);
    const command = send.mock.calls[0]![0] as unknown as { input: { TransactItems: unknown[] } };
    expect(command.input.TransactItems[2]).toMatchObject({
      Put: { TableName: "memberships", Item: { campaignId: "c1", userId: "u1", role: "PLAYER" } },
    });
  });

  it("remove participante na mesma transação do evento", async () => {
    const { send, repository: history } = repository();
    await history.record({ ...base, type: "MEMBER_REMOVED", userId: "u1", removedBy: "owner", reason: "REMOVED" }, base.occurredAt);
    const command = send.mock.calls[0]![0] as unknown as { input: { TransactItems: unknown[] } };
    expect(command.input.TransactItems[2]).toEqual({
      Delete: { TableName: "memberships", Key: { campaignId: "c1", userId: "u1" } },
    });
  });

  it("autoriza somente quando a projeção contém o usuário", async () => {
    const present = repository({ Item: { campaignId: "c1", userId: "u1" } }).repository;
    const absent = repository({}).repository;
    await expect(present.isMember("c1", "u1")).resolves.toBe(true);
    await expect(absent.isMember("c1", "u2")).resolves.toBe(false);
  });

  it("devolve cursor para consultar a próxima página", async () => {
    const key = { campaignId: "c1", historyKey: "2026-11-20T00:00:00.000Z#m1" };
    const { send, repository: history } = repository({
      Items: [{ ...base, type: "MEMBER_JOINED", recordedAt: base.occurredAt }],
      LastEvaluatedKey: key,
    });
    const first = await history.listPage("c1", 20);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();

    await history.listPage("c1", 20, first.nextCursor!);
    const command = send.mock.calls[1]![0] as unknown as { input: { ExclusiveStartKey: unknown } };
    expect(command.input.ExclusiveStartKey).toEqual(key);
  });
});
