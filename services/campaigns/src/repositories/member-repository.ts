// Tabela de participantes: um item por usuário em cada campanha, com chave `campaignId` + `userId`.
// O índice `byUser` (userId + campaignId) responde "de quais campanhas este usuário participa".
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { Member, Role } from "../domain/member.js";

type Item = Record<string, unknown>;

export const MEMBERS_BY_USER_INDEX = "byUser";

const toMember = (item: Item): Member => ({
  userId: item.userId as string,
  username: item.username as string,
  role: item.role as Role,
  characterId: (item.characterId as string | undefined) ?? null,
  characterName: (item.characterName as string | undefined) ?? null,
  itemsAcquired: (item.itemsAcquired as number | undefined) ?? 0,
  joinedAt: item.joinedAt as string,
});

export function createMemberRepository(db: Db) {
  const TableName = db.tables.members;

  async function find(campaignId: string, userId: string): Promise<Member | null> {
    const { Item } = await db.doc.send(new GetCommand({ TableName, Key: { campaignId, userId } }));

    return Item ? toMember(Item) : null;
  }

  /** Grava o participante se ele ainda não participa; se já participa, devolve o que estava gravado. */
  async function add(
    campaignId: string,
    member: Member,
  ): Promise<{ member: Member; created: boolean }> {
    try {
      await db.doc.send(
        new PutCommand({
          TableName,
          Item: { campaignId, ...member },
          ConditionExpression: "attribute_not_exists(userId)",
        }),
      );

      return { member, created: true };
    } catch (error) {
      if (!(error instanceof Error && error.name === "ConditionalCheckFailedException")) {
        throw error;
      }

      const existing = await find(campaignId, member.userId);

      // Saiu entre o Put e o Get: grava de novo.
      return existing ? { member: existing, created: false } : add(campaignId, member);
    }
  }

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

    find,

    add,

    async campaignIdsOf(userId: string): Promise<string[]> {
      const ids: string[] = [];
      let startKey: Item | undefined;

      do {
        const page = await db.doc.send(
          new QueryCommand({
            TableName,
            IndexName: MEMBERS_BY_USER_INDEX,
            KeyConditionExpression: "userId = :userId",
            ExpressionAttributeValues: { ":userId": userId },
            ExclusiveStartKey: startKey,
          }),
        );

        ids.push(...(page.Items ?? []).map((item) => item.campaignId as string));
        startKey = page.LastEvaluatedKey;
      } while (startKey);

      return ids;
    },

    /** Troca o personagem do participante e devolve o participante atualizado. */
    async setCharacter(
      campaignId: string,
      userId: string,
      { characterId, characterName }: { characterId: string; characterName: string },
    ): Promise<Member> {
      const { Attributes } = await db.doc.send(
        new UpdateCommand({
          TableName,
          Key: { campaignId, userId },
          UpdateExpression: "SET characterId = :characterId, characterName = :characterName",
          // Não recria quem saiu da campanha entre a verificação e a gravação.
          ConditionExpression: "attribute_exists(userId)",
          ExpressionAttributeValues: {
            ":characterId": characterId,
            ":characterName": characterName,
          },
          ReturnValues: "ALL_NEW",
        }),
      );

      return toMember(Attributes as Item);
    },

    async remove(campaignId: string, userId: string): Promise<void> {
      await db.doc.send(new DeleteCommand({ TableName, Key: { campaignId, userId } }));
    },
  };
}

export type MemberRepository = ReturnType<typeof createMemberRepository>;
