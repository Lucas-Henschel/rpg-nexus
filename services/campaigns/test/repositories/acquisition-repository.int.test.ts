import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import type { Acquisition } from "../../src/domain/acquisition.js";
import {
  type AcquisitionRepository,
  createAcquisitionRepository,
} from "../../src/repositories/acquisition-repository.js";
import { type ActivityRepository, createActivityRepository } from "../../src/repositories/activity-repository.js";
import { type CampaignRepository, createCampaignRepository } from "../../src/repositories/campaign-repository.js";
import { createMemberRepository, type MemberRepository } from "../../src/repositories/member-repository.js";
import { createTestDb } from "../db/test-db.js";

const NOW = "2026-11-16T12:00:00.000Z";
let acquisitions: AcquisitionRepository;
let campaigns: CampaignRepository;
let members: MemberRepository;
let activity: ActivityRepository;

beforeAll(async () => {
  const db = await createTestDb();

  acquisitions = createAcquisitionRepository(db, 7);
  campaigns = createCampaignRepository(db);
  members = createMemberRepository(db);
  activity = createActivityRepository(db);
});

const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

async function newCampaign(): Promise<string> {
  const campaignId = id("c");

  await campaigns.create({ campaignId, name: "A Coroa de Cinzas", gameMaster: null, createdAt: NOW });

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

it("soma a quantidade ao participante e registra a atividade", async () => {
  const campaignId = await newCampaign();
  const event = acquisition(campaignId);

  expect(await acquisitions.record(event, NOW)).toBe("applied");
  expect(await members.list(campaignId)).toEqual([
    { characterId: "ch1", characterName: null, itemsAcquired: 2, joinedAt: NOW },
  ]);
  expect(await activity.listRecent(campaignId)).toEqual([
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

  await acquisitions.record(event, NOW);

  expect(await acquisitions.record(event, NOW)).toBe("duplicate");
  expect((await members.list(campaignId))[0]?.itemsAcquired).toBe(2);
});

it("a mesma operação com outro messageId conta uma vez só", async () => {
  const campaignId = await newCampaign();
  const event = acquisition(campaignId);

  await acquisitions.record(event, NOW);

  expect(await acquisitions.record({ ...event, messageId: randomUUID() }, NOW)).toBe("duplicate");
  expect(await activity.listRecent(campaignId)).toHaveLength(1);
});

it("campanha desconhecida → unknown-campaign e nada gravado", async () => {
  const campaignId = id("nao-existe");

  expect(await acquisitions.record(acquisition(campaignId), NOW)).toBe("unknown-campaign");
  expect(await members.list(campaignId)).toEqual([]);
  expect(await activity.listRecent(campaignId)).toEqual([]);
});

it("sem itemName, a atividade guarda null", async () => {
  const campaignId = await newCampaign();

  await acquisitions.record(acquisition(campaignId, { itemName: undefined }), NOW);

  expect((await activity.listRecent(campaignId))[0]?.itemName).toBeNull();
});
