import type { Env } from "../config.js";

export interface Tables {
  users: string;
  identities: string;
  sessions: string;
  loginAttempts: string;
  history: string;
  historyInbox: string;
  historyMemberships: string;
  audit: string;
  validationInbox: string;
  validationOutbox: string;
}

export function tablesFromEnv(env: Env): Tables {
  return {
    users: env.TABLE_USERS,
    identities: env.TABLE_IDENTITIES,
    sessions: env.TABLE_SESSIONS,
    loginAttempts: env.TABLE_LOGIN_ATTEMPTS,
    history: env.TABLE_HISTORY,
    historyInbox: env.TABLE_HISTORY_INBOX,
    historyMemberships: env.TABLE_HISTORY_MEMBERSHIPS,
    audit: env.TABLE_AUDIT,
    validationInbox: env.TABLE_VALIDATION_INBOX,
    validationOutbox: env.TABLE_VALIDATION_OUTBOX,
  };
}
