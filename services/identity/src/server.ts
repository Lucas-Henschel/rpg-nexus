import { resolve } from "node:path";
import { loadEnv } from "./config.js";
import { createDb, pingDatabase } from "./db/client.js";
import { buildApp } from "./http/app.js";
import { startConsumer } from "./messaging/consumer.js";
import { createHistoryEventParser } from "./messaging/events.js";
import { handleDelivery } from "./messaging/handle-delivery.js";
import { createHistoryRepository } from "./repositories/history-repository.js";
import { createLoginAttemptRepository } from "./repositories/login-attempt-repository.js";
import { createSessionRepository } from "./repositories/session-repository.js";
import { createUserRepository } from "./repositories/user-repository.js";
import { createPasswordHasher } from "./security/passwords.js";
import { createTokenService } from "./security/tokens.js";
import { createIdentityService } from "./services/identity.js";
import { createHistoryService } from "./services/history.js";
import { createAuditRepository } from "./repositories/audit-repository.js";
import { createValidationRepository } from "./repositories/validation-repository.js";
import { createValidationRequestParser, handleValidationDelivery } from "./messaging/validation.js";
import { startValidationOutbox } from "./messaging/validation-outbox.js";

const env = loadEnv();
const db = createDb(env);
const identity = createIdentityService({
  env,
  users: createUserRepository(db),
  sessions: createSessionRepository(db),
  loginAttempts: createLoginAttemptRepository(db, {
    maxAttempts: env.LOGIN_MAX_ATTEMPTS,
    windowSeconds: env.LOGIN_ATTEMPT_WINDOW_SECONDS,
    lockSeconds: env.LOGIN_LOCK_SECONDS,
  }),
  passwords: createPasswordHasher(env),
  tokens: createTokenService(env),
  audit: createAuditRepository(db),
});
const history = createHistoryService(createHistoryRepository(db, env.HISTORY_INBOX_TTL_DAYS));
const parser = createHistoryEventParser(resolve(env.CONTRACTS_DIR));
const validationParser = createValidationRequestParser(resolve(env.CONTRACTS_DIR));
const validationRepository = createValidationRepository(db, env.HISTORY_INBOX_TTL_DAYS);
let historyConsumer: ReturnType<typeof startConsumer>;
let validationConsumer: ReturnType<typeof startConsumer>;
let validationOutbox: ReturnType<typeof startValidationOutbox>;
const app = buildApp({
  env,
  identity,
  history,
  pingDatabase: () => pingDatabase(db),
  isBusConnected: () => Boolean(
    historyConsumer?.isConnected() && validationConsumer?.isConnected() && validationOutbox?.isConnected(),
  ),
});
historyConsumer = startConsumer({
  url: env.RABBITMQ_URL,
  queue: env.RABBITMQ_QUEUE,
  retryQueue: env.RABBITMQ_RETRY_QUEUE,
  prefetch: env.RABBITMQ_PREFETCH,
  handle: (body, headers) => handleDelivery({
    parse: parser,
    history,
    policy: {
      maxRetries: env.MAX_RETRIES,
      baseDelayMs: env.RETRY_BASE_DELAY_MS,
      maxDelayMs: env.RETRY_MAX_DELAY_MS,
    },
  }, body, headers),
  log: app.log,
  consumerName: "history",
});
validationConsumer = startConsumer({
  url: env.RABBITMQ_URL,
  queue: env.VALIDATION_QUEUE,
  retryQueue: env.VALIDATION_RETRY_QUEUE,
  prefetch: env.RABBITMQ_PREFETCH,
  handle: (body, headers) => handleValidationDelivery({
    parse: validationParser,
    repository: validationRepository,
    policy: { maxRetries: env.MAX_RETRIES, baseDelayMs: env.RETRY_BASE_DELAY_MS, maxDelayMs: env.RETRY_MAX_DELAY_MS },
    failureRate: env.VALIDATION_FAILURE_RATE,
    minDelayMs: env.VALIDATION_MIN_DELAY_MS,
    maxDelayMs: env.VALIDATION_MAX_DELAY_MS,
  }, body, headers),
  log: app.log,
  consumerName: "validation",
});
validationOutbox = startValidationOutbox({
  url: env.RABBITMQ_URL,
  exchange: env.RABBITMQ_EXCHANGE,
  intervalMs: env.VALIDATION_OUTBOX_INTERVAL_MS,
  repository: validationRepository,
  log: app.log,
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutdown");
  await Promise.all([historyConsumer.close(), validationConsumer.close(), validationOutbox.close()]);
  await app.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
