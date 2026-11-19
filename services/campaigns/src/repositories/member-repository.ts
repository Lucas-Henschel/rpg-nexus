// Tabela de participantes: um item por usuário em cada campanha, com chave `campaignId` + `userId`.
// O índice `byUser` (userId + campaignId) responde "de quais campanhas este usuário participa".
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { Member, Role } from "../domain/member.js";
import type { OutboxMessage } from "../messaging/outgoing.js";
import { outboxPut } from "./outbox-repository.js";

type Item = Record<string, unknown>;

export const MEMBERS_BY_USER_INDEX = "byUser";

/** A condição da primeira operação da transação falhou. */
const firstConditionFailed = (error: unknown) =>
  error instanceof TransactionCanceledException &&
  error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed";

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

  /**
   * Grava o participante e o evento da entrada, se ele ainda não participa. Se já participa, não grava
   * nada e devolve o que estava gravado.
   */
  async function add(
    campaignId: string,
    member: Member,
    joined: OutboxMessage,
  ): Promise<{ member: Member; created: boolean }> {
    try {
      await db.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName,
                Item: { campaignId, ...member },
                ConditionExpression: "attribute_not_exists(userId)",
              },
            },
            outboxPut(db, joined),
          ],
        }),
      );

      return { member, created: true };
    } catch (error) {
      if (!firstConditionFailed(error)) {
        throw error;
      }

      const existing = await find(campaignId, member.userId);

      // Saiu entre a gravação e a leitura: grava de novo.
      return existing ? { member: existing, created: false } : add(campaignId, member, joined);
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

    /** Remove o participante e grava o evento da saída. Devolve false se ele já não participava. */
    async remove(campaignId: string, userId: string, removed: OutboxMessage): Promise<boolean> {
      try {
        await db.doc.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Delete: {
                  TableName,
                  Key: { campaignId, userId },
                  ConditionExpression: "attribute_exists(userId)",
                },
              },
              outboxPut(db, removed),
            ],
          }),
        );

        return true;
      } catch (error) {
        if (firstConditionFailed(error)) {
          return false;
        }

        throw error;
      }
    },
  };
}

export type MemberRepository = ReturnType<typeof createMemberRepository>;
