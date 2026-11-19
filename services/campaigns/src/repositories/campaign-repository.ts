// Tabela de campanhas (chave `campaignId`) e tabela de códigos de entrada (chave `joinCode`).
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { Campaign } from "../domain/campaign.js";
import { JoinCodeTaken } from "../domain/errors.js";
import type { Member } from "../domain/member.js";
import type { OutboxMessage } from "../messaging/outgoing.js";
import { outboxPut } from "./outbox-repository.js";

type Item = Record<string, unknown>;

const toCampaign = (item: Item): Campaign => ({
  campaignId: item.campaignId as string,
  name: item.name as string,
  ownerId: item.ownerId as string,
  ownerName: item.ownerName as string,
  joinCode: item.joinCode as string,
  createdAt: item.createdAt as string,
});

/** O BatchGet aceita no máximo 100 chaves por chamada. */
const BATCH_SIZE = 100;

export function createCampaignRepository(db: Db) {
  const TableName = db.tables.campaigns;

  async function find(campaignId: string): Promise<Campaign | null> {
    const { Item } = await db.doc.send(new GetCommand({ TableName, Key: { campaignId } }));

    return Item ? toCampaign(Item) : null;
  }

  return {
    /**
     * Grava a campanha, reserva o código de entrada, registra o dono como participante e grava os
     * eventos na outbox, tudo numa transação. Lança JoinCodeTaken se o código já é de outra campanha.
     */
    async create(campaign: Campaign, owner: Member, events: OutboxMessage[]): Promise<void> {
      try {
        // A ordem importa: o índice de cada operação identifica a condição que falhou.
        await db.doc.send(
          new TransactWriteCommand({
            TransactItems: [
              // 0: a campanha
              {
                Put: {
                  TableName,
                  Item: campaign,
                  ConditionExpression: "attribute_not_exists(campaignId)",
                },
              },
              // 1: o código, só se ainda estiver livre
              {
                Put: {
                  TableName: db.tables.joinCodes,
                  Item: { joinCode: campaign.joinCode, campaignId: campaign.campaignId },
                  ConditionExpression: "attribute_not_exists(joinCode)",
                },
              },
              // 2: o dono como participante
              {
                Put: {
                  TableName: db.tables.members,
                  Item: { campaignId: campaign.campaignId, ...owner },
                },
              },
              // 3 em diante: os eventos
              ...events.map((event, position) => outboxPut(db, event, position)),
            ],
          }),
        );
      } catch (error) {
        if (
          error instanceof TransactionCanceledException &&
          error.CancellationReasons?.[1]?.Code === "ConditionalCheckFailed"
        ) {
          throw new JoinCodeTaken(campaign.joinCode);
        }

        throw error;
      }
    },

    find,

    async findByJoinCode(joinCode: string): Promise<Campaign | null> {
      const { Item } = await db.doc.send(
        new GetCommand({ TableName: db.tables.joinCodes, Key: { joinCode } }),
      );

      return Item ? find(Item.campaignId as string) : null;
    },

    /** As campanhas com esses ids; as que não existem ficam de fora. Sem ordem garantida. */
    async findMany(campaignIds: string[]): Promise<Campaign[]> {
      const found: Campaign[] = [];

      for (let start = 0; start < campaignIds.length; start += BATCH_SIZE) {
        let keys: Item[] | undefined = campaignIds
          .slice(start, start + BATCH_SIZE)
          .map((campaignId) => ({ campaignId }));

        // O DynamoDB pode devolver parte das chaves como não processadas; pede de novo até acabar.
        while (keys?.length) {
          const page: BatchGetCommandOutput = await db.doc.send(
            new BatchGetCommand({ RequestItems: { [TableName]: { Keys: keys } } }),
          );

          found.push(...(page.Responses?.[TableName] ?? []).map(toCampaign));
          keys = page.UnprocessedKeys?.[TableName]?.Keys;
        }
      }

      return found;
    },
  };
}

export type CampaignRepository = ReturnType<typeof createCampaignRepository>;
