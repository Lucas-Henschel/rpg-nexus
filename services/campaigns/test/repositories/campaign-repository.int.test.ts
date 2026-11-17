import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { CampaignAlreadyExists } from "../../src/domain/errors.js";
import { type CampaignRepository, createCampaignRepository } from "../../src/repositories/campaign-repository.js";
import { createTestDb } from "../db/test-db.js";

const NOW = "2026-11-16T12:00:00.000Z";
let campaigns: CampaignRepository;

beforeAll(async () => {
  campaigns = createCampaignRepository(await createTestDb());
});

const newCampaign = () => ({
  campaignId: `c-${randomUUID().slice(0, 8)}`,
  name: "A Coroa de Cinzas",
  gameMaster: null,
  createdAt: NOW,
});

it("grava e encontra a campanha pelo código", async () => {
  const campaign = newCampaign();

  await campaigns.create(campaign);

  expect(await campaigns.find(campaign.campaignId)).toEqual(campaign);
});

it("gravar com um código que já existe lança CampaignAlreadyExists", async () => {
  const campaign = newCampaign();

  await campaigns.create(campaign);

  await expect(campaigns.create({ ...campaign, name: "Outra" })).rejects.toBeInstanceOf(CampaignAlreadyExists);
});

it("campanha inexistente → null", async () => {
  expect(await campaigns.find("nao-existe")).toBeNull();
});

it("lista as campanhas gravadas", async () => {
  const campaign = newCampaign();

  await campaigns.create(campaign);

  expect((await campaigns.list()).map((c) => c.campaignId)).toContain(campaign.campaignId);
});
