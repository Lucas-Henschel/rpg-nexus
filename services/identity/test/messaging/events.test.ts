import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createHistoryEventParser, PoisonMessage } from "../../src/messaging/events.js";

const parse = createHistoryEventParser(resolve("../../contracts"));
const base = {
  messageId: "d9428888-122b-4f55-8f9d-bf2359e9b123",
  correlationId: "op-1",
  version: 1,
  occurredAt: "2026-11-18T20:00:00.000Z",
};

describe("eventos do histórico", () => {
  it("converte ItemAcquired para uma entrada entregue", () => {
    const event = parse(Buffer.from(JSON.stringify({
      ...base,
      type: "rpg.item.acquired.v1",
      payload: { operationId: "op-1", campaignId: "c1", characterId: "p1", itemId: "espada", itemName: "Espada", quantity: 1 },
    })));
    expect(event).toMatchObject({ type: "ITEM_ACQUIRED", campaignId: "c1", itemName: "Espada" });
  });

  it("converte AcquisitionCancelled e preserva o motivo", () => {
    const event = parse(Buffer.from(JSON.stringify({
      ...base,
      type: "rpg.acquisition.cancelled.v1",
      payload: { operationId: "op-1", campaignId: "c1", userId: "u1", characterId: "p1", itemId: "espada", quantity: 1, reason: "PAYMENT_REJECTED" },
    })));
    expect(event).toMatchObject({ type: "ACQUISITION_CANCELLED", userId: "u1", reason: "PAYMENT_REJECTED" });
  });

  it("converte a criação da campanha", () => {
    const event = parse(Buffer.from(JSON.stringify({
      ...base,
      type: "rpg.campaign.created.v1",
      payload: { campaignId: "c1", name: "A Mina", ownerId: "u1", ownerName: "Mestre", createdAt: base.occurredAt },
    })));
    expect(event).toMatchObject({ type: "CAMPAIGN_CREATED", campaignName: "A Mina", userId: "u1" });
  });

  it("converte a entrada de participante", () => {
    const event = parse(Buffer.from(JSON.stringify({
      ...base,
      type: "rpg.campaign.member.joined.v1",
      payload: { campaignId: "c1", userId: "u2", username: "jogador", role: "PLAYER", joinedAt: base.occurredAt },
    })));
    expect(event).toMatchObject({ type: "MEMBER_JOINED", username: "jogador", role: "PLAYER" });
  });

  it("converte a remoção de participante", () => {
    const event = parse(Buffer.from(JSON.stringify({
      ...base,
      type: "rpg.campaign.member.removed.v1",
      payload: { campaignId: "c1", userId: "u2", removedBy: "u1", reason: "REMOVED", removedAt: base.occurredAt },
    })));
    expect(event).toMatchObject({ type: "MEMBER_REMOVED", userId: "u2", reason: "REMOVED" });
  });

  it("converte uma compra concluída", () => {
    const event = parse(Buffer.from(JSON.stringify({
      ...base,
      type: "rpg.shop.item-purchased.v1",
      payload: { operationId: "op-1", campaignId: "c1", userId: "u2", characterId: "p1", itemId: "espada", amount: 25, quantity: 1 },
    })));
    expect(event).toMatchObject({ type: "SHOP_ITEM_PURCHASED", userId: "u2", amount: 25 });
  });

  it("converte ShopItemPurchased v2 e mantém o preço no modelo de leitura", () => {
    const event = parse(Buffer.from(JSON.stringify({
      ...base,
      version: 2,
      type: "rpg.shop.item-purchased.v2",
      payload: { operationId: "op-2", campaignId: "c1", userId: "u2", characterId: "p1", itemId: "espada", unitPrice: 25, quantity: 1 },
    })));
    expect(event).toMatchObject({ type: "SHOP_ITEM_PURCHASED", amount: 25 });
  });

  it("manda evento desconhecido para a DLQ", () => {
    expect(() => parse(Buffer.from(JSON.stringify({ ...base, type: "rpg.unknown.v1", payload: {} })))).toThrow(PoisonMessage);
  });
});
