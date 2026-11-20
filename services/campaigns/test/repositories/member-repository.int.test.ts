import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { createCampaignRepository } from "../../src/repositories/campaign-repository.js";
import {
  createMemberRepository,
  type MemberRepository,
} from "../../src/repositories/member-repository.js";
import {
  memberCharacterChosen,
  memberJoined,
  memberRemoved,
} from "../../src/messaging/outgoing.js";
import { campaign, member, NOW, ownerOf } from "../db/fixtures.js";
import { createTestDb } from "../db/test-db.js";

let members: MemberRepository;
let newCampaign: () => Promise<string>;

beforeAll(async () => {
  const db = await createTestDb();
  const campaigns = createCampaignRepository(db);

  members = createMemberRepository(db);
  newCampaign = async () => {
    const created = campaign();

    await campaigns.create(created, ownerOf(created), []);

    return created.campaignId;
  };
});

const beto = member({ userId: "u-beto", username: "beto" });
const left = (campaignId: string) =>
  memberRemoved(campaignId, {
    userId: "u-beto",
    removedBy: "u-beto",
    reason: "LEFT",
    removedAt: NOW,
  });

it("add: primeira vez cria; segunda devolve o que estava gravado", async () => {
  const campaignId = await newCampaign();

  const first = await members.add(campaignId, beto, memberJoined(campaignId, beto));
  const second = await members.add(
    campaignId,
    { ...beto, joinedAt: "2026-11-17T00:00:00.000Z" },
    memberJoined(campaignId, beto),
  );

  expect(first).toEqual({ member: beto, created: true });
  expect(second).toEqual({ member: beto, created: false });
});

it("add não rebaixa o dono", async () => {
  const campaignId = await newCampaign();

  const { created, member: kept } = await members.add(
    campaignId,
    member({ userId: "u-ana" }),
    memberJoined(campaignId, beto),
  );

  expect(created).toBe(false);
  expect(kept.role).toBe("OWNER");
});

it("find e remove", async () => {
  const campaignId = await newCampaign();

  await members.add(campaignId, beto, memberJoined(campaignId, beto));
  expect(await members.find(campaignId, "u-beto")).toEqual(beto);

  expect(await members.remove(campaignId, "u-beto", left(campaignId))).toBe(true);
  expect(await members.find(campaignId, "u-beto")).toBeNull();
  expect(await members.remove(campaignId, "u-beto", left(campaignId))).toBe(false);
});

it("campaignIdsOf: as campanhas em que o usuário participa", async () => {
  const one = await newCampaign();
  const two = await newCampaign();
  await newCampaign();

  // Usuário só deste teste: os outros também põem o beto em campanhas da mesma tabela.
  const caio = member({ userId: `u-caio-${randomUUID().slice(0, 8)}`, username: "caio" });

  await members.add(one, caio, memberJoined(one, caio));
  await members.add(two, caio, memberJoined(two, caio));

  expect((await members.campaignIdsOf(caio.userId)).sort()).toEqual([one, two].sort());
});

const lyra = { characterId: "ch1", characterName: "Lyra" };
const chosen = (campaignId: string) => memberCharacterChosen(campaignId, { ...beto, ...lyra }, NOW);

it("setCharacter grava o personagem e mantém o resto", async () => {
  const campaignId = await newCampaign();

  await members.add(campaignId, beto, memberJoined(campaignId, beto));

  expect(await members.setCharacter(campaignId, "u-beto", lyra, chosen(campaignId))).toBe(true);
  expect(await members.find(campaignId, "u-beto")).toEqual({ ...beto, ...lyra });
});

it("setCharacter de quem não participa devolve false, sem criar o participante", async () => {
  const campaignId = await newCampaign();

  expect(await members.setCharacter(campaignId, "u-zeca", lyra, chosen(campaignId))).toBe(false);
  expect(await members.find(campaignId, "u-zeca")).toBeNull();
});
