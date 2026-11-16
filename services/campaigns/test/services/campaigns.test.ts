import { describe, expect, it } from "vitest";
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
