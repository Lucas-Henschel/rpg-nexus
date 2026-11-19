import { randomUUID } from "node:crypto";
import type { Tables } from "../../src/db/tables.js";

/** Nomes de tabela com sufixo aleatório, para cada teste não enxergar os dados de outro. */
export function uniqueTables(): Tables {
  const suffix = randomUUID().slice(0, 8);

  return {
    campaigns: `campaigns_${suffix}`,
    joinCodes: `campaign_join_codes_${suffix}`,
    members: `campaign_members_${suffix}`,
    activity: `campaign_activity_${suffix}`,
    operations: `campaign_operations_${suffix}`,
    inbox: `campaign_inbox_${suffix}`,
  };
}
