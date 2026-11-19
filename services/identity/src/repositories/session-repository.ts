import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import { InvalidRefreshToken } from "../domain/errors.js";
import type { Session } from "../domain/session.js";

export interface SessionRepository {
  create(session: Session): Promise<void>;
  find(sessionId: string): Promise<Session | null>;
  rotate(sessionId: string, currentHash: string, next: Pick<Session, "tokenHash" | "expiresAt" | "updatedAt">): Promise<void>;
  revoke(sessionId: string, tokenHash: string, revokedAt: string): Promise<void>;
}

export function createSessionRepository(db: Db): SessionRepository {
  return {
    async create(session) {
      await db.doc.send(
        new PutCommand({
          TableName: db.tables.sessions,
          Item: session,
          ConditionExpression: "attribute_not_exists(sessionId)",
        }),
      );
    },

    async find(sessionId) {
      const { Item } = await db.doc.send(new GetCommand({ TableName: db.tables.sessions, Key: { sessionId } }));
      return (Item as Session | undefined) ?? null;
    },

    async rotate(sessionId, currentHash, next) {
      try {
        await db.doc.send(
          new UpdateCommand({
            TableName: db.tables.sessions,
            Key: { sessionId },
            UpdateExpression: "SET tokenHash = :nextHash, expiresAt = :expiresAt, updatedAt = :updatedAt",
            ConditionExpression: "tokenHash = :currentHash AND attribute_not_exists(revokedAt)",
            ExpressionAttributeValues: {
              ":currentHash": currentHash,
              ":nextHash": next.tokenHash,
              ":expiresAt": next.expiresAt,
              ":updatedAt": next.updatedAt,
            },
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") throw new InvalidRefreshToken();
        throw error;
      }
    },

    async revoke(sessionId, tokenHash, revokedAt) {
      try {
        await db.doc.send(
          new UpdateCommand({
            TableName: db.tables.sessions,
            Key: { sessionId },
            UpdateExpression: "SET revokedAt = :revokedAt, updatedAt = :revokedAt",
            ConditionExpression: "tokenHash = :tokenHash AND attribute_not_exists(revokedAt)",
            ExpressionAttributeValues: { ":tokenHash": tokenHash, ":revokedAt": revokedAt },
          }),
        );
      } catch (error) {
        // Logout é idempotente e não revela se a sessão existia.
        if (!(error instanceof Error && error.name === "ConditionalCheckFailedException")) throw error;
      }
    },
  };
}
