// Outbox: eventos gravados na mesma transação da mudança, publicados depois pelo relay.
//
// Um evento pendente tem `pendingKey = PENDING`, o que o coloca no índice esparso `pending`,
// ordenado por `pendingAt`: o instante da gravação e a posição do evento na transação. Para publicar, o relay reserva o evento por um tempo (`leaseUntil`),
// assim duas réplicas não publicam o mesmo ao mesmo tempo. Depois de publicado, o evento sai do
// índice e o DynamoDB o apaga quando passa o `expiresAt`.
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { OutboxMessage } from "../messaging/outgoing.js";

export const OUTBOX_PENDING_INDEX = "pending";
const PENDING = "PENDING";

type Item = Record<string, unknown>;

/**
 * O Put que grava o evento como pendente, para ir dentro de uma TransactWrite. `position` é a ordem do
 * evento na transação: CampaignCreated sai antes da entrada do dono, mesmo gravados no mesmo instante.
 */
export function outboxPut(db: Db, message: OutboxMessage, position = 0) {
  const pendingAt = `${new Date().toISOString()}#${String(position).padStart(3, "0")}`;

  return {
    Put: {
      TableName: db.tables.outbox,
      Item: { ...message, pendingKey: PENDING, pendingAt, attempts: 0 },
    },
  };
}

const toMessage = (item: Item): OutboxMessage => ({
  messageId: item.messageId as string,
  type: item.type as string,
  routingKey: item.routingKey as string,
  body: item.body as string,
  headers: (item.headers as Record<string, string> | undefined) ?? {},
  createdAt: item.createdAt as string,
});

const isConditionFailure = (error: unknown) =>
  error instanceof Error && error.name === "ConditionalCheckFailedException";

export function createOutboxRepository(db: Db, publishedTtlDays: number) {
  const TableName = db.tables.outbox;

  return {
    /**
     * Reserva até `limit` eventos pendentes, dos mais antigos para os mais novos, por `leaseMs`.
     * Os que outra réplica já reservou ficam de fora.
     */
    async claim(limit: number, leaseMs: number, now: Date): Promise<OutboxMessage[]> {
      const { Items = [] } = await db.doc.send(
        new QueryCommand({
          TableName,
          IndexName: OUTBOX_PENDING_INDEX,
          KeyConditionExpression: "pendingKey = :pending",
          ExpressionAttributeValues: { ":pending": PENDING },
          Limit: limit,
        }),
      );

      const claimed: OutboxMessage[] = [];

      for (const item of Items) {
        try {
          const { Attributes } = await db.doc.send(
            new UpdateCommand({
              TableName,
              Key: { messageId: item.messageId },
              UpdateExpression: "SET leaseUntil = :until ADD attempts :one",
              // O índice é eventualmente consistente: confere de novo que ainda está pendente.
              ConditionExpression:
                "pendingKey = :pending AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)",
              ExpressionAttributeValues: {
                ":pending": PENDING,
                ":now": now.toISOString(),
                ":until": new Date(now.getTime() + leaseMs).toISOString(),
                ":one": 1,
              },
              ReturnValues: "ALL_NEW",
            }),
          );

          claimed.push(toMessage(Attributes as Item));
        } catch (error) {
          if (!isConditionFailure(error)) {
            throw error;
          }
        }
      }

      return claimed;
    },

    /** Tira o evento dos pendentes; o DynamoDB o apaga depois de `publishedTtlDays`. */
    async markPublished(messageId: string, now: Date): Promise<void> {
      const expiresAt = Math.floor(now.getTime() / 1000) + publishedTtlDays * 24 * 60 * 60;

      await db.doc.send(
        new UpdateCommand({
          TableName,
          Key: { messageId },
          UpdateExpression:
            "SET publishedAt = :now, expiresAt = :expiresAt REMOVE pendingKey, leaseUntil",
          ExpressionAttributeValues: { ":now": now.toISOString(), ":expiresAt": expiresAt },
        }),
      );
    },
  };
}

export type OutboxRepository = ReturnType<typeof createOutboxRepository>;
