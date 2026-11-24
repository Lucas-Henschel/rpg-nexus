import { describe, expect, it, vi } from "vitest";
import { CampaignHistoryForbidden } from "../../src/domain/errors.js";
import { buildApp } from "../../src/http/app.js";
import type { HistoryService } from "../../src/services/history.js";
import { fakeIdentity } from "../fakes.js";

const registration = { username: "Morgana", email: "morgana@example.com", password: "senha-segura-123" };

async function authenticatedApp(history: HistoryService) {
  const { deps, identity } = fakeIdentity();
  const app = buildApp({ env: deps.env, identity, history, pingDatabase: async () => {}, logger: false });
  const registered = await app.inject({ method: "POST", url: "/auth/register", payload: registration });
  return { app, accessToken: registered.json().tokens.accessToken, userId: registered.json().user.userId };
}

describe("GET /campaigns/:campaignId/history", () => {
  it("expõe páginas sucessivas do histórico", async () => {
    const listPage = vi.fn(async () => ({ items: [{
      type: "MEMBER_JOINED" as const, campaignId: "c1", username: "Morgana",
      occurredAt: "2026-11-18T20:00:00.000Z", recordedAt: "2026-11-18T20:00:01.000Z",
    }], nextCursor: "cHJveGltYQ" }));
    const history = { record: vi.fn(), list: vi.fn(), listPage } as unknown as HistoryService;
    const { app, accessToken, userId } = await authenticatedApp(history);
    const response = await app.inject({
      method: "GET", url: "/campaigns/c1/history/page?limit=20&cursor=YW50ZXJpb3I",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().nextCursor).toBe("cHJveGltYQ");
    expect(listPage).toHaveBeenCalledWith("c1", userId, 20, "YW50ZXJpb3I");
  });

  it("lista a linha do tempo autenticada e respeita o limite", async () => {
    const list = vi.fn(async () => [{
      type: "ITEM_ACQUIRED" as const,
      operationId: "op-1", campaignId: "c1", characterId: "p1", itemId: "i1",
      itemName: "Poção", quantity: 2,
      occurredAt: "2026-11-18T20:00:00.000Z", recordedAt: "2026-11-18T20:00:01.000Z",
    }]);
    const history = { record: vi.fn(), list } as unknown as HistoryService;
    const { app, accessToken, userId } = await authenticatedApp(history);

    const response = await app.inject({
      method: "GET",
      url: "/campaigns/c1/history?limit=25",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ operationId: "op-1", itemName: "Poção" });
    expect(list).toHaveBeenCalledWith("c1", userId, 25);
  });

  it("exige access token", async () => {
    const history = { record: vi.fn(), list: vi.fn() } as unknown as HistoryService;
    const { app } = await authenticatedApp(history);
    const response = await app.inject({ method: "GET", url: "/campaigns/c1/history" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_ACCESS_TOKEN" } });
  });

  it("recusa usuário que não participa da campanha", async () => {
    const history = {
      record: vi.fn(),
      list: vi.fn(async () => { throw new CampaignHistoryForbidden(); }),
    } as unknown as HistoryService;
    const { app, accessToken } = await authenticatedApp(history);
    const response = await app.inject({
      method: "GET", url: "/campaigns/c1/history",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "NOT_CAMPAIGN_MEMBER" } });
  });

  it("rejeita campanha ou limite inválido", async () => {
    const history = { record: vi.fn(), list: vi.fn() } as unknown as HistoryService;
    const { app, accessToken } = await authenticatedApp(history);
    const response = await app.inject({
      method: "GET",
      url: "/campaigns/campanha%20invalida/history?limit=1000",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(422);
  });
});
