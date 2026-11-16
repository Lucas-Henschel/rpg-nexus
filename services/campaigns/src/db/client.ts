import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Env } from "../config.js";
import type { Tables } from "./tables.js";

/** O cliente e os nomes das tabelas, que todas as funções de db/ recebem. */
export interface Db {
  doc: DynamoDBDocumentClient;
  tables: Tables;
}

export function createDynamoClient(env: Env): DynamoDBClient {
  return new DynamoDBClient({ endpoint: env.AWS_ENDPOINT_URL, region: env.AWS_REGION });
}

export function createDocumentClient(env: Env): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(createDynamoClient(env), {
    marshallOptions: { removeUndefinedValues: true },
  });
}
