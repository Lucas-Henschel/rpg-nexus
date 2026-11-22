import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Env } from "../config.js";
import { traceDynamoCommands } from "../tracing/dynamodb.js";
import { type Tables, tablesFromEnv } from "./tables.js";

export interface Db {
  doc: DynamoDBDocumentClient;
  tables: Tables;
}

export function createDynamoClient(env: Env): DynamoDBClient {
  const client = new DynamoDBClient({ endpoint: env.AWS_ENDPOINT_URL, region: env.AWS_REGION });
  traceDynamoCommands(client);
  return client;
}

export function createDb(env: Env): Db {
  const doc = DynamoDBDocumentClient.from(createDynamoClient(env), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return { doc, tables: tablesFromEnv(env) };
}

export async function pingDatabase(db: Db): Promise<void> {
  await db.doc.send(new DescribeTableCommand({ TableName: db.tables.users }));
}
