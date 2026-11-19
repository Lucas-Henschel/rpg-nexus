// Aquisições de itens vindas do RabbitMQ: viram atividade da campanha e somam no contador do participante
// que usa o personagem.
// É o único repositório que grava em várias tabelas, porque tudo precisa acontecer numa transação só.
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { Acquisition, AcquisitionResult } from "../domain/acquisition.js";

export function createAcquisitionRepository(db: Db, inboxTtlDays: number) {
  return {
    /** `userId`: o participante que usa o personagem; null se ninguém o escolheu (só a atividade é gravada). */
    async record(
      event: Acquisition,
      now: string,
      userId: string | null,
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
                  Item: {
                    operationId: event.operationId,
                    messageId: event.messageId,
                    processedAt: now,
                  },
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
              // 4: soma a quantidade no participante, se ele ainda usa o personagem
              ...(userId
                ? [
                    {
                      Update: {
                        TableName: db.tables.members,
                        Key: { campaignId: event.campaignId, userId },
                        UpdateExpression: "ADD itemsAcquired :quantity",
                        ConditionExpression: "characterId = :characterId",
                        ExpressionAttributeValues: {
                          ":quantity": event.quantity,
                          ":characterId": event.characterId,
                        },
                      },
                    },
                  ]
                : []),
            ],
          }),
        );
      } catch (error) {
        if (!(error instanceof TransactionCanceledException)) {
          throw error;
        }

        const failed = (index: number) =>
          error.CancellationReasons?.[index]?.Code === "ConditionalCheckFailed";

        if (failed(0) || failed(2)) {
          return "duplicate";
        }

        if (failed(1)) {
          return "unknown-campaign";
        }

        // 4: o participante trocou de personagem ou saiu no meio; a mensagem volta e é refeita.
        throw error;
      }

      return "applied";
    },
  };
}

export type AcquisitionRepository = ReturnType<typeof createAcquisitionRepository>;
