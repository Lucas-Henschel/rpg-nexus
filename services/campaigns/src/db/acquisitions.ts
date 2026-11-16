// Aquisições de itens vindas do RabbitMQ: viram atividade da campanha e somam no contador do participante.
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Acquisition, AcquisitionResult } from "../domain/acquisition.js";
import type { Activity } from "../domain/activity.js";
import type { Db } from "./client.js";

const RECENT_ACTIVITY_LIMIT = 20;

type Item = Record<string, unknown>;

const toActivity = (item: Item): Activity => ({
  operationId: item.operationId as string,
  characterId: item.characterId as string,
  itemId: item.itemId as string,
  itemName: (item.itemName as string | undefined) ?? null,
  quantity: item.quantity as number,
  occurredAt: item.occurredAt as string,
});

/** As últimas atividades da campanha, da mais nova para a mais antiga. */
export async function listRecentActivity(db: Db, campaignId: string): Promise<Activity[]> {
  const { Items = [] } = await db.doc.send(
    new QueryCommand({
      TableName: db.tables.activity,
      KeyConditionExpression: "campaignId = :campaignId",
      ExpressionAttributeValues: { ":campaignId": campaignId },
      ScanIndexForward: false, // ordem decrescente de activityKey, que começa pela data
      Limit: RECENT_ACTIVITY_LIMIT,
    }),
  );

  return Items.map(toActivity);
}

export async function recordAcquisition(
  db: Db,
  event: Acquisition,
  now: string,
  inboxTtlDays: number,
): Promise<AcquisitionResult> {
  const expiresAt = Math.floor(Date.parse(now) / 1000) + inboxTtlDays * 24 * 60 * 60;

  try {
    // Tudo ou nada. A ordem importa: o índice de cada operação identifica a condição que falhou.
    await db.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          // 0: a mesma mensagem já foi processada
          {
            Put: {
              TableName: db.tables.inbox,
              Item: { messageId: event.messageId, expiresAt },
              ConditionExpression: "attribute_not_exists(messageId)",
            },
          },
          // 1: a campanha existe
          {
            ConditionCheck: {
              TableName: db.tables.campaigns,
              Key: { campaignId: event.campaignId },
              ConditionExpression: "attribute_exists(campaignId)",
            },
          },
          // 2: a mesma operação já foi contada, com outro messageId
          {
            Put: {
              TableName: db.tables.operations,
              Item: { operationId: event.operationId, messageId: event.messageId, processedAt: now },
              ConditionExpression: "attribute_not_exists(operationId)",
            },
          },
          // 3: a atividade
          {
            Put: {
              TableName: db.tables.activity,
              Item: {
                campaignId: event.campaignId,
                activityKey: `${event.occurredAt}#${event.operationId}`,
                operationId: event.operationId,
                characterId: event.characterId,
                itemId: event.itemId,
                itemName: event.itemName,
                quantity: event.quantity,
                occurredAt: event.occurredAt,
              },
            },
          },
          // 4: soma a quantidade no participante, criando-o se ainda não participa
          {
            Update: {
              TableName: db.tables.members,
              Key: { campaignId: event.campaignId, characterId: event.characterId },
              UpdateExpression: "SET joinedAt = if_not_exists(joinedAt, :now) ADD itemsAcquired :quantity",
              ExpressionAttributeValues: { ":now": now, ":quantity": event.quantity },
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (!(error instanceof TransactionCanceledException)) {
      throw error;
    }

    const failed = (index: number) => error.CancellationReasons?.[index]?.Code === "ConditionalCheckFailed";

    if (failed(0) || failed(2)) {
      return "duplicate";
    }

    if (failed(1)) {
      return "unknown-campaign";
    }

    throw error;
  }

  return "applied";
}
