import {
  CreateTableCommand,
  type CreateTableCommandInput,
  DescribeTimeToLiveCommand,
  type DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import type { Tables } from "./tables.js";

function table(name: string, partitionKey: string): CreateTableCommandInput {
  return {
    TableName: name,
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [{ AttributeName: partitionKey, KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: partitionKey, AttributeType: "S" }],
  };
}

const definitions = (tables: Tables): CreateTableCommandInput[] => [
  table(tables.users, "userId"),
  table(tables.identities, "identityKey"),
  table(tables.sessions, "sessionId"),
];

async function createTable(client: DynamoDBClient, input: CreateTableCommandInput): Promise<void> {
  try {
    await client.send(new CreateTableCommand(input));
  } catch (error) {
    if (!(error instanceof Error && error.name === "ResourceInUseException")) throw error;
  }

  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: input.TableName });
}

async function enableSessionTtl(client: DynamoDBClient, tableName: string): Promise<void> {
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
  await enableSessionTtl(client, tables.sessions);
}
