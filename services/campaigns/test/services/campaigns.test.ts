import { describe, expect, it, vi } from "vitest";
import { CampaignNotFound } from "../../src/domain/errors.js";
import { createCampaignService } from "../../src/services/campaigns.js";
import { fakeRepository } from "../fake-repository.js";

const NOW = "2026-11-16T12:00:00.000Z";

const testService = () => createCampaignService(fakeRepository(), () => NOW);

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
    const campaign = await testService().create({ name: "Um", gameMaster: "Ana", campaignId: "c1" });

    expect(campaign).toMatchObject({ campaignId: "c1", gameMaster: "Ana" });
  });
});

describe("get", () => {
  it("campanha inexistente lança CampaignNotFound com o código", async () => {
    const error = await testService().get("nao-existe").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CampaignNotFound);
    expect(error).toMatchObject({ campaignId: "nao-existe" });
  });
});

describe("recordAcquisition", () => {
  it("grava com a data do relógio e devolve o resultado do repositório", async () => {
    const repository = fakeRepository();
    const record = vi.spyOn(repository, "recordAcquisition");
    const acquisition = {
      messageId: "m1",
      occurredAt: "2026-11-16T11:00:00Z",
      operationId: "op1",
      campaignId: "c1",
      characterId: "ch1",
      itemId: "sword",
      quantity: 1,
    };

    expect(await createCampaignService(repository, () => NOW).recordAcquisition(acquisition)).toBe("applied");
    expect(record).toHaveBeenCalledWith(acquisition, NOW);
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
});
