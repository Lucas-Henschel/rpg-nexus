// Lê o ItemAcquired que chega do RabbitMQ e confere com os JSON Schemas de contracts/.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { Acquisition } from "../domain/acquisition.js";

/** Mensagem que nunca vai ser aceita, por mais que se tente de novo: vai direto para a DLQ. */
export class PoisonMessage extends Error {}

interface ItemAcquiredEvent {
  messageId: string;
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

export function createItemAcquiredParser(contractsDir: string): (body: Buffer) => Acquisition {
  const readSchema = (file: string) => JSON.parse(readFileSync(resolve(contractsDir, file), "utf8"));

  const ajv = new Ajv2020({ allErrors: true });

  addFormats(ajv);
  // Documenta exchange, routing key e consumidores; não valida nada na mensagem.
  ajv.addKeyword("x-routing");
  ajv.addSchema(readSchema("envelope.schema.json"));

  const validate = ajv.compile<ItemAcquiredEvent>(readSchema("events/item-acquired.v1.schema.json"));

  return (body) => {
    let event: unknown;

    try {
      event = JSON.parse(body.toString("utf8"));
    } catch {
      throw new PoisonMessage("o corpo não é JSON");
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
