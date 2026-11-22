// Validador externo simulado da Saga de compra (parte do S4). Roda num contêiner próprio (identity-validator),
// separado do S4: se ele ficar lento ou cair, o login e o histórico continuam funcionando.
// Usa a mesma imagem do S4 só para reaproveitar o código de mensageria; não toca nas tabelas de identidade.
import { resolve } from "node:path";
import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import Fastify from "fastify";
import { loadEnv } from "./config.js";
import { createDb } from "./db/client.js";
import { healthRoutes } from "./http/health.js";
import { startConsumer } from "./messaging/consumer.js";
import { createValidationRequestParser, handleValidationDelivery } from "./messaging/validation.js";
import { startValidationOutbox } from "./messaging/validation-outbox.js";
import { createValidationRepository } from "./repositories/validation-repository.js";
import { startTracing, stopTracing } from "./tracing/setup.js";

const env = loadEnv();
if (env.TRACING_ENABLED) startTracing(env.SERVICE_NAME);
const db = createDb(env);
const repository = createValidationRepository(db, env.HISTORY_INBOX_TTL_DAYS);
const parser = createValidationRequestParser(resolve(env.CONTRACTS_DIR));

const app = Fastify({ logger: true });

const consumer = startConsumer({
  url: env.RABBITMQ_URL,
  queue: env.VALIDATION_QUEUE,
  retryQueue: env.VALIDATION_RETRY_QUEUE,
  prefetch: env.RABBITMQ_PREFETCH,
  handle: (body, headers) => handleValidationDelivery({
    parse: parser,
    repository,
    policy: { maxRetries: env.MAX_RETRIES, baseDelayMs: env.RETRY_BASE_DELAY_MS, maxDelayMs: env.RETRY_MAX_DELAY_MS },
    failureRate: env.VALIDATION_FAILURE_RATE,
    minDelayMs: env.VALIDATION_MIN_DELAY_MS,
    maxDelayMs: env.VALIDATION_MAX_DELAY_MS,
  }, body, headers),
  log: app.log,
  consumerName: "validation",
});
const outbox = startValidationOutbox({
  url: env.RABBITMQ_URL,
  exchange: env.RABBITMQ_EXCHANGE,
  intervalMs: env.VALIDATION_OUTBOX_INTERVAL_MS,
  repository,
  log: app.log,
});

app.register(healthRoutes({
  pingDatabase: async () => {
    await db.doc.send(new DescribeTableCommand({ TableName: db.tables.validationInbox }));
  },
  isBusConnected: () => consumer.isConnected() && outbox.isConnected(),
}));

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutdown");
  await Promise.all([consumer.close(), outbox.close()]);
  await app.close();
  await stopTracing();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
