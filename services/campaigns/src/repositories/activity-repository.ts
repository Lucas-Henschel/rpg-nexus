// Tabela de atividade: um item por aquisição, com chave `campaignId` + `activityKey` (occurredAt#operationId).
// Quem grava aqui é o acquisition-repository, dentro da transação da aquisição.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { Activity, CampaignSummary } from "../domain/activity.js";

const RECENT_ACTIVITY_LIMIT = 20;
const SUMMARY_TOP_ITEMS = 10;

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

    /**
     * Resumo da campanha: lê toda a atividade (query paginada, nunca Scan) e soma por item e por
     * personagem. É a consulta do lado de leitura; as gravações continuam só no acquisition-repository.
     */
    async summarize(campaignId: string): Promise<CampaignSummary> {
      const items = new Map<string, { itemName: string | null; quantity: number }>();
      const characters = new Map<string, number>();
      let acquisitions = 0;
      let totalQuantity = 0;
      let lastAcquiredAt: string | null = null;
      let startKey: Record<string, unknown> | undefined;

      do {
        const page = await db.doc.send(
          new QueryCommand({
            TableName: db.tables.activity,
            KeyConditionExpression: "campaignId = :campaignId",
            ExpressionAttributeValues: { ":campaignId": campaignId },
            ExclusiveStartKey: startKey,
          }),
        );

        for (const item of page.Items ?? []) {
          const { itemId, itemName, characterId, quantity, occurredAt } = toActivity(item);
          const known = items.get(itemId);

          items.set(itemId, {
            itemName: known?.itemName ?? itemName,
            quantity: (known?.quantity ?? 0) + quantity,
          });
          characters.set(characterId, (characters.get(characterId) ?? 0) + quantity);
          acquisitions += 1;
          totalQuantity += quantity;

          if (!lastAcquiredAt || occurredAt > lastAcquiredAt) {
            lastAcquiredAt = occurredAt;
          }
        }

        startKey = page.LastEvaluatedKey;
      } while (startKey);

      const byQuantity = <T extends { quantity: number }>(a: T, b: T) => b.quantity - a.quantity;

      return {
        acquisitions,
        totalQuantity,
        topItems: [...items]
          .map(([itemId, { itemName, quantity }]) => ({ itemId, itemName, quantity }))
          .sort(byQuantity)
          .slice(0, SUMMARY_TOP_ITEMS),
        byCharacter: [...characters]
          .map(([characterId, quantity]) => ({ characterId, quantity }))
          .sort(byQuantity),
        lastAcquiredAt,
      };
    },
  };
}

export type ActivityRepository = ReturnType<typeof createActivityRepository>;
