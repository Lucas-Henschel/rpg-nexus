import { createHash } from "node:crypto";
import { BatchWriteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";

export interface LoginAttemptRepository {
  lockedFor(identifier: string, nowSeconds: number): Promise<number>;
  recordFailure(identifier: string, nowSeconds: number): Promise<number>;
  clear(identifier: string, nowSeconds: number): Promise<void>;
}

export interface LoginAttemptPolicy {
  maxAttempts: number;
  windowSeconds: number;
  lockSeconds: number;
}

const digest = (identifier: string) =>
  createHash("sha256").update(identifier.trim().toLowerCase()).digest("base64url");

const lockKey = (identifier: string) => `lock#${digest(identifier)}`;
const attemptKey = (identifier: string, now: number, window: number) =>
  `attempt#${digest(identifier)}#${Math.floor(now / window)}`;

export function createLoginAttemptRepository(db: Db, policy: LoginAttemptPolicy): LoginAttemptRepository {
  return {
    async lockedFor(identifier, nowSeconds) {
      const { Item } = await db.doc.send(new GetCommand({
        TableName: db.tables.loginAttempts,
        Key: { throttleKey: lockKey(identifier) },
        ConsistentRead: true,
      }));
      const lockedUntil = Number(Item?.lockedUntil ?? 0);
      return Math.max(lockedUntil - nowSeconds, 0);
    },

    async recordFailure(identifier, nowSeconds) {
      const key = attemptKey(identifier, nowSeconds, policy.windowSeconds);
      const { Attributes } = await db.doc.send(new UpdateCommand({
        TableName: db.tables.loginAttempts,
        Key: { throttleKey: key },
        UpdateExpression: "ADD attempts :one SET expiresAt = :expiresAt",
        ExpressionAttributeValues: {
          ":one": 1,
          ":expiresAt": nowSeconds + policy.windowSeconds * 2,
        },
        ReturnValues: "ALL_NEW",
      }));
      if (Number(Attributes?.attempts ?? 0) < policy.maxAttempts) return 0;

      const lockedUntil = nowSeconds + policy.lockSeconds;
      await db.doc.send(new PutCommand({
        TableName: db.tables.loginAttempts,
        Item: { throttleKey: lockKey(identifier), lockedUntil, expiresAt: lockedUntil },
      }));
      return policy.lockSeconds;
    },

    async clear(identifier, nowSeconds) {
      await db.doc.send(new BatchWriteCommand({
        RequestItems: {
          [db.tables.loginAttempts]: [
            { DeleteRequest: { Key: { throttleKey: lockKey(identifier) } } },
            {
              DeleteRequest: {
                Key: { throttleKey: attemptKey(identifier, nowSeconds, policy.windowSeconds) },
              },
            },
          ],
        },
      }));
    },
  };
}
