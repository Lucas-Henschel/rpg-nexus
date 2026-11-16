// Cria as tabelas DynamoDB
//
//   node dist/scripts/create-tables.js
import { loadEnv } from "../config.js";
import { createDynamoClient } from "../db/client.js";
import { ensureTables } from "../db/setup.js";
import { tablesFromEnv } from "../db/tables.js";

const env = loadEnv();
const tables = tablesFromEnv(env);

await ensureTables(createDynamoClient(env), tables);

console.log(`Tabelas prontas: ${Object.values(tables).join(", ")}`);
