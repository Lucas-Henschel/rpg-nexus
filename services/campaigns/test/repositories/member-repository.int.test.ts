import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { createCampaignRepository } from "../../src/repositories/campaign-repository.js";
import {
  createMemberRepository,
  type MemberRepository,
} from "../../src/repositories/member-repository.js";
import { campaign, member, ownerOf } from "../db/fixtures.js";
import { createTestDb } from "../db/test-db.js";

let members: MemberRepository;
let newCampaign: () => Promise<string>;

beforeAll(async () => {
  const db = await createTestDb();
  const campaigns = createCampaignRepository(db);

  members = createMemberRepository(db);
  newCampaign = async () => {
    const created = campaign();

    await campaigns.create(created, ownerOf(created));

    return created.campaignId;
  };
});

const beto = member({ userId: "u-beto", username: "beto" });

it("add: primeira vez cria; segunda devolve o que estava gravado", async () => {
  const campaignId = await newCampaign();

  const first = await members.add(campaignId, beto);
  const second = await members.add(campaignId, { ...beto, joinedAt: "2026-11-17T00:00:00.000Z" });

  expect(first).toEqual({ member: beto, created: true });
  expect(second).toEqual({ member: beto, created: false });
});

it("add não rebaixa o dono", async () => {
  const campaignId = await newCampaign();

  const { created, member: kept } = await members.add(campaignId, member({ userId: "u-ana" }));

  expect(created).toBe(false);
  expect(kept.role).toBe("OWNER");
});

it("find e remove", async () => {
  const campaignId = await newCampaign();

  await members.add(campaignId, beto);
  expect(await members.find(campaignId, "u-beto")).toEqual(beto);

  await members.remove(campaignId, "u-beto");
  expect(await members.find(campaignId, "u-beto")).toBeNull();
});

it("campaignIdsOf: as campanhas em que o usuário participa", async () => {
  const one = await newCampaign();
  const two = await newCampaign();
  await newCampaign();

  // Usuário só deste teste: os outros também põem o beto em campanhas da mesma tabela.
  const caio = member({ userId: `u-caio-${randomUUID().slice(0, 8)}`, username: "caio" });

  await members.add(one, caio);
  await members.add(two, caio);

  expect((await members.campaignIdsOf(caio.userId)).sort()).toEqual([one, two].sort());
});

it("setCharacter grava o personagem e mantém o resto", async () => {
  const campaignId = await newCampaign();

  await members.add(campaignId, beto);

  expect(
    await members.setCharacter(campaignId, "u-beto", { characterId: "ch1", characterName: "Lyra" }),
  ).toEqual({ ...beto, characterId: "ch1", characterName: "Lyra" });
});

it("setCharacter de quem não participa falha, sem criar o participante", async () => {
  const campaignId = await newCampaign();

  await expect(
    members.setCharacter(campaignId, "u-zeca", { characterId: "ch1", characterName: "Lyra" }),
  ).rejects.toThrow();
  expect(await members.find(campaignId, "u-zeca")).toBeNull();
});
