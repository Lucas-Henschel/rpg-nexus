import {
  CreateTableCommand,
  type CreateTableCommandInput,
  DescribeTimeToLiveCommand,
  type DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import type { Tables } from "./tables.js";

function table(name: string, partitionKey: string, sortKey?: string): CreateTableCommandInput {
  const keys = sortKey ? [partitionKey, sortKey] : [partitionKey];
  return {
    TableName: name,
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: keys.map((key, index) => ({
      AttributeName: key,
      KeyType: index === 0 ? "HASH" : "RANGE",
    })),
    AttributeDefinitions: keys.map((key) => ({ AttributeName: key, AttributeType: "S" })),
  };
}

const definitions = (tables: Tables): CreateTableCommandInput[] => [
  table(tables.users, "userId"),
  table(tables.identities, "identityKey"),
  table(tables.sessions, "sessionId"),
  table(tables.loginAttempts, "throttleKey"),
  table(tables.history, "campaignId", "historyKey"),
  table(tables.historyInbox, "messageId"),
  table(tables.historyMemberships, "campaignId", "userId"),
  table(tables.audit, "auditId"),
  table(tables.validationInbox, "messageId"),
  table(tables.validationOutbox, "messageId"),
];

async function createTable(client: DynamoDBClient, input: CreateTableCommandInput): Promise<void> {
  try {
    await client.send(new CreateTableCommand(input));
  } catch (error) {
    if (!(error instanceof Error && error.name === "ResourceInUseException")) throw error;
  }

  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: input.TableName });
}

async function enableTtl(client: DynamoDBClient, tableName: string): Promise<void> {
  try {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: tableName,
        TimeToLiveSpecification: { Enabled: true, AttributeName: "expiresAt" },
      }),
    );
  } catch (error) {
    const { TimeToLiveDescription } = await client.send(new DescribeTimeToLiveCommand({ TableName: tableName }));
    if (TimeToLiveDescription?.AttributeName !== "expiresAt") throw error;
  }
}

export async function ensureTables(client: DynamoDBClient, tables: Tables): Promise<void> {
  await Promise.all(definitions(tables).map((input) => createTable(client, input)));
  await Promise.all([
    enableTtl(client, tables.sessions),
    enableTtl(client, tables.loginAttempts),
    enableTtl(client, tables.historyInbox),
    enableTtl(client, tables.validationInbox),
  ]);
}
