import { describe, expect, it, vi } from "vitest";
import { CampaignNotFound } from "../../src/domain/errors.js";
import { createCampaignService } from "../../src/services/campaigns.js";
import { fakeRepositories } from "../fake-repositories.js";

const NOW = "2026-11-16T12:00:00.000Z";

const testService = () => createCampaignService(fakeRepositories(), () => NOW);

describe("create", () => {
  it("sem código, gera um UUID; sem mestre, guarda null; usa a data do relógio", async () => {
    const campaign = await testService().create({ name: "A Coroa de Cinzas" });

    expect(campaign).toEqual({
      campaignId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "A Coroa de Cinzas",
      gameMaster: null,
      createdAt: NOW,
    });
  });

  it("com código, usa o código informado", async () => {
    const campaign = await testService().create({
      name: "Um",
      gameMaster: "Ana",
      campaignId: "c1",
    });

    expect(campaign).toMatchObject({ campaignId: "c1", gameMaster: "Ana" });
  });
});

describe("get", () => {
  it("monta a campanha com participantes e atividade recente", async () => {
    const service = testService();

    await service.create({ name: "Um", campaignId: "c1" });
    await service.addMember("c1", { characterId: "ch1", characterName: "Lyra" });

    expect(await service.get("c1")).toEqual({
      campaignId: "c1",
      name: "Um",
      gameMaster: null,
      createdAt: NOW,
      members: [{ characterId: "ch1", characterName: "Lyra", itemsAcquired: 0, joinedAt: NOW }],
      recentActivity: [],
    });
  });

  it("campanha inexistente lança CampaignNotFound com o código", async () => {
    const error = await testService()
      .get("nao-existe")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CampaignNotFound);
    expect(error).toMatchObject({ campaignId: "nao-existe" });
  });
});

describe("addMember", () => {
  it("usa a data do relógio como entrada do participante", async () => {
    const service = testService();

    await service.create({ name: "Um", campaignId: "c1" });

    expect(await service.addMember("c1", { characterId: "ch1", characterName: "Lyra" })).toEqual({
      created: true,
      member: { characterId: "ch1", characterName: "Lyra", itemsAcquired: 0, joinedAt: NOW },
    });
  });

  it("campanha inexistente lança CampaignNotFound e não grava o participante", async () => {
    const repositories = fakeRepositories();
    const save = vi.spyOn(repositories.members, "save");
    const service = createCampaignService(repositories, () => NOW);

    await expect(
      service.addMember("nao-existe", { characterId: "ch1", characterName: "Lyra" }),
    ).rejects.toBeInstanceOf(CampaignNotFound);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("recordAcquisition", () => {
  it("grava com a data do relógio e devolve o resultado do repositório", async () => {
    const repositories = fakeRepositories();
    const record = vi.spyOn(repositories.acquisitions, "record");
    const acquisition = {
      messageId: "m1",
      occurredAt: "2026-11-16T11:00:00Z",
      operationId: "op1",
      campaignId: "c1",
      characterId: "ch1",
      itemId: "sword",
      quantity: 1,
    };

    expect(
      await createCampaignService(repositories, () => NOW).recordAcquisition(acquisition),
    ).toBe("applied");
    expect(record).toHaveBeenCalledWith(acquisition, NOW);
  });
});
