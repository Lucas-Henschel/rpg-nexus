// Tabela de campanhas: um item por campanha, com chave `campaignId`.
import { GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { Campaign } from "../domain/campaign.js";
import { CampaignAlreadyExists } from "../domain/errors.js";

type Item = Record<string, unknown>;

const toCampaign = (item: Item): Campaign => ({
  campaignId: item.campaignId as string,
  name: item.name as string,
  gameMaster: (item.gameMaster as string | undefined) ?? null,
  createdAt: item.createdAt as string,
});

export function createCampaignRepository(db: Db) {
  const TableName = db.tables.campaigns;

  return {
    /** Lança CampaignAlreadyExists se já existe campanha com esse código. */
    async create(campaign: Campaign): Promise<void> {
      try {
        await db.doc.send(
          new PutCommand({
            TableName,
            Item: { ...campaign, gameMaster: campaign.gameMaster ?? undefined },
            // Só grava se ainda não existe campanha com esse código.
            ConditionExpression: "attribute_not_exists(campaignId)",
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
          throw new CampaignAlreadyExists(campaign.campaignId);
        }

        throw error;
      }
    },

    async find(campaignId: string): Promise<Campaign | null> {
      const { Item } = await db.doc.send(new GetCommand({ TableName, Key: { campaignId } }));

      return Item ? toCampaign(Item) : null;
    },

    /** Todas as campanhas, da mais antiga para a mais nova. */
    async list(): Promise<Campaign[]> {
      const campaigns: Campaign[] = [];
      let startKey: Item | undefined;

      // São poucas campanhas: lê a tabela inteira, uma página por vez.
      do {
        const page = await db.doc.send(new ScanCommand({ TableName, ExclusiveStartKey: startKey }));

        campaigns.push(...(page.Items ?? []).map(toCampaign));
        startKey = page.LastEvaluatedKey;
      } while (startKey);

      return campaigns.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  };
}

export type CampaignRepository = ReturnType<typeof createCampaignRepository>;
