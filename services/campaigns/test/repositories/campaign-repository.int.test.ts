import { beforeAll, expect, it } from "vitest";
import { CampaignNotFound, JoinCodeTaken } from "../../src/domain/errors.js";
import { templateAssigned } from "../../src/messaging/outgoing.js";
import {
  type CampaignRepository,
  createCampaignRepository,
} from "../../src/repositories/campaign-repository.js";
import {
  createMemberRepository,
  type MemberRepository,
} from "../../src/repositories/member-repository.js";
import {
  createOutboxRepository,
  type OutboxRepository,
} from "../../src/repositories/outbox-repository.js";
import { campaign, NOW, ownerOf } from "../db/fixtures.js";
import { createTestDb } from "../db/test-db.js";

let campaigns: CampaignRepository;
let members: MemberRepository;
let outbox: OutboxRepository;

beforeAll(async () => {
  const db = await createTestDb();

  campaigns = createCampaignRepository(db);
  members = createMemberRepository(db);
  outbox = createOutboxRepository(db, 3);
});

it("grava a campanha com o dono como OWNER e acha pelo id e pelo código", async () => {
  const created = campaign();

  await campaigns.create(created, ownerOf(created), []);

  expect(await campaigns.find(created.campaignId)).toEqual(created);
  expect(await campaigns.findByJoinCode(created.joinCode)).toEqual(created);
  expect(await members.list(created.campaignId)).toEqual([ownerOf(created)]);
});

it("código já usado por outra campanha → JoinCodeTaken e nada gravado", async () => {
  const first = campaign();
  const second = campaign({ joinCode: first.joinCode });

  await campaigns.create(first, ownerOf(first), []);

  await expect(campaigns.create(second, ownerOf(second), [])).rejects.toBeInstanceOf(JoinCodeTaken);
  expect(await campaigns.find(second.campaignId)).toBeNull();
  expect(await members.list(second.campaignId)).toEqual([]);
});

it("inexistente → null, pelo id e pelo código", async () => {
  expect(await campaigns.find("nao-existe")).toBeNull();
  expect(await campaigns.findByJoinCode("abcdef")).toBeNull();
});

it("findMany devolve as que existem e ignora as que não", async () => {
  const one = campaign();
  const two = campaign();

  await campaigns.create(one, ownerOf(one), []);
  await campaigns.create(two, ownerOf(two), []);

  const found = await campaigns.findMany([one.campaignId, "nao-existe", two.campaignId]);

  expect(found.map((c) => c.campaignId).sort()).toEqual([one.campaignId, two.campaignId].sort());
  expect(await campaigns.findMany([])).toEqual([]);
});

it("assignTemplate grava o modelo e o evento juntos; campanha inexistente não grava nada", async () => {
  const created = campaign();
  const template = { templateId: "t1", version: 3, name: "Aventureiro", assignedAt: NOW };
  const event = templateAssigned(created.campaignId, created.ownerId, template);

  await campaigns.create(created, ownerOf(created), []);
  await campaigns.assignTemplate(created.campaignId, template, event);
  await expect(
    campaigns.assignTemplate("nao-existe", template, templateAssigned("nao-existe", "u", template)),
  ).rejects.toBeInstanceOf(CampaignNotFound);

  expect(await campaigns.find(created.campaignId)).toEqual({ ...created, template });
  // A outbox é uma tabela só para todos os testes deste arquivo: procura o evento pelo id.
  const pending = await outbox.claim(100, 30_000, new Date());

  expect(pending.filter((m) => m.type === event.type).map((m) => m.messageId)).toEqual([
    event.messageId,
  ]);
});
