// Lê as aquisições que chegam do RabbitMQ e confere com os JSON Schemas de contracts/. O S3 publica
// ItemAcquired e ShopItemPurchased para a mesma compra, com o mesmo operationId: as duas viram uma
// Acquisition e o repositório conta a operação uma vez só.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { Acquisition } from "../domain/acquisition.js";

/** Mensagem que nunca vai ser aceita, por mais que se tente de novo: vai direto para a DLQ. */
export class PoisonMessage extends Error {}

interface AcquisitionEvent {
  messageId: string;
  type: string;
  occurredAt: string;
  payload: {
    operationId: string;
    campaignId: string;
    characterId: string;
    itemId: string;
    quantity: number;
    itemName?: string;
  };
}

// ajv-formats é CommonJS; no ESM a função vem dentro de `default`.
const addFormats = addFormatsModule.default;

/** Esquema de cada tipo aceito na fila de atividade. */
const SCHEMAS: Record<string, string> = {
  "rpg.item.acquired.v1": "events/item-acquired.v1.schema.json",
  "rpg.shop.item-purchased.v1": "events/shop-item-purchased.v1.schema.json",
  "rpg.shop.item-purchased.v2": "events/shop-item-purchased.v2.schema.json",
};

export function createAcquisitionParser(contractsDir: string): (body: Buffer) => Acquisition {
  const readSchema = (file: string) =>
    JSON.parse(readFileSync(resolve(contractsDir, file), "utf8"));

  const ajv = new Ajv2020({ allErrors: true });

  addFormats(ajv);
  // Documenta exchange, routing key e consumidores; não valida nada na mensagem.
  ajv.addKeyword("x-routing");
  ajv.addSchema(readSchema("envelope.schema.json"));

  const validators = new Map(
    Object.entries(SCHEMAS).map(([type, file]) => [
      type,
      ajv.compile<AcquisitionEvent>(readSchema(file)),
    ]),
  );

  return (body) => {
    let event: unknown;

    try {
      event = JSON.parse(body.toString("utf8"));
    } catch {
      throw new PoisonMessage("o corpo não é JSON");
    }

    const type = (event as { type?: unknown } | null)?.type;
    const validate = typeof type === "string" ? validators.get(type) : undefined;

    if (!validate) {
      throw new PoisonMessage(`tipo de evento não aceito: ${String(type)}`);
    }

    if (!validate(event)) {
      throw new PoisonMessage(ajv.errorsText(validate.errors));
    }

    const { messageId, occurredAt, payload } = event;

    return {
      messageId,
      occurredAt,
      operationId: payload.operationId,
      campaignId: payload.campaignId,
      characterId: payload.characterId,
      itemId: payload.itemId,
      quantity: payload.quantity,
      itemName: payload.itemName,
    };
  };
}
