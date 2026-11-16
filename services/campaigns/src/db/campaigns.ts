// Tabela `campaigns`: um item por campanha, com chave `campaignId`.
import { GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Campaign } from "../domain/campaign.js";
import { CampaignAlreadyExists } from "../domain/errors.js";
import type { Db } from "./client.js";

type Item = Record<string, unknown>;

const toCampaign = (item: Item): Campaign => ({
  campaignId: item.campaignId as string,
  name: item.name as string,
  gameMaster: (item.gameMaster as string | undefined) ?? null,
  createdAt: item.createdAt as string,
});

export async function createCampaign(
  db: Db,
  { campaignId, name, gameMaster }: { campaignId: string; name: string; gameMaster: string | null },
  now: string,
): Promise<Campaign> {
  const campaign: Campaign = { campaignId, name, gameMaster, createdAt: now };

  try {
    await db.doc.send(
      new PutCommand({
        TableName: db.tables.campaigns,
        Item: { ...campaign, gameMaster: gameMaster ?? undefined },
        // Só grava se ainda não existe campanha com esse código.
        ConditionExpression: "attribute_not_exists(campaignId)",
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      throw new CampaignAlreadyExists(campaignId);
    }

    throw error;
  }

  return campaign;
}

export async function findCampaign(db: Db, campaignId: string): Promise<Campaign | null> {
  const { Item } = await db.doc.send(new GetCommand({ TableName: db.tables.campaigns, Key: { campaignId } }));

  return Item ? toCampaign(Item) : null;
}

export async function listCampaigns(db: Db): Promise<Campaign[]> {
  const campaigns: Campaign[] = [];
  let startKey: Item | undefined;

  // São poucas campanhas: lê a tabela inteira, uma página por vez.
  do {
    const page = await db.doc.send(new ScanCommand({
      TableName: db.tables.campaigns, 
      ExclusiveStartKey: startKey 
    }));

    campaigns.push(...(page.Items ?? []).map(toCampaign));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  return campaigns.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
