import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { createAcquisitionRepository } from "../../src/repositories/acquisition-repository.js";
import { createCampaignRepository } from "../../src/repositories/campaign-repository.js";
import { createMemberRepository, type MemberRepository } from "../../src/repositories/member-repository.js";
import { createTestDb } from "../db/test-db.js";

const NOW = "2026-11-16T12:00:00.000Z";
let members: MemberRepository;
let addItems: (campaignId: string, quantity: number) => Promise<unknown>;
let newCampaign: () => Promise<string>;

beforeAll(async () => {
  const db = await createTestDb();
  const campaigns = createCampaignRepository(db);
  const acquisitions = createAcquisitionRepository(db, 7);

  members = createMemberRepository(db);

  newCampaign = async () => {
    const campaignId = `c-${randomUUID().slice(0, 8)}`;

    await campaigns.create({ campaignId, name: "A Coroa de Cinzas", gameMaster: null, createdAt: NOW });

    return campaignId;
  };

  addItems = (campaignId, quantity) =>
    acquisitions.record(
      {
        messageId: randomUUID(),
        occurredAt: NOW,
        operationId: randomUUID(),
        campaignId,
        characterId: "ch1",
        itemId: "espada",
        quantity,
      },
      NOW,
    );
});

it("primeira vez cria; segunda troca o nome e mantém o contador e a data de entrada", async () => {
  const campaignId = await newCampaign();

  const first = await members.save(campaignId, { characterId: "ch1", characterName: "Lyra" }, NOW);
  await addItems(campaignId, 3);
  const second = await members.save(
    campaignId,
    { characterId: "ch1", characterName: "Lyra, a Ladina" },
    "2026-11-17T00:00:00.000Z",
  );

  expect(first).toEqual({
    created: true,
    member: { characterId: "ch1", characterName: "Lyra", itemsAcquired: 0, joinedAt: NOW },
  });
  expect(second).toEqual({
    created: false,
    member: { characterId: "ch1", characterName: "Lyra, a Ladina", itemsAcquired: 3, joinedAt: NOW },
  });
});

it("lista só os participantes da campanha", async () => {
  const campaignId = await newCampaign();
  const other = await newCampaign();

  await members.save(campaignId, { characterId: "ch1", characterName: "Lyra" }, NOW);
  await members.save(other, { characterId: "ch2", characterName: "Borin" }, NOW);

  expect((await members.list(campaignId)).map((m) => m.characterId)).toEqual(["ch1"]);
});
