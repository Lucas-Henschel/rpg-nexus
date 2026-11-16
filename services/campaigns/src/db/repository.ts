// Leituras e gravações nas tabelas do S1. As consultas e a transação do ItemAcquired entram na Task 2.
import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Tables } from "./tables.js";

export function createRepository(doc: DynamoDBDocumentClient, tables: Tables) {
  return {
    async ping(): Promise<void> {
      await doc.send(new DescribeTableCommand({ TableName: tables.campaigns }));
    },
  };
}
