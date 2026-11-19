import { describe, expect, it } from "vitest";
import { createOutboxRelay } from "../../src/messaging/outbox-relay.js";
import type { OutboxMessage } from "../../src/messaging/outgoing.js";

const NOW = new Date("2026-11-19T12:00:00.000Z");

const message = (messageId: string): OutboxMessage => ({
  messageId,
  type: "rpg.campaign.created.v1",
  routingKey: "campaign.created.v1",
  body: "{}",
  headers: {},
  createdAt: NOW.toISOString(),
});

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

function testRelay({
  pending = [message("m1"), message("m2"), message("m3")],
  connected = true,
  failOn = "",
} = {}) {
  const published: string[] = [];
  const marked: string[] = [];
  const claims: number[] = [];

  const relay = createOutboxRelay({
    outbox: {
      async claim(limit) {
        claims.push(limit);

        return pending.slice(0, limit);
      },
      async markPublished(messageId) {
        marked.push(messageId);
      },
    },
    publish: async (m) => {
      if (m.messageId === failOn) {
        throw new Error("canal fechado");
      }

      published.push(m.messageId);
    },
    isConnected: () => connected,
    batchSize: 25,
    leaseMs: 30_000,
    intervalMs: 500,
    log: silentLog,
    now: () => NOW,
  });

  return { relay, published, marked, claims };
}

describe("relay da outbox", () => {
  it("publica os pendentes em ordem e marca cada um depois de publicado", async () => {
    const { relay, published, marked } = testRelay();

    expect(await relay.runOnce()).toBe(3);
    expect(published).toEqual(["m1", "m2", "m3"]);
    expect(marked).toEqual(["m1", "m2", "m3"]);
  });

  it("sem conexão com o RabbitMQ não reserva nada: os eventos esperam na outbox", async () => {
    const { relay, claims, published } = testRelay({ connected: false });

    expect(await relay.runOnce()).toBe(0);
    expect(claims).toEqual([]);
    expect(published).toEqual([]);
  });

  it("falha ao publicar: para o lote e não marca o que não saiu", async () => {
    const { relay, published, marked } = testRelay({ failOn: "m2" });

    expect(await relay.runOnce()).toBe(1);
    expect(published).toEqual(["m1"]);
    expect(marked).toEqual(["m1"]);
  });
});
