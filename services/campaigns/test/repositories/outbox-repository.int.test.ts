import { expect, it } from "vitest";
import { JoinCodeTaken } from "../../src/domain/errors.js";
import { campaignCreated, memberJoined, memberRemoved } from "../../src/messaging/outgoing.js";
import { createCampaignRepository } from "../../src/repositories/campaign-repository.js";
import { createMemberRepository } from "../../src/repositories/member-repository.js";
import { createOutboxRepository } from "../../src/repositories/outbox-repository.js";
import { campaign, member, NOW, ownerOf } from "../db/fixtures.js";
import { createTestDb } from "../db/test-db.js";

const LEASE_MS = 30_000;
const at = (offsetMs: number) => new Date(Date.parse(NOW) + offsetMs);

/** Tabelas novas a cada teste: a outbox é uma fila só, e um teste não pode pegar o evento de outro. */
async function repositories() {
  const db = await createTestDb();

  return {
    campaigns: createCampaignRepository(db),
    members: createMemberRepository(db),
    outbox: createOutboxRepository(db, 3),
  };
}

const types = (messages: { type: string }[]) => messages.map((message) => message.type);

it("criar a campanha grava os eventos na mesma transação, e o relay os pega em ordem", async () => {
  const { campaigns, outbox } = await repositories();
  const created = campaign();
  const owner = ownerOf(created);
  const events = [campaignCreated(created), memberJoined(created.campaignId, owner)];

  await campaigns.create(created, owner, events);

  const claimed = await outbox.claim(10, LEASE_MS, at(0));

  expect(claimed).toEqual(events);
});

it("código repetido: nem a campanha nem os eventos são gravados", async () => {
  const { campaigns, outbox } = await repositories();
  const first = campaign();
  const second = campaign({ joinCode: first.joinCode });

  await campaigns.create(first, ownerOf(first), []);
  await expect(
    campaigns.create(second, ownerOf(second), [campaignCreated(second)]),
  ).rejects.toBeInstanceOf(JoinCodeTaken);

  expect(await outbox.claim(10, LEASE_MS, at(0))).toEqual([]);
});

it("entrar duas vezes e sair duas vezes gravam um evento de cada", async () => {
  const { campaigns, members, outbox } = await repositories();
  const created = campaign();
  const beto = member({ userId: "u-beto", username: "beto" });
  const left = () =>
    memberRemoved(created.campaignId, {
      userId: "u-beto",
      removedBy: "u-beto",
      reason: "LEFT",
      removedAt: NOW,
    });

  await campaigns.create(created, ownerOf(created), []);
  await members.add(created.campaignId, beto, memberJoined(created.campaignId, beto));
  await members.add(created.campaignId, beto, memberJoined(created.campaignId, beto));
  await members.remove(created.campaignId, "u-beto", left());
  await members.remove(created.campaignId, "u-beto", left());

  expect(types(await outbox.claim(10, LEASE_MS, at(0)))).toEqual([
    "rpg.campaign.member.joined.v1",
    "rpg.campaign.member.removed.v1",
  ]);
});

it("reservado não sai de novo até o prazo vencer; publicado não sai mais", async () => {
  const { campaigns, outbox } = await repositories();
  const created = campaign();
  const [event] = [campaignCreated(created)];

  await campaigns.create(created, ownerOf(created), [event]);

  expect(await outbox.claim(10, LEASE_MS, at(0))).toHaveLength(1);
  // Outra réplica, antes do prazo: nada.
  expect(await outbox.claim(10, LEASE_MS, at(1_000))).toEqual([]);
  // Quem reservou caiu sem publicar: depois do prazo, outra réplica pega.
  expect(await outbox.claim(10, LEASE_MS, at(LEASE_MS + 1))).toEqual([event]);

  await outbox.markPublished(event.messageId, at(LEASE_MS + 2));

  expect(await outbox.claim(10, LEASE_MS, at(10 * LEASE_MS))).toEqual([]);
});
