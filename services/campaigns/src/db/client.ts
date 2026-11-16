// Conexão com o DynamoDB.
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Env } from "../config.js";
import { traceDynamoCommands } from "../tracing/dynamodb.js";
import { type Tables, tablesFromEnv } from "./tables.js";

/** O cliente e os nomes das tabelas, que todos os repositórios recebem. */
export interface Db {
  doc: DynamoDBDocumentClient;
  tables: Tables;
}

export function createDynamoClient(env: Env): DynamoDBClient {
  const client = new DynamoDBClient({ endpoint: env.AWS_ENDPOINT_URL, region: env.AWS_REGION });

  traceDynamoCommands(client);

  return client;
}

export function createDocumentClient(env: Env): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(createDynamoClient(env), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export function createDb(env: Env): Db {
  return { doc: createDocumentClient(env), tables: tablesFromEnv(env) };
}

/** Para o /ready: falha se o DynamoDB não responde ou se as tabelas ainda não foram criadas. */
export async function pingDatabase(db: Db): Promise<void> {
  await db.doc.send(new DescribeTableCommand({ TableName: db.tables.campaigns }));
}
