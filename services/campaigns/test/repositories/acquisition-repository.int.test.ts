import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import type { Acquisition } from "../../src/domain/acquisition.js";
import {
  type AcquisitionRepository,
  createAcquisitionRepository,
} from "../../src/repositories/acquisition-repository.js";
import {
  type ActivityRepository,
  createActivityRepository,
} from "../../src/repositories/activity-repository.js";
import {
  type CampaignRepository,
  createCampaignRepository,
} from "../../src/repositories/campaign-repository.js";
import {
  createMemberRepository,
  type MemberRepository,
} from "../../src/repositories/member-repository.js";
import { campaign, NOW, ownerOf } from "../db/fixtures.js";
import { createTestDb } from "../db/test-db.js";

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

/** Campanha cuja dona (u-ana) usa o personagem ch1. */
async function newCampaign(): Promise<string> {
  const created = campaign();

  await campaigns.create(created, ownerOf(created), []);
  await members.setCharacter(created.campaignId, "u-ana", {
    characterId: "ch1",
    characterName: "Lyra",
  });

  return created.campaignId;
}

const itemsOfAna = async (campaignId: string) =>
  (await members.find(campaignId, "u-ana"))?.itemsAcquired;

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

  expect(await acquisitions.record(event, NOW, "u-ana")).toBe("applied");
  expect(await itemsOfAna(campaignId)).toBe(2);
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

  await acquisitions.record(event, NOW, "u-ana");

  expect(await acquisitions.record(event, NOW, "u-ana")).toBe("duplicate");
  expect(await itemsOfAna(campaignId)).toBe(2);
});

it("a mesma operação com outro messageId conta uma vez só", async () => {
  const campaignId = await newCampaign();
  const event = acquisition(campaignId);

  await acquisitions.record(event, NOW, "u-ana");

  expect(await acquisitions.record({ ...event, messageId: randomUUID() }, NOW, "u-ana")).toBe(
    "duplicate",
  );
  expect(await activity.listRecent(campaignId)).toHaveLength(1);
});

it("campanha desconhecida → unknown-campaign e nada gravado", async () => {
  const campaignId = id("nao-existe");

  expect(await acquisitions.record(acquisition(campaignId), NOW, null)).toBe("unknown-campaign");
  expect(await members.list(campaignId)).toEqual([]);
  expect(await activity.listRecent(campaignId)).toEqual([]);
});

it("sem itemName, a atividade guarda null", async () => {
  const campaignId = await newCampaign();

  await acquisitions.record(acquisition(campaignId, { itemName: undefined }), NOW, null);

  expect((await activity.listRecent(campaignId))[0]?.itemName).toBeNull();
});

it("sem participante com o personagem: grava só a atividade", async () => {
  const campaignId = await newCampaign();

  expect(await acquisitions.record(acquisition(campaignId), NOW, null)).toBe("applied");
  expect(await itemsOfAna(campaignId)).toBe(0);
  expect(await activity.listRecent(campaignId)).toHaveLength(1);
});

it("o participante trocou de personagem no meio: erro, para a mensagem ser refeita", async () => {
  const campaignId = await newCampaign();

  await members.setCharacter(campaignId, "u-ana", { characterId: "ch2", characterName: "Borin" });

  await expect(acquisitions.record(acquisition(campaignId), NOW, "u-ana")).rejects.toThrow();
  expect(await activity.listRecent(campaignId)).toEqual([]);
});
