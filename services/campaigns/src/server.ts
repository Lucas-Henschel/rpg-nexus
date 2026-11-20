import { resolve } from "node:path";
import { loadEnv } from "./config.js";
import { createDb, pingDatabase } from "./db/client.js";
import { buildApp } from "./http/app.js";
import { connectRabbit } from "./messaging/connection.js";
import { startConsumer } from "./messaging/consumer.js";
import { createItemAcquiredParser } from "./messaging/events.js";
import { createTemplateCatalog } from "./integrations/templates.js";
import { handleDelivery } from "./messaging/handle-delivery.js";
import { createOutboxRelay } from "./messaging/outbox-relay.js";
import { createPublisher } from "./messaging/publisher.js";
import { createAcquisitionRepository } from "./repositories/acquisition-repository.js";
import { createActivityRepository } from "./repositories/activity-repository.js";
import { createCampaignRepository } from "./repositories/campaign-repository.js";
import { createMemberRepository } from "./repositories/member-repository.js";
import { createOutboxRepository } from "./repositories/outbox-repository.js";
import { createCampaignService } from "./services/campaigns.js";
import { startTracing, stopTracing } from "./tracing/setup.js";

const env = loadEnv();

// Antes de montar o app e os clientes, para o tracing enxergar tudo desde o início.
if (env.TRACING_ENABLED) {
  startTracing(env.SERVICE_NAME);
}

// As tabelas já existem: quem cria é o Terraform (infra/terraform), antes de o serviço subir.
const db = createDb(env);

const campaigns = createCampaignService(
  {
    campaigns: createCampaignRepository(db),
    members: createMemberRepository(db),
    activity: createActivityRepository(db),
    acquisitions: createAcquisitionRepository(db, env.INBOX_TTL_DAYS),
  },
  {
    templates: createTemplateCatalog({
      baseUrl: env.CHARACTERS_URL,
      timeoutMs: env.CHARACTERS_TIMEOUT_MS,
    }),
  },
);

const app = buildApp({
  env,
  campaigns,
  pingDatabase: () => pingDatabase(db),
  isBusConnected: () => connection.isConnected(),
});

const delivery = {
  parse: createItemAcquiredParser(resolve(env.CONTRACTS_DIR)),
  campaigns,
  policy: {
    maxRetries: env.MAX_RETRIES,
    baseDelayMs: env.RETRY_BASE_DELAY_MS,
    maxDelayMs: env.RETRY_MAX_DELAY_MS,
  },
};

const connection = connectRabbit(env.RABBITMQ_URL, app.log);

const consumer = startConsumer({
  connection,
  queue: env.RABBITMQ_QUEUE,
  retryQueue: env.RABBITMQ_RETRY_QUEUE,
  prefetch: env.RABBITMQ_PREFETCH,
  handle: (body, headers) => handleDelivery(delivery, body, headers),
  log: app.log,
});

// Os eventos gravados na outbox junto com cada mudança saem por aqui.
const publisherChannel = connection.createChannel({ confirm: true });

publisherChannel.on("error", (err) => app.log.error({ err }, "rabbitmq.channel_error"));

const relay = createOutboxRelay({
  outbox: createOutboxRepository(db, env.OUTBOX_TTL_DAYS),
  publish: createPublisher(publisherChannel, env.RABBITMQ_EXCHANGE),
  isConnected: () => connection.isConnected(),
  batchSize: env.OUTBOX_BATCH_SIZE,
  leaseMs: env.OUTBOX_LEASE_MS,
  intervalMs: env.OUTBOX_POLL_MS,
  log: app.log,
});

relay.start();

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutdown");
  await relay.stop();
  await consumer.close();
  await publisherChannel.close();
  await connection.close();
  await app.close();
  await stopTracing();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
