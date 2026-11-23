import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { HistoryEvent, HistoryEventType, HistoryReason } from "../domain/history.js";

export class PoisonMessage extends Error {}

interface EventEnvelope {
  messageId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

const addFormats = addFormatsModule.default;

export function createHistoryEventParser(contractsDir: string): (body: Buffer) => HistoryEvent {
  const readSchema = (file: string) => JSON.parse(readFileSync(resolve(contractsDir, file), "utf8"));
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  ajv.addKeyword("x-routing");
  ajv.addSchema(readSchema("envelope.schema.json"));

  const definitions: Array<[string, string, HistoryEventType]> = [
    ["rpg.campaign.created.v1", "campaign-created.v1.schema.json", "CAMPAIGN_CREATED"],
    ["rpg.campaign.member.joined.v1", "campaign-member-joined.v1.schema.json", "MEMBER_JOINED"],
    ["rpg.campaign.member.removed.v1", "campaign-member-removed.v1.schema.json", "MEMBER_REMOVED"],
    ["rpg.shop.item-purchased.v1", "shop-item-purchased.v1.schema.json", "SHOP_ITEM_PURCHASED"],
    ["rpg.shop.item-purchased.v2", "shop-item-purchased.v2.schema.json", "SHOP_ITEM_PURCHASED"],
    ["rpg.item.acquired.v1", "item-acquired.v1.schema.json", "ITEM_ACQUIRED"],
    ["rpg.acquisition.cancelled.v1", "acquisition-cancelled.v1.schema.json", "ACQUISITION_CANCELLED"],
  ];
  const validators = new Map(definitions.map(([wireType, file, type]) => [
    wireType,
    { type, validate: ajv.compile<EventEnvelope>(readSchema(`events/${file}`)) },
  ]));

  return (body) => {
    let event: unknown;
    try {
      event = JSON.parse(body.toString("utf8"));
    } catch {
      throw new PoisonMessage("o corpo não é JSON");
    }

    if (!event || typeof event !== "object" || !("type" in event)) {
      throw new PoisonMessage("evento sem tipo");
    }

    const wireType = String((event as { type?: unknown }).type);
    const definition = validators.get(wireType);
    if (!definition) throw new PoisonMessage(`tipo de evento não suportado: ${wireType}`);
    if (!definition.validate(event)) throw new PoisonMessage(ajv.errorsText(definition.validate.errors));

    const valid = event as EventEnvelope;
    const payload = valid.payload;
    const common = {
      messageId: valid.messageId,
      occurredAt: valid.occurredAt,
      type: definition.type,
      campaignId: payload.campaignId as string,
    };

    switch (definition.type) {
      case "CAMPAIGN_CREATED":
        return { ...common, campaignName: payload.name as string, userId: payload.ownerId as string, ownerName: payload.ownerName as string };
      case "MEMBER_JOINED":
        return { ...common, userId: payload.userId as string, username: payload.username as string, role: payload.role as "OWNER" | "PLAYER" };
      case "MEMBER_REMOVED":
        return { ...common, userId: payload.userId as string, removedBy: payload.removedBy as string, reason: payload.reason as HistoryReason };
      case "SHOP_ITEM_PURCHASED":
        return { ...common, operationId: payload.operationId as string, userId: payload.userId as string, characterId: payload.characterId as string, itemId: payload.itemId as string, quantity: payload.quantity as number, amount: (wireType.endsWith(".v2") ? payload.unitPrice : payload.amount) as number };
      case "ITEM_ACQUIRED":
        return { ...common, operationId: payload.operationId as string, characterId: payload.characterId as string, itemId: payload.itemId as string, itemName: payload.itemName as string | undefined, quantity: payload.quantity as number };
      case "ACQUISITION_CANCELLED":
        return { ...common, operationId: payload.operationId as string, userId: payload.userId as string | undefined, characterId: payload.characterId as string, itemId: payload.itemId as string, itemName: payload.itemName as string | undefined, quantity: payload.quantity as number, reason: payload.reason as HistoryReason, detail: payload.detail as string | undefined };
    }
  };
}
