import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { createItemAcquiredParser, PoisonMessage } from "../../src/messaging/events.js";

const contractsDir = resolve(loadEnv({}).CONTRACTS_DIR);
const parse = createItemAcquiredParser(contractsDir);

const example = (kind: "valid" | "invalid") =>
  readFile(resolve(contractsDir, `examples/item-acquired.v1.${kind}.json`));

it("aceita o exemplo válido do contrato e devolve a aquisição", async () => {
  expect(parse(await example("valid"))).toEqual({
    messageId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e",
    occurredAt: "2026-11-11T12:00:05Z",
    operationId: "0b7d4a52-3f1e-4c8e-9a51-2f6a8d1c9e01",
    campaignId: "c1",
    characterId: "p1",
    itemId: "sword",
    quantity: 1,
    itemName: "Espada de Cinzas",
  });
});

it("recusa o exemplo inválido com PoisonMessage", async () => {
  const body = await example("invalid");

  expect(() => parse(body)).toThrow(PoisonMessage);
});

it("recusa corpo que não é JSON com PoisonMessage", () => {
  expect(() => parse(Buffer.from("{nao é json"))).toThrow(PoisonMessage);
});
