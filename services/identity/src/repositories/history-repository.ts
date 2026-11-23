import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { HistoryEntry, HistoryEvent, HistoryRecordResult } from "../domain/history.js";
import { InvalidHistoryCursor } from "../domain/errors.js";

type Item = Record<string, unknown>;

function toEntry(item: Item): HistoryEntry {
  const optional = <T>(key: string) => item[key] as T | undefined;
  return {
    type: item.type as HistoryEntry["type"],
    campaignId: item.campaignId as string,
    occurredAt: item.occurredAt as string,
    recordedAt: item.recordedAt as string,
    operationId: optional("operationId"),
    userId: optional("userId"),
    username: optional("username"),
    role: optional("role"),
    campaignName: optional("campaignName"),
    ownerName: optional("ownerName"),
    removedBy: optional("removedBy"),
    characterId: optional("characterId"),
    itemId: optional("itemId"),
    itemName: optional("itemName"),
    quantity: optional("quantity"),
    amount: optional("amount"),
    reason: optional("reason"),
    detail: optional("detail"),
  };
}

export function createHistoryRepository(db: Db, inboxTtlDays: number) {
  return {
    async record(event: HistoryEvent, now: string): Promise<HistoryRecordResult> {
      const expiresAt = Math.floor(Date.parse(now) / 1000) + inboxTtlDays * 24 * 60 * 60;
      const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
        {
          Put: {
            TableName: db.tables.historyInbox,
            Item: { messageId: event.messageId, expiresAt },
            ConditionExpression: "attribute_not_exists(messageId)",
          },
        },
        {
          Put: {
            TableName: db.tables.history,
            Item: {
              ...event,
              historyKey: `${event.occurredAt}#${event.messageId}`,
              recordedAt: now,
            },
          },
        },
      ];

      if ((event.type === "CAMPAIGN_CREATED" || event.type === "MEMBER_JOINED") && event.userId) {
        items.push({
          Put: {
            TableName: db.tables.historyMemberships,
            Item: {
              campaignId: event.campaignId,
              userId: event.userId,
              role: event.type === "CAMPAIGN_CREATED" ? "OWNER" : event.role,
              updatedAt: event.occurredAt,
            },
          },
        });
      } else if (event.type === "MEMBER_REMOVED" && event.userId) {
        items.push({
          Delete: {
            TableName: db.tables.historyMemberships,
            Key: { campaignId: event.campaignId, userId: event.userId },
          },
        });
      }

      try {
        await db.doc.send(new TransactWriteCommand({ TransactItems: items }));
      } catch (error) {
        if (
          error instanceof TransactionCanceledException &&
          error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed"
        ) {
          return "duplicate";
        }
        throw error;
      }

      return "applied";
    },

    async isMember(campaignId: string, userId: string): Promise<boolean> {
      const { Item } = await db.doc.send(new GetCommand({
        TableName: db.tables.historyMemberships,
        Key: { campaignId, userId },
        ConsistentRead: true,
      }));
      return Item !== undefined;
    },

    async list(campaignId: string, limit: number): Promise<HistoryEntry[]> {
      const { Items = [] } = await db.doc.send(new QueryCommand({
        TableName: db.tables.history,
        KeyConditionExpression: "campaignId = :campaignId",
        ExpressionAttributeValues: { ":campaignId": campaignId },
        ScanIndexForward: false,
        Limit: limit,
      }));

      return Items.map(toEntry);
    },

    async listPage(campaignId: string, limit: number, cursor?: string): Promise<{ items: HistoryEntry[]; nextCursor: string | null }> {
      let start: { campaignId: string; historyKey: string } | undefined;
      if (cursor) {
        try {
          start = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        } catch {
          throw new InvalidHistoryCursor();
        }
      }
      if (cursor && (!start || start.campaignId !== campaignId || typeof start.historyKey !== "string")) {
        throw new InvalidHistoryCursor();
      }
      const { Items = [], LastEvaluatedKey } = await db.doc.send(new QueryCommand({
        TableName: db.tables.history,
        KeyConditionExpression: "campaignId = :campaignId",
        ExpressionAttributeValues: { ":campaignId": campaignId },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: start,
      }));
      return {
        items: Items.map(toEntry),
        nextCursor: LastEvaluatedKey ? Buffer.from(JSON.stringify(LastEvaluatedKey)).toString("base64url") : null,
      };
    },
  };
}

export type HistoryRepository = ReturnType<typeof createHistoryRepository>;
