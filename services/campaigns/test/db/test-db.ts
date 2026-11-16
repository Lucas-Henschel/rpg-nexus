// Banco para os testes de integração: um MiniStack em AWS_ENDPOINT_URL (padrão http://localhost:4566),
// com tabelas novas a cada chamada, para um teste não enxergar os dados de outro.
import { loadEnv } from "../../src/config.js";
import { createDocumentClient, createDynamoClient, type Db } from "../../src/db/client.js";
import { ensureTables } from "../../src/db/setup.js";
import { uniqueTables } from "./unique-tables.js";

export async function createTestDb(): Promise<Db> {
  const env = loadEnv({ AWS_ENDPOINT_URL: "http://localhost:4566", ...process.env });
  const tables = uniqueTables();

  await ensureTables(createDynamoClient(env), tables);

  return { doc: createDocumentClient(env), tables };
}
