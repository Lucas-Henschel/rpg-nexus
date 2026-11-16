// Tabela de atividade: um item por aquisição, com chave `campaignId` + `activityKey` (occurredAt#operationId).
// Quem grava aqui é o acquisition-repository, dentro da transação da aquisição.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { Activity } from "../domain/activity.js";

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

export function createActivityRepository(db: Db) {
  return {
    /** As últimas atividades da campanha, da mais nova para a mais antiga. */
    async listRecent(campaignId: string): Promise<Activity[]> {
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
    },
  };
}

export type ActivityRepository = ReturnType<typeof createActivityRepository>;
