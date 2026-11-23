import amqp from "amqplib";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const found = args.find((value) => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const amqpUrl = process.env.RABBITMQ_URL ?? "amqp://dev:dev@localhost:5672/";
const managementUrl = (process.env.RABBITMQ_MANAGEMENT_URL ?? "http://localhost:15672").replace(/\/$/, "");
const sourceQueue = option("source", "actions.history.v1.dlq");
const targetQueue = option("target", "actions.history.v1");
const count = Number(option("count", "100"));
const selectedTypes = new Set(option("types", "").split(",").map((value) => value.trim()).filter(Boolean));

const eventSchemas = new Map([
  ["rpg.campaign.created.v1", "events/campaign-created.v1.schema.json"],
  ["rpg.campaign.member.joined.v1", "events/campaign-member-joined.v1.schema.json"],
  ["rpg.campaign.member.removed.v1", "events/campaign-member-removed.v1.schema.json"],
  ["rpg.shop.item-purchased.v1", "events/shop-item-purchased.v1.schema.json"],
  ["rpg.shop.item-purchased.v2", "events/shop-item-purchased.v2.schema.json"],
  ["rpg.item.acquired.v1", "events/item-acquired.v1.schema.json"],
  ["rpg.acquisition.cancelled.v1", "events/acquisition-cancelled.v1.schema.json"],
]);
const addFormats = addFormatsModule.default ?? addFormatsModule;
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
ajv.addKeyword("x-routing");
const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts");
ajv.addSchema(JSON.parse(readFileSync(resolve(contractsDir, "envelope.schema.json"), "utf8")));
const validators = new Map([...eventSchemas].map(([type, file]) => [
  type,
  ajv.compile(JSON.parse(readFileSync(resolve(contractsDir, file), "utf8"))),
]));

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return "envelope ausente";
  const validate = validators.get(envelope.type);
  if (!validate) return "tipo não suportado pelo histórico";
  return validate(envelope) ? null : ajv.errorsText(validate.errors);
}
function help() {
  console.log("Uso:\n  npm run dlq -- inspect -- [--count=100]\n  npm run dlq -- replay -- --types=rpg.campaign.created.v1,rpg.campaign.member.joined.v1\n\nO replay exige --types. Mensagens inválidas ou não selecionadas permanecem na DLQ.");
}

function credentials() {
  const parsed = new URL(amqpUrl);
  return { user: decodeURIComponent(parsed.username || "guest"), password: decodeURIComponent(parsed.password || "guest") };
}

async function inspect() {
  const auth = Buffer.from(`${credentials().user}:${credentials().password}`).toString("base64");
  const response = await fetch(`${managementUrl}/api/queues/%2F/${encodeURIComponent(sourceQueue)}/get`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ count, ackmode: "ack_requeue_true", encoding: "auto", truncate: 100000 }),
  });
  if (!response.ok) throw new Error(`RabbitMQ Management respondeu ${response.status}: ${await response.text()}`);
  const messages = await response.json();
  const rows = messages.map((message, index) => {
    let envelope; let problem;
    try {
      envelope = JSON.parse(Buffer.from(message.payload, message.payload_encoding === "base64" ? "base64" : "utf8").toString("utf8"));
      problem = validateEnvelope(envelope);
    } catch { problem = "corpo não é JSON"; }
    return { index: index + 1, messageId: envelope?.messageId ?? "?", type: envelope?.type ?? "?", valid: !problem, problem: problem ?? "" };
  });
  console.table(rows);
  console.log(`${rows.length} mensagem(ns) inspecionada(s); nenhuma foi removida.`);
}

async function replay() {
  if (!selectedTypes.size) throw new Error("replay exige --types com pelo menos um tipo explícito");
  for (const type of selectedTypes) if (!validators.has(type)) throw new Error(`tipo não permitido: ${type}`);
  const connection = await amqp.connect(amqpUrl);
  const channel = await connection.createConfirmChannel();
  const queue = await channel.checkQueue(sourceQueue);
  const limit = Math.min(count, queue.messageCount);
  const deliveries = [];
  const settled = new Set();
  try {
    for (let index = 0; index < limit; index += 1) {
      const message = await channel.get(sourceQueue, { noAck: false });
      if (!message) break;
      deliveries.push(message);
    }
    let replayed = 0;
    for (const message of deliveries) {
      let envelope; let problem;
      try { envelope = JSON.parse(message.content.toString("utf8")); problem = validateEnvelope(envelope); }
      catch { problem = "corpo não é JSON"; }
      if (!problem && selectedTypes.has(envelope.type)) {
        channel.sendToQueue(targetQueue, message.content, {
          persistent: true, contentType: message.properties.contentType ?? "application/json",
          messageId: envelope.messageId, correlationId: envelope.correlationId, type: envelope.type,
          headers: { "x-dlq-replayed-at": new Date().toISOString(), "x-dlq-source": sourceQueue },
        });
        await channel.waitForConfirms();
        channel.ack(message);
        settled.add(message);
        replayed += 1;
      } else {
        channel.nack(message, false, true);
        settled.add(message);
      }
    }
    console.log(`${replayed} mensagem(ns) válida(s) reenviada(s) para ${targetQueue}.`);
    console.log(`${deliveries.length - replayed} mensagem(ns) preservada(s) em ${sourceQueue}.`);
  } catch (error) {
    for (const message of deliveries) {
      if (!settled.has(message)) { try { channel.nack(message, false, true); } catch {} }
    }
    throw error;
  } finally {
    await channel.close();
    await connection.close();
  }
}

if (!command || command === "help" || command === "--help") help();
else if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("--count deve ser inteiro entre 1 e 1000");
else if (command === "inspect") await inspect();
else if (command === "replay") await replay();
else throw new Error(`comando desconhecido: ${command}`);
