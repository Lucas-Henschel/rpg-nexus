// Precisa de um DynamoDB (MiniStack) em AWS_ENDPOINT_URL, padrão http://localhost:4566.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { createDocumentClient, createDynamoClient } from "../../src/db/client.js";
import { createRepository } from "../../src/db/repository.js";
import { ensureTables } from "../../src/db/tables.js";
import type { Acquisition } from "../../src/domain/acquisition.js";
import { CampaignAlreadyExists, CampaignNotFound } from "../../src/domain/errors.js";
import type { CampaignRepository } from "../../src/domain/repository.js";
import { uniqueTables } from "./unique-tables.js";

const env = loadEnv({ AWS_ENDPOINT_URL: "http://localhost:4566", ...process.env });
const NOW = "2026-11-16T12:00:00.000Z";
let repository: CampaignRepository;

beforeAll(async () => {
  const tables = uniqueTables();

  await ensureTables(createDynamoClient(env), tables);
  repository = createRepository(createDocumentClient(env), tables, env.INBOX_TTL_DAYS);
});

const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

async function newCampaign(): Promise<string> {
  const campaignId = id("c");

  await repository.createCampaign({ campaignId, name: "A Coroa de Cinzas", gameMaster: null }, NOW);

  return campaignId;
}

function acquisition(campaignId: string, overrides: Partial<Acquisition> = {}): Acquisition {
  return {
    messageId: randomUUID(),
    occurredAt: "2026-11-16T12:05:00.000Z",
    operationId: id("op"),
    campaignId,
    characterId: "ch1",
    itemId: "espada",
    itemName: "Espada Rúnica",
    quantity: 2,
    ...overrides,
  };
}

describe("campanhas", () => {
  it("cria e lê a campanha com o código informado", async () => {
    const campaignId = await newCampaign();

    expect(await repository.getCampaign(campaignId)).toEqual({
      campaignId,
      name: "A Coroa de Cinzas",
      gameMaster: null,
      createdAt: NOW,
      members: [],
      recentActivity: [],
    });
  });

  it("criar com um código que já existe lança CampaignAlreadyExists", async () => {
    const campaignId = await newCampaign();

    await expect(
      repository.createCampaign({ campaignId, name: "Outra", gameMaster: "Ana" }, NOW),
    ).rejects.toBeInstanceOf(CampaignAlreadyExists);
  });

  it("campanha inexistente → null", async () => {
    expect(await repository.getCampaign(id("nao-existe"))).toBeNull();
  });

  it("lista as campanhas criadas", async () => {
    const campaignId = await newCampaign();
    const ids = (await repository.listCampaigns()).map((c) => c.campaignId);

    expect(ids).toContain(campaignId);
  });
});

describe("participantes", () => {
  it("primeira vez cria; segunda troca o nome e mantém o contador", async () => {
    const campaignId = await newCampaign();

    const first = await repository.addMember(campaignId, "ch1", "Lyra", NOW);
    await repository.recordAcquisition(acquisition(campaignId, { quantity: 3 }), NOW);
    const second = await repository.addMember(campaignId, "ch1", "Lyra, a Ladina", NOW);

    expect(first).toEqual({
      created: true,
      member: { characterId: "ch1", characterName: "Lyra", itemsAcquired: 0, joinedAt: NOW },
    });
    expect(second.created).toBe(false);
    expect(second.member).toMatchObject({ characterName: "Lyra, a Ladina", itemsAcquired: 3 });
  });

  it("campanha inexistente lança CampaignNotFound", async () => {
    await expect(repository.addMember(id("nao-existe"), "ch1", "Lyra", NOW)).rejects.toBeInstanceOf(
      CampaignNotFound,
    );
  });
});

describe("recordAcquisition", () => {
  it("soma a quantidade ao participante e registra a atividade", async () => {
    const campaignId = await newCampaign();
    const event = acquisition(campaignId);

    expect(await repository.recordAcquisition(event, NOW)).toBe("applied");

    const view = await repository.getCampaign(campaignId);

    expect(view?.members).toEqual([
      { characterId: "ch1", characterName: null, itemsAcquired: 2, joinedAt: NOW },
    ]);
    expect(view?.recentActivity).toEqual([
      {
        operationId: event.operationId,
        characterId: "ch1",
        itemId: "espada",
        itemName: "Espada Rúnica",
        quantity: 2,
        occurredAt: event.occurredAt,
      },
    ]);
  });

  it("a mesma mensagem duas vezes conta uma vez só", async () => {
    const campaignId = await newCampaign();
    const event = acquisition(campaignId);

    await repository.recordAcquisition(event, NOW);

    expect(await repository.recordAcquisition(event, NOW)).toBe("duplicate");
    expect((await repository.getCampaign(campaignId))?.members[0]?.itemsAcquired).toBe(2);
  });

  it("a mesma operação com outro messageId conta uma vez só", async () => {
    const campaignId = await newCampaign();
    const event = acquisition(campaignId);

    await repository.recordAcquisition(event, NOW);

    expect(await repository.recordAcquisition({ ...event, messageId: randomUUID() }, NOW)).toBe(
      "duplicate",
    );
    expect((await repository.getCampaign(campaignId))?.recentActivity).toHaveLength(1);
  });

  it("campanha desconhecida → unknown-campaign e nada gravado", async () => {
    const campaignId = id("nao-existe");

    expect(await repository.recordAcquisition(acquisition(campaignId), NOW)).toBe("unknown-campaign");
    expect(await repository.getCampaign(campaignId)).toBeNull();
  });

  it("sem itemName, a atividade guarda null", async () => {
    const campaignId = await newCampaign();

    await repository.recordAcquisition(acquisition(campaignId, { itemName: undefined }), NOW);

    expect((await repository.getCampaign(campaignId))?.recentActivity[0]?.itemName).toBeNull();
  });

  it("atividade recente: mais nova primeiro, no máximo 20", async () => {
    const campaignId = await newCampaign();

    for (let minute = 10; minute < 31; minute++) {
      await repository.recordAcquisition(
        acquisition(campaignId, { occurredAt: `2026-11-16T12:${minute}:00.000Z`, quantity: 1 }),
        NOW,
      );
    }

    const view = await repository.getCampaign(campaignId);

    expect(view?.recentActivity).toHaveLength(20);
    expect(view?.recentActivity[0]?.occurredAt).toBe("2026-11-16T12:30:00.000Z");
    expect(view?.members[0]?.itemsAcquired).toBe(21);
  });
});
