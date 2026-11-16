import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { buildApp } from "../../src/http/app.js";
import { createCampaignService } from "../../src/services/campaigns.js";
import { fakeRepository } from "../fake-repository.js";

const NOW = "2026-11-16T12:00:00.000Z";

function testApp() {
  return buildApp({
    env: loadEnv({}),
    campaigns: createCampaignService(fakeRepository(), () => NOW),
    pingDatabase: async () => {},
    isBusConnected: () => true,
    logger: false,
  });
}

const createCampaign = (app: ReturnType<typeof testApp>, payload: object) =>
  app.inject({ method: "POST", url: "/campaigns", payload });

describe("POST /campaigns", () => {
  it("sem código, gera um UUID e devolve 201", async () => {
    const res = await createCampaign(testApp(), { name: "A Coroa de Cinzas" });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      campaignId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "A Coroa de Cinzas",
      gameMaster: null,
      createdAt: NOW,
    });
  });

  it("com o código c1 duas vezes: 201 e depois 409 CAMPAIGN_ALREADY_EXISTS", async () => {
    const app = testApp();

    const first = await createCampaign(app, { name: "Um", gameMaster: "Ana", campaignId: "c1" });
    const second = await createCampaign(app, { name: "Dois", campaignId: "c1" });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ campaignId: "c1", gameMaster: "Ana" });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: { code: "CAMPAIGN_ALREADY_EXISTS", message: "campanha já existe", details: { campaignId: "c1" } },
    });
  });

  it("sem name → 422 VALIDATION_ERROR apontando o campo", async () => {
    const res = await createCampaign(testApp(), {});

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", details: [{ field: "name" }] } });
  });

  it("com o código 'c 1' (fora do padrão) → 422", async () => {
    const res = await createCampaign(testApp(), { name: "X", campaignId: "c 1" });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { details: [{ field: "campaignId" }] } });
  });
});

describe("GET /campaigns", () => {
  it("lista as campanhas em items", async () => {
    const app = testApp();

    await createCampaign(app, { name: "Um", campaignId: "c1" });

    const res = await app.inject({ method: "GET", url: "/campaigns" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ campaignId: "c1", name: "Um", gameMaster: null, createdAt: NOW }] });
  });
});

describe("GET /campaigns/:campaignId", () => {
  it("devolve a campanha com participantes e atividade", async () => {
    const app = testApp();

    await createCampaign(app, { name: "Um", campaignId: "c1" });

    const res = await app.inject({ method: "GET", url: "/campaigns/c1" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ campaignId: "c1", members: [], recentActivity: [] });
  });

  it("inexistente → 404 CAMPAIGN_NOT_FOUND", async () => {
    const res = await testApp().inject({ method: "GET", url: "/campaigns/nao-existe" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "CAMPAIGN_NOT_FOUND", message: "campanha não encontrada" } });
  });

  it("código fora do padrão → 422", async () => {
    const res = await testApp().inject({ method: "GET", url: "/campaigns/c%201" });

    expect(res.statusCode).toBe(422);
  });
});

describe("POST /campaigns/:campaignId/members", () => {
  const addMember = (app: ReturnType<typeof testApp>, campaignId: string, characterName = "Lyra") =>
    app.inject({ method: "POST", url: `/campaigns/${campaignId}/members`, payload: { characterId: "ch1", characterName } });

  it("novo → 201; repetido → 200 com o nome novo", async () => {
    const app = testApp();

    await createCampaign(app, { name: "Um", campaignId: "c1" });

    const first = await addMember(app, "c1");
    const second = await addMember(app, "c1", "Lyra, a Ladina");

    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ characterId: "ch1", characterName: "Lyra", itemsAcquired: 0, joinedAt: NOW });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ characterName: "Lyra, a Ladina" });
  });

  it("campanha inexistente → 404 CAMPAIGN_NOT_FOUND", async () => {
    const res = await addMember(testApp(), "nao-existe");

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "CAMPAIGN_NOT_FOUND" } });
  });
});
