import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { createAcquisitionRepository } from "../../src/repositories/acquisition-repository.js";
import { type ActivityRepository, createActivityRepository } from "../../src/repositories/activity-repository.js";
import { createCampaignRepository } from "../../src/repositories/campaign-repository.js";
import { createTestDb } from "../db/test-db.js";

const NOW = "2026-11-16T12:00:00.000Z";
let activity: ActivityRepository;
let campaignId: string;

beforeAll(async () => {
  const db = await createTestDb();
  const acquisitions = createAcquisitionRepository(db, 7);

  activity = createActivityRepository(db);
  campaignId = `c-${randomUUID().slice(0, 8)}`;

  await createCampaignRepository(db).create({ campaignId, name: "Um", gameMaster: null, createdAt: NOW });

  // 21 aquisições, uma por minuto, de 12:10 a 12:30.
  for (let minute = 10; minute < 31; minute++) {
    await acquisitions.record(
      {
        messageId: randomUUID(),
        occurredAt: `2026-11-16T12:${minute}:00.000Z`,
        operationId: randomUUID(),
        campaignId,
        characterId: "ch1",
        itemId: "espada",
        quantity: 1,
      },
      NOW,
    );
  }
});

it("recentes: mais nova primeiro, no máximo 20", async () => {
  const recent = await activity.listRecent(campaignId);

  expect(recent).toHaveLength(20);
  expect(recent[0]?.occurredAt).toBe("2026-11-16T12:30:00.000Z");
  expect(recent[19]?.occurredAt).toBe("2026-11-16T12:11:00.000Z");
});

it("campanha sem atividade → lista vazia", async () => {
  expect(await activity.listRecent("sem-atividade")).toEqual([]);
});
