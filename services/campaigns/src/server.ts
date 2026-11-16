import { buildApp } from "./http/app.js";
import { createRepository } from "./db/repository.js";
import { loadEnv } from "./config.js";
import { createDocumentClient, createDynamoClient } from "./db/client.js";
import { ensureTables, TABLES } from "./db/tables.js";

const env = loadEnv();

await ensureTables(createDynamoClient(env), TABLES);

const repository = createRepository(createDocumentClient(env), TABLES, env.INBOX_TTL_DAYS);
const app = buildApp({ env, repository, isBusConnected: () => false });

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutdown");
  await app.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
