import { buildApp } from "./http/app.js";
import { createRepository } from "./db/repository.js";
import { loadEnv } from "./config.js";
import { createDocumentClient, createDynamoClient } from "./db/client.js";
import { ensureTables } from "./db/tables.js";

const env = loadEnv();
const tables = { campaigns: env.TABLE_CAMPAIGNS, inbox: env.TABLE_INBOX };

await ensureTables(createDynamoClient(env), tables);

const repository = createRepository(createDocumentClient(env), tables);
const app = buildApp({ env, repository, isBusConnected: () => false });

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutdown");
  await app.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
