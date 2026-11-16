// Nomes das tabelas DynamoDB do S1. Vêm do ambiente, para o mesmo código rodar no MiniStack e na nuvem.
import type { Env } from "../config.js";

export interface Tables {
  campaigns: string;
  members: string;
  activity: string;
  operations: string;
  inbox: string;
}

export function tablesFromEnv(env: Env): Tables {
  return {
    campaigns: env.TABLE_CAMPAIGNS,
    members: env.TABLE_MEMBERS,
    activity: env.TABLE_ACTIVITY,
    operations: env.TABLE_OPERATIONS,
    inbox: env.TABLE_INBOX,
  };
}
