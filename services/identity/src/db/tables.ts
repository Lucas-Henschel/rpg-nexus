import type { Env } from "../config.js";

export interface Tables {
  users: string;
  identities: string;
  sessions: string;
}

export function tablesFromEnv(env: Env): Tables {
  return {
    users: env.TABLE_USERS,
    identities: env.TABLE_IDENTITIES,
    sessions: env.TABLE_SESSIONS,
  };
}
