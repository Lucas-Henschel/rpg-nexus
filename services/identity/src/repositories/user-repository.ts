import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import { UserAlreadyExists } from "../domain/errors.js";
import type { User } from "../domain/user.js";

export interface UserRepository {
  create(user: User): Promise<void>;
  findById(userId: string): Promise<User | null>;
  findByIdentifier(identifier: string): Promise<User | null>;
}

const identityKey = (type: "email" | "username", value: string) => `${type}#${value}`;

export function createUserRepository(db: Db): UserRepository {
  return {
    async create(user) {
      try {
        await db.doc.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: db.tables.users,
                  Item: user,
                  ConditionExpression: "attribute_not_exists(userId)",
                },
              },
              {
                Put: {
                  TableName: db.tables.identities,
                  Item: { identityKey: identityKey("email", user.normalizedEmail), userId: user.userId },
                  ConditionExpression: "attribute_not_exists(identityKey)",
                },
              },
              {
                Put: {
                  TableName: db.tables.identities,
                  Item: { identityKey: identityKey("username", user.normalizedUsername), userId: user.userId },
                  ConditionExpression: "attribute_not_exists(identityKey)",
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "TransactionCanceledException") throw new UserAlreadyExists();
        throw error;
      }
    },

    async findById(userId) {
      const { Item } = await db.doc.send(new GetCommand({ TableName: db.tables.users, Key: { userId } }));
      return (Item as User | undefined) ?? null;
    },

    async findByIdentifier(identifier) {
      const normalized = identifier.trim().toLowerCase();
      const type = normalized.includes("@") ? "email" : "username";
      const result = await db.doc.send(
        new GetCommand({ TableName: db.tables.identities, Key: { identityKey: identityKey(type, normalized) } }),
      );
      const userId = result.Item?.userId as string | undefined;
      if (!userId) return null;

      const { Item } = await db.doc.send(new GetCommand({ TableName: db.tables.users, Key: { userId } }));
      return (Item as User | undefined) ?? null;
    },
  };
}
