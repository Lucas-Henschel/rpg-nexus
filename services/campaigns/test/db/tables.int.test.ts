// Precisa de um DynamoDB (MiniStack) em AWS_ENDPOINT_URL, padrão http://localhost:4566.
import { randomUUID } from "node:crypto";
import { DescribeTableCommand, DescribeTimeToLiveCommand } from "@aws-sdk/client-dynamodb";
import { expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { createDynamoClient } from "../../src/db/client.js";
import { ensureTables } from "../../src/db/tables.js";

const env = loadEnv({ AWS_ENDPOINT_URL: "http://localhost:4566", ...process.env });
const client = createDynamoClient(env);

function uniqueTables() {
  const suffix = randomUUID().slice(0, 8);

  return { campaigns: `campaigns_${suffix}`, inbox: `campaign_inbox_${suffix}` };
}

it("cria as duas tabelas, com TTL na inbox", async () => {
  const tables = uniqueTables();

  await ensureTables(client, tables);

  const campaigns = await client.send(new DescribeTableCommand({ TableName: tables.campaigns }));
  const ttl = await client.send(new DescribeTimeToLiveCommand({ TableName: tables.inbox }));

  expect(campaigns.Table?.KeySchema).toEqual([
    { AttributeName: "pk", KeyType: "HASH" },
    { AttributeName: "sk", KeyType: "RANGE" },
  ]);
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
