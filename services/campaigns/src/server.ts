import { resolve } from "node:path";
import { buildApp } from "./http/app.js";
import { createRepository } from "./db/repository.js";
import { loadEnv } from "./config.js";
import { createDocumentClient } from "./db/client.js";
import { tablesFromEnv } from "./db/tables.js";
import { startConsumer } from "./messaging/consumer.js";
import { createItemAcquiredParser } from "./messaging/events.js";
import { handleDelivery } from "./messaging/handle-delivery.js";
import { createCampaignService } from "./services/campaigns.js";

const env = loadEnv();
// As tabelas já existem: quem cria é o script create-tables (contêiner campaigns-init).
const repository = createRepository(createDocumentClient(env), tablesFromEnv(env), env.INBOX_TTL_DAYS);
const campaigns = createCampaignService(repository);

const app = buildApp({
  env,
  campaigns,
  pingDatabase: () => repository.ping(),
  isBusConnected: () => consumer.isConnected(),
});

const delivery = {
  parse: createItemAcquiredParser(resolve(env.CONTRACTS_DIR)),
  campaigns,
  policy: { maxRetries: env.MAX_RETRIES, baseDelayMs: env.RETRY_BASE_DELAY_MS, maxDelayMs: env.RETRY_MAX_DELAY_MS },
};

const consumer = startConsumer({
  url: env.RABBITMQ_URL,
  queue: env.RABBITMQ_QUEUE,
  retryQueue: env.RABBITMQ_RETRY_QUEUE,
  prefetch: env.RABBITMQ_PREFETCH,
  handle: (body, headers) => handleDelivery(delivery, body, headers),
  log: app.log,
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutdown");
  await consumer.close();
  await app.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
