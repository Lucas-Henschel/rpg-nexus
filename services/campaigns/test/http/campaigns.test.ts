import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { buildApp } from "../../src/http/app.js";
import { CharactersUnavailable } from "../../src/domain/errors.js";
import { createCampaignService, type TemplateCatalog } from "../../src/services/campaigns.js";
import { fakeRepositories } from "../fake-repositories.js";
import { AUTH_ENV, accessToken } from "../tokens.js";

const NOW = "2026-11-16T12:00:00.000Z";
const ANA = { userId: "u-ana", username: "ana" };
const BETO = { userId: "u-beto", username: "beto" };

/** O S2 de mentira: t-aventureiro existe na versão 3; t-s2-fora simula o S2 sem responder. */
const templates: TemplateCatalog = {
  async find(templateId, version) {
    if (templateId === "t-s2-fora") {
      throw new CharactersUnavailable();
    }

    return templateId === "t-aventureiro"
      ? { templateId, version: version ?? 3, name: "Aventureiro de Ooo" }
      : null;
  },
};

function testApp() {
  let next = 482731;

  return buildApp({
    env: loadEnv(AUTH_ENV),
    campaigns: createCampaignService(fakeRepositories(), {
      clock: () => NOW,
      joinCode: () => String(next++),
      templates,
    }),
    pingDatabase: async () => {},
    isBusConnected: () => true,
    logger: false,
  });
}

type App = ReturnType<typeof testApp>;

const as = (user: { userId: string; username: string }) => ({
  authorization: `Bearer ${accessToken(user)}`,
});

async function createCampaign(app: App, user = ANA, name = "A Coroa de Cinzas") {
  const res = await app.inject({
    method: "POST",
    url: "/campaigns",
    headers: as(user),
    payload: { name },
  });

  return res.json() as { campaignId: string; joinCode: string };
}

describe("autenticação", () => {
  it.each([
    ["sem Authorization", {}],
    ["com token inválido", { authorization: "Bearer abc.def.ghi" }],
    ["com outro esquema", { authorization: `Basic ${accessToken(ANA)}` }],
  ])("%s → 401 UNAUTHENTICATED", async (_, headers) => {
    const res = await testApp().inject({ method: "GET", url: "/users/me/campaigns", headers });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("/health continua aberto", async () => {
    expect((await testApp().inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("POST /campaigns", () => {
  it("201 com dono, código de seis dígitos e UUID", async () => {
    const res = await testApp().inject({
      method: "POST",
      url: "/campaigns",
      headers: as(ANA),
      payload: { name: "A Coroa de Cinzas" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      campaignId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "A Coroa de Cinzas",
      ownerId: "u-ana",
      ownerName: "ana",
      joinCode: "482731",
      createdAt: NOW,
      template: null,
    });
  });

  it("sem name → 422 VALIDATION_ERROR apontando o campo", async () => {
    const res = await testApp().inject({
      method: "POST",
      url: "/campaigns",
      headers: as(ANA),
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", details: [{ field: "name" }] },
    });
  });
});

describe("GET /users/me/campaigns", () => {
  it("lista só as campanhas do usuário", async () => {
    const app = testApp();

    await createCampaign(app, ANA, "Um");
    await createCampaign(app, BETO, "Dois");

    const res = await app.inject({ method: "GET", url: "/users/me/campaigns", headers: as(ANA) });

    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((c: { name: string }) => c.name)).toEqual(["Um"]);
  });
});

describe("GET /campaigns/:campaignId", () => {
  it("participante vê a campanha com participantes e atividade", async () => {
    const app = testApp();
    const { campaignId } = await createCampaign(app);

    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}`,
      headers: as(ANA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      campaignId,
      members: [{ userId: "u-ana", role: "OWNER" }],
      recentActivity: [],
    });
  });

  it("quem não participa → 403 NOT_A_MEMBER", async () => {
    const app = testApp();
    const { campaignId } = await createCampaign(app);

    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}`,
      headers: as(BETO),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "NOT_A_MEMBER" } });
  });

  it("inexistente → 404 CAMPAIGN_NOT_FOUND", async () => {
    const res = await testApp().inject({
      method: "GET",
      url: "/campaigns/nao-existe",
      headers: as(ANA),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "CAMPAIGN_NOT_FOUND" } });
  });
});

describe("POST /campaigns/join", () => {
  const join = (app: App, joinCode: string, user = BETO) =>
    app.inject({
      method: "POST",
      url: "/campaigns/join",
      headers: as(user),
      payload: { joinCode },
    });

  it("primeira vez → 201; repetida → 200; a campanha vem na resposta", async () => {
    const app = testApp();
    const { campaignId, joinCode } = await createCampaign(app);

    const first = await join(app, joinCode);
    const second = await join(app, joinCode);

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ campaignId, joinCode });
    expect(second.statusCode).toBe(200);
  });

  it("código que não existe → 404 JOIN_CODE_NOT_FOUND", async () => {
    const res = await join(testApp(), "000000");

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "JOIN_CODE_NOT_FOUND" } });
  });

  it.each(["12345", "1234567", "12a456", " 123456"])("código %j → 422", async (joinCode) => {
    expect((await join(testApp(), joinCode)).statusCode).toBe(422);
  });
});

describe("GET /campaigns/:campaignId/members", () => {
  it("o dono primeiro, depois quem entrou", async () => {
    const app = testApp();
    const { campaignId, joinCode } = await createCampaign(app);

    await app.inject({
      method: "POST",
      url: "/campaigns/join",
      headers: as(BETO),
      payload: { joinCode },
    });

    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/members`,
      headers: as(BETO),
    });

    expect(res.statusCode).toBe(200);
    expect(
      res.json().items.map((m: { username: string; role: string }) => [m.username, m.role]),
    ).toEqual([
      ["ana", "OWNER"],
      ["beto", "PLAYER"],
    ]);
  });
});

describe("PUT /campaigns/:campaignId/members/me/character", () => {
  const choose = (app: App, campaignId: string, user = ANA) =>
    app.inject({
      method: "PUT",
      url: `/campaigns/${campaignId}/members/me/character`,
      headers: as(user),
      payload: { characterId: "ch1", characterName: "Lyra" },
    });

  it("200 com o participante atualizado", async () => {
    const app = testApp();
    const { campaignId } = await createCampaign(app);

    const res = await choose(app, campaignId);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      userId: "u-ana",
      characterId: "ch1",
      characterName: "Lyra",
    });
  });

  it("personagem de outro participante → 409 CHARACTER_IN_USE", async () => {
    const app = testApp();
    const { campaignId, joinCode } = await createCampaign(app);

    await app.inject({
      method: "POST",
      url: "/campaigns/join",
      headers: as(BETO),
      payload: { joinCode },
    });
    await choose(app, campaignId);

    const res = await choose(app, campaignId, BETO);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "CHARACTER_IN_USE" } });
  });
});

describe("DELETE /campaigns/:campaignId/members/:userId", () => {
  async function withPlayer() {
    const app = testApp();
    const { campaignId, joinCode } = await createCampaign(app);

    await app.inject({
      method: "POST",
      url: "/campaigns/join",
      headers: as(BETO),
      payload: { joinCode },
    });

    const remove = (userId: string, user: typeof ANA) =>
      app.inject({
        method: "DELETE",
        url: `/campaigns/${campaignId}/members/${userId}`,
        headers: as(user),
      });

    return { remove };
  }

  it("o jogador sai → 204", async () => {
    const { remove } = await withPlayer();

    expect((await remove("u-beto", BETO)).statusCode).toBe(204);
  });

  it("jogador removendo o dono → 403 NOT_CAMPAIGN_OWNER", async () => {
    const { remove } = await withPlayer();
    const res = await remove("u-ana", BETO);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "NOT_CAMPAIGN_OWNER" } });
  });

  it("o dono saindo → 409 OWNER_CANNOT_LEAVE", async () => {
    const { remove } = await withPlayer();
    const res = await remove("u-ana", ANA);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "OWNER_CANNOT_LEAVE" } });
  });

  it("removendo quem não participa → 404 MEMBER_NOT_FOUND", async () => {
    const { remove } = await withPlayer();

    expect((await remove("u-zeca", ANA)).json()).toMatchObject({
      error: { code: "MEMBER_NOT_FOUND" },
    });
  });
});

describe("PUT /campaigns/:campaignId/template", () => {
  async function withPlayer() {
    const app = testApp();
    const { campaignId, joinCode } = await createCampaign(app);

    await app.inject({
      method: "POST",
      url: "/campaigns/join",
      headers: as(BETO),
      payload: { joinCode },
    });

    const assign = (payload: object, user = ANA) =>
      app.inject({
        method: "PUT",
        url: `/campaigns/${campaignId}/template`,
        headers: as(user),
        payload,
      });

    return { assign };
  }

  it("200 com a campanha e o modelo na versão fixa", async () => {
    const { assign } = await withPlayer();
    const res = await assign({ templateId: "t-aventureiro" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      template: { templateId: "t-aventureiro", version: 3, name: "Aventureiro de Ooo" },
    });
  });

  it("jogador → 403 NOT_CAMPAIGN_OWNER", async () => {
    const { assign } = await withPlayer();
    const res = await assign({ templateId: "t-aventureiro" }, BETO);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "NOT_CAMPAIGN_OWNER" } });
  });

  it("modelo que não existe no S2 → 404 TEMPLATE_NOT_FOUND", async () => {
    const { assign } = await withPlayer();
    const res = await assign({ templateId: "t-nada", version: 2 });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: "TEMPLATE_NOT_FOUND", details: { templateId: "t-nada", version: 2 } },
    });
  });

  it("S2 fora → 503 CHARACTERS_UNAVAILABLE", async () => {
    const { assign } = await withPlayer();
    const res = await assign({ templateId: "t-s2-fora" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: "CHARACTERS_UNAVAILABLE" } });
  });

  it.each([[{}], [{ templateId: "t-aventureiro", version: 0 }], [{ templateId: "a b" }]])(
    "corpo inválido %j → 422",
    async (payload) => {
      const { assign } = await withPlayer();

      expect((await assign(payload)).statusCode).toBe(422);
    },
  );
});
