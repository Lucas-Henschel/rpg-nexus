import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type {
  ExternalValidationRequest,
  ExternalValidationResponse,
  PendingValidationResponse,
} from "../domain/validation.js";

export function createValidationRepository(db: Db, inboxTtlDays: number) {
  return {
    async record(
      request: ExternalValidationRequest,
      response: ExternalValidationResponse,
      traceContext: Record<string, string> = {},
    ): Promise<"applied" | "duplicate"> {
      const expiresAt = Math.floor(Date.now() / 1000) + inboxTtlDays * 24 * 60 * 60;
      const routingKey = response.type === "rpg.external.validation-succeeded.v1"
        ? "external.validation.succeeded.v1"
        : "external.validation.failed.v1";
      try {
        await db.doc.send(new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: db.tables.validationInbox,
                Item: { messageId: request.messageId, operationId: request.operationId, expiresAt },
                ConditionExpression: "attribute_not_exists(messageId)",
              },
            },
            {
              Put: {
                TableName: db.tables.validationOutbox,
                Item: {
                  messageId: response.messageId,
                  requestMessageId: request.messageId,
                  routingKey,
                  envelope: response,
                  traceContext,
                  status: "PENDING",
                  createdAt: response.occurredAt,
                },
                ConditionExpression: "attribute_not_exists(messageId)",
              },
            },
          ],
        }));
        return "applied";
      } catch (error) {
        if (
          error instanceof TransactionCanceledException &&
          error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
        ) return "duplicate";
        throw error;
      }
    },

    async pending(limit = 25): Promise<PendingValidationResponse[]> {
      // O Limit do Scan conta os itens lidos antes do filtro, e as respostas publicadas ficam na tabela:
      // uma página pode vir sem nenhuma pendente e ainda haver mais. Segue as páginas até juntar o limite.
      const Items: Record<string, unknown>[] = [];
      let ExclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const page = await db.doc.send(new ScanCommand({
          TableName: db.tables.validationOutbox,
          FilterExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":pending": "PENDING" },
          Limit: limit,
          ExclusiveStartKey,
        }));
        Items.push(...(page.Items ?? []));
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey && Items.length < limit);
      return Items.slice(0, limit).map((item) => ({
        messageId: item.messageId as string,
        routingKey: item.routingKey as PendingValidationResponse["routingKey"],
        envelope: item.envelope as ExternalValidationResponse,
        traceContext: (item.traceContext as Record<string, string> | undefined) ?? {},
      }));
    },

    async markPublished(messageId: string): Promise<void> {
      await db.doc.send(new UpdateCommand({
        TableName: db.tables.validationOutbox,
        Key: { messageId },
        UpdateExpression: "SET #status = :published, publishedAt = :now",
        ConditionExpression: "#status = :pending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":pending": "PENDING",
          ":published": "PUBLISHED",
          ":now": new Date().toISOString(),
        },
      }));
    },
  };
}

export type ValidationRepository = ReturnType<typeof createValidationRepository>;
