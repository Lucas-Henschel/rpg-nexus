import { randomInt, randomUUID } from "node:crypto";
import type { Campaign } from "../../src/domain/campaign.js";
import type { Member } from "../../src/domain/member.js";

export const NOW = "2026-11-16T12:00:00.000Z";

/** Participante com os campos padrão de quem acabou de entrar. */
export const member = (overrides: Partial<Member> = {}): Member => ({
  userId: "u-ana",
  username: "ana",
  role: "PLAYER",
  characterId: null,
  characterName: null,
  itemsAcquired: 0,
  joinedAt: NOW,
  ...overrides,
});

/** Campanha nova, com id e código aleatórios para não colidir com a de outro teste. */
export const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  campaignId: `c-${randomUUID().slice(0, 8)}`,
  name: "A Coroa de Cinzas",
  ownerId: "u-ana",
  ownerName: "ana",
  joinCode: randomInt(0, 1_000_000).toString().padStart(6, "0"),
  createdAt: NOW,
  template: null,
  ...overrides,
});

/** O dono da campanha como participante OWNER. */
export const ownerOf = (c: Campaign): Member =>
  member({ userId: c.ownerId, username: c.ownerName, role: "OWNER" });
