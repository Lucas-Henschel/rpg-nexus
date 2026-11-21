import amqp from "amqplib";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const amqpUrl = process.env.RABBITMQ_URL ?? "amqp://dev:dev@localhost:5672/";
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const sourceQueue = `codex-dlq-test-${suffix}`;
const targetQueue = `codex-replay-test-${suffix}`;
const dlqScript = fileURLToPath(new URL("./dlq.mjs", import.meta.url));
const campaignId = randomUUID();
const ownerId = randomUUID();
const selectedId = randomUUID();
const preservedId = randomUUID();
const invalidId = "not-a-uuid";
const missingCorrelationId = randomUUID();

const message = (messageId, type, payload) => ({
  messageId,
  correlationId: payload.operationId ?? payload.campaignId ?? messageId,
  version: 1,
  type,
  occurredAt: new Date().toISOString(),
  payload,
});

function runDlq(args) {
  const result = spawnSync(process.execPath, [dlqScript, ...args], {
    encoding: "utf8",
    env: process.env,
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`dlq ${args[0]} falhou:\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

async function takeIds(channel, queue, count) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const delivery = await channel.get(queue, { noAck: false });
    if (!delivery) break;
    ids.push(delivery.properties.messageId);
    channel.ack(delivery);
  }
  return ids;
}

const connection = await amqp.connect(amqpUrl);
const channel = await connection.createConfirmChannel();
let sourceCreated = false;
let targetCreated = false;
try {
  await channel.assertQueue(sourceQueue, { durable: true, autoDelete: false });
  sourceCreated = true;
  await channel.assertQueue(targetQueue, { durable: true, autoDelete: false });
  targetCreated = true;

  const missingCorrelation = message(missingCorrelationId, "rpg.campaign.created.v1", {
    campaignId, ownerId, name: `Missing correlation ${suffix}`, ownerName: "Codex DLQ Test", createdAt: new Date().toISOString(),
  });
  delete missingCorrelation.correlationId;
  const invalidMessageId = message(invalidId, "rpg.campaign.created.v1", {
    campaignId, ownerId, name: `Invalid id ${suffix}`, ownerName: "Codex DLQ Test", createdAt: new Date().toISOString(),
  });
  const messages = [
    message(selectedId, "rpg.campaign.created.v1", { campaignId, ownerId, name: `DLQ test ${suffix}`, ownerName: "Codex DLQ Test", createdAt: new Date().toISOString() }),
    message(preservedId, "rpg.campaign.member.joined.v1", { campaignId, userId: ownerId, username: "Codex DLQ Test", role: "OWNER", joinedAt: new Date().toISOString() }),
    missingCorrelation,
    invalidMessageId,
  ];
  for (const envelope of messages) {
    channel.sendToQueue(sourceQueue, Buffer.from(JSON.stringify(envelope)), {
      persistent: false,
      contentType: "application/json",
      messageId: envelope.messageId,
      type: envelope.type,
    });
  }
  await channel.waitForConfirms();

  const inspectOutput = runDlq(["inspect", `--source=${sourceQueue}`, "--count=10"]);
  if (!inspectOutput.includes("4 mensagem(ns) inspecionada(s); nenhuma foi removida.")) {
    throw new Error(`inspect não confirmou as quatro mensagens da fila isolada:\n${inspectOutput}`);
  }
  const afterInspect = await channel.checkQueue(sourceQueue);
  if (afterInspect.messageCount !== 4) throw new Error(`inspect alterou a fila de teste: ${afterInspect.messageCount} mensagem(ns) restantes`);

  const replayOutput = runDlq([
    "replay",
    `--source=${sourceQueue}`,
    `--target=${targetQueue}`,
    "--types=rpg.campaign.created.v1",
    "--count=10",
  ]);
  if (!replayOutput.includes("1 mensagem(ns) válida(s) reenviada(s)")) {
    throw new Error(`replay não confirmou uma mensagem válida:\n${replayOutput}`);
  }
  if (!replayOutput.includes(`3 mensagem(ns) preservada(s) em ${sourceQueue}.`)) {
    throw new Error(`replay não confirmou a preservação das demais mensagens:\n${replayOutput}`);
  }

  const sourceState = await channel.checkQueue(sourceQueue);
  const targetState = await channel.checkQueue(targetQueue);
  if (sourceState.messageCount !== 3 || targetState.messageCount !== 1) {
    throw new Error(`contagens inesperadas após replay: origem=${sourceState.messageCount}, destino=${targetState.messageCount}`);
  }
  const sourceIds = await takeIds(channel, sourceQueue, 3);
  const targetIds = await takeIds(channel, targetQueue, 1);
  if (!sourceIds.includes(preservedId) || !sourceIds.includes(missingCorrelationId) || !sourceIds.includes(invalidId)) {
    throw new Error(`mensagens não selecionada/inválida não foram preservadas: ${sourceIds.join(", ")}`);
  }
  if (targetIds[0] !== selectedId) throw new Error(`mensagem errada no destino: ${targetIds.join(", ")}`);

  console.log(`DLQ test passed; temporary queues: ${sourceQueue}, ${targetQueue}.`);
  console.log(`Verified: inspect preserved 4 messages; replay moved ${selectedId}; preserved ${preservedId}, missing-correlation ${missingCorrelationId}, and invalid-id ${invalidId}.`);
} finally {
  if (sourceCreated) await channel.deleteQueue(sourceQueue);
  if (targetCreated) await channel.deleteQueue(targetQueue);
  await channel.close();
  await connection.close();
}
