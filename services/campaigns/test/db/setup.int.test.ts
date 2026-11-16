// Precisa de um DynamoDB (MiniStack) em AWS_ENDPOINT_URL, padrão http://localhost:4566.
import { DescribeTableCommand, DescribeTimeToLiveCommand } from "@aws-sdk/client-dynamodb";
import { expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { createDynamoClient } from "../../src/db/client.js";
import { ensureTables } from "../../src/db/setup.js";
import { uniqueTables } from "./unique-tables.js";

const env = loadEnv({ AWS_ENDPOINT_URL: "http://localhost:4566", ...process.env });
const client = createDynamoClient(env);

const keysOf = async (tableName: string) =>
  (await client.send(new DescribeTableCommand({ TableName: tableName }))).Table?.KeySchema;

it("cria as cinco tabelas com suas chaves, com TTL na inbox", async () => {
  const tables = uniqueTables();

  await ensureTables(client, tables);

  expect(await keysOf(tables.campaigns)).toEqual([{ AttributeName: "campaignId", KeyType: "HASH" }]);
  expect(await keysOf(tables.members)).toEqual([
    { AttributeName: "campaignId", KeyType: "HASH" },
    { AttributeName: "characterId", KeyType: "RANGE" },
  ]);
  expect(await keysOf(tables.activity)).toEqual([
    { AttributeName: "campaignId", KeyType: "HASH" },
    { AttributeName: "activityKey", KeyType: "RANGE" },
  ]);
  expect(await keysOf(tables.operations)).toEqual([{ AttributeName: "operationId", KeyType: "HASH" }]);
  expect(await keysOf(tables.inbox)).toEqual([{ AttributeName: "messageId", KeyType: "HASH" }]);

  const ttl = await client.send(new DescribeTimeToLiveCommand({ TableName: tables.inbox }));

  expect(ttl.TimeToLiveDescription?.AttributeName).toBe("expiresAt");
});

it("rodar de novo não dá erro", async () => {
  const tables = uniqueTables();

  await ensureTables(client, tables);
  await expect(ensureTables(client, tables)).resolves.toBeUndefined();
});

it("duas réplicas subindo ao mesmo tempo não dão erro", async () => {
  const tables = uniqueTables();

  await expect(Promise.all([ensureTables(client, tables), ensureTables(client, tables)])).resolves.toBeDefined();
});
