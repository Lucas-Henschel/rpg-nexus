// Publica um ItemAcquired na exchange RABBITMQ_EXCHANGE, como o S3 faria. Serve para testar o consumidor.
//
//   node dist/scripts/publish-item-acquired.js --campaign c1 --character ch1 --item sword
//
// Repetir com o mesmo --message-id (ou o mesmo --operation) mostra que a aquisição conta uma vez só.
// Com TRACING_ENABLED=true, a publicação vira o primeiro span do trace no Jaeger (no lugar do S3).
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import amqp from "amqplib";
import { loadEnv } from "../config.js";
import { startTracing, stopTracing } from "../tracing/setup.js";
import { traceHeaders, withProducerSpan } from "../tracing/spans.js";

const { values } = parseArgs({
  options: {
    campaign: { type: "string" },
    character: { type: "string" },
    item: { type: "string" },
    quantity: { type: "string", default: "1" },
    "item-name": { type: "string" },
    operation: { type: "string" },
    "message-id": { type: "string" },
  },
});

if (!values.campaign || !values.character || !values.item) {
  console.error(
    "uso: publish-item-acquired --campaign <id> --character <id> --item <id> [--quantity 1] [--item-name <nome>] [--operation <id>] [--message-id <uuid>]",
  );
  process.exit(1);
}

const operationId = values.operation ?? randomUUID();
const event = {
  messageId: values["message-id"] ?? randomUUID(),
  correlationId: operationId,
  type: "rpg.item.acquired.v1",
  version: 1,
  occurredAt: new Date().toISOString(),
  payload: {
    operationId,
    campaignId: values.campaign,
    characterId: values.character,
    itemId: values.item,
    quantity: Number(values.quantity),
    itemName: values["item-name"],
  },
};

const env = loadEnv();

if (env.TRACING_ENABLED) {
  startTracing("publish-item-acquired");
}

const connection = await amqp.connect(env.RABBITMQ_URL);
const channel = await connection.createConfirmChannel();

// A routing key faz parte do contrato do evento (x-routing em contracts/).
const routingKey = "item.acquired.v1";

await withProducerSpan(routingKey, { "messaging.message.id": event.messageId }, async () => {
  channel.publish(env.RABBITMQ_EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: "application/json",
    messageId: event.messageId,
    headers: traceHeaders(),
  });
  await channel.waitForConfirms();
});
await connection.close();
await stopTracing();

console.log(JSON.stringify(event, null, 2));
