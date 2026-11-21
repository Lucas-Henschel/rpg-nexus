import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Db } from "../db/client.js";
import type { AuditEvent, AuditRepository } from "../domain/audit.js";

export function createAuditRepository(db: Db): AuditRepository {
  return {
    async record(event: AuditEvent) {
      await db.doc.send(new PutCommand({
        TableName: db.tables.audit,
        Item: event,
        ConditionExpression: "attribute_not_exists(auditId)",
      }));
    },
  };
}
