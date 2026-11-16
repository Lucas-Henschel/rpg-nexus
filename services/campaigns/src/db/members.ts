// Tabela `campaign_members`: um item por personagem em cada campanha, com chave `campaignId` + `characterId`.
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CampaignNotFound } from "../domain/errors.js";
import type { Member } from "../domain/member.js";
import { findCampaign } from "./campaigns.js";
import type { Db } from "./client.js";

type Item = Record<string, unknown>;

const toMember = (item: Item): Member => ({
  characterId: item.characterId as string,
  characterName: (item.characterName as string | undefined) ?? null,
  itemsAcquired: item.itemsAcquired as number,
  joinedAt: item.joinedAt as string,
});

export async function listMembers(db: Db, campaignId: string): Promise<Member[]> {
  const { Items = [] } = await db.doc.send(
    new QueryCommand({
      TableName: db.tables.members,
      KeyConditionExpression: "campaignId = :campaignId",
      ExpressionAttributeValues: { ":campaignId": campaignId },
    }),
  );

  return Items.map(toMember);
}

/** Adiciona o personagem ou, se ele já participa, só troca o nome; o contador de itens é mantido. */
export async function addMember(
  db: Db,
  campaignId: string,
  characterId: string,
  characterName: string,
  now: string,
): Promise<{ member: Member; created: boolean }> {
  if (!(await findCampaign(db, campaignId))) {
    throw new CampaignNotFound(campaignId);
  }

  // O Update cria o item se ele não existe. if_not_exists mantém o valor que já estava gravado.
  const { Attributes: old } = await db.doc.send(
    new UpdateCommand({
      TableName: db.tables.members,
      Key: { campaignId, characterId },
      UpdateExpression:
        "SET characterName = :name, joinedAt = if_not_exists(joinedAt, :now), itemsAcquired = if_not_exists(itemsAcquired, :zero)",
      ExpressionAttributeValues: { ":name": characterName, ":now": now, ":zero": 0 },
      ReturnValues: "ALL_OLD",
    }),
  );

  const member: Member = {
    characterId,
    characterName,
    itemsAcquired: (old?.itemsAcquired as number | undefined) ?? 0,
    joinedAt: (old?.joinedAt as string | undefined) ?? now,
  };

  return { member, created: old === undefined };
}
