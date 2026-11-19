import { loadEnv } from "./config.js";
import { createDb, pingDatabase } from "./db/client.js";
import { buildApp } from "./http/app.js";
import { createSessionRepository } from "./repositories/session-repository.js";
import { createUserRepository } from "./repositories/user-repository.js";
import { createPasswordHasher } from "./security/passwords.js";
import { createTokenService } from "./security/tokens.js";
import { createIdentityService } from "./services/identity.js";

const env = loadEnv();
const db = createDb(env);
const identity = createIdentityService({
  env,
  users: createUserRepository(db),
  sessions: createSessionRepository(db),
  passwords: createPasswordHasher(env),
  tokens: createTokenService(env),
});
const app = buildApp({ env, identity, pingDatabase: () => pingDatabase(db) });

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutdown");
  await app.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
