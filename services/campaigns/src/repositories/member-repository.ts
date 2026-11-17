// Tabela de participantes: um item por personagem em cada campanha, com chave `campaignId` + `characterId`.
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { Member } from "../domain/member.js";

type Item = Record<string, unknown>;

const toMember = (item: Item): Member => ({
  characterId: item.characterId as string,
  characterName: (item.characterName as string | undefined) ?? null,
  itemsAcquired: item.itemsAcquired as number,
  joinedAt: item.joinedAt as string,
});

export function createMemberRepository(db: Db) {
  const TableName = db.tables.members;

  return {
    async list(campaignId: string): Promise<Member[]> {
      const { Items = [] } = await db.doc.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: "campaignId = :campaignId",
          ExpressionAttributeValues: { ":campaignId": campaignId },
        }),
      );

      return Items.map(toMember);
    },

    /** Grava o participante ou, se ele já existe, só troca o nome; o contador de itens é mantido. */
    async save(
      campaignId: string,
      { characterId, characterName }: { characterId: string; characterName: string },
      now: string,
    ): Promise<{ member: Member; created: boolean }> {
      // O Update cria o item se ele não existe. if_not_exists mantém o valor que já estava gravado.
      const { Attributes: old } = await db.doc.send(
        new UpdateCommand({
          TableName,
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
    },
  };
}

export type MemberRepository = ReturnType<typeof createMemberRepository>;
