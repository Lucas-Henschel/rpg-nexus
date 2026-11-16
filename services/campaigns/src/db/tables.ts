// Tabelas DynamoDB do S1. São criadas pelo script create-tables (contêiner campaigns-init), se ainda não existirem.
import {
  CreateTableCommand,
  type CreateTableCommandInput,
  DescribeTimeToLiveCommand,
  type DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import type { Env } from "../config.js";

export interface Tables {
  campaigns: string;
  members: string;
  activity: string;
  operations: string;
  inbox: string;
}

/** Os nomes vêm do ambiente, para o mesmo código rodar no MiniStack e na nuvem. */
export function tablesFromEnv(env: Env): Tables {
  return {
    campaigns: env.TABLE_CAMPAIGNS,
    members: env.TABLE_MEMBERS,
    activity: env.TABLE_ACTIVITY,
    operations: env.TABLE_OPERATIONS,
    inbox: env.TABLE_INBOX,
  };
}

/** Tabela com chave de partição e, se informada, chave de ordenação. Todas as chaves são texto. */
function table(name: string, partitionKey: string, sortKey?: string): CreateTableCommandInput {
  const keys = sortKey ? [partitionKey, sortKey] : [partitionKey];

  return {
    TableName: name,
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: keys.map((key, index) => ({ AttributeName: key, KeyType: index === 0 ? "HASH" : "RANGE" })),
    AttributeDefinitions: keys.map((key) => ({ AttributeName: key, AttributeType: "S" })),
  };
}

const definitions = (tables: Tables): CreateTableCommandInput[] => [
  table(tables.campaigns, "campaignId"),
  // participantes de uma campanha
  table(tables.members, "campaignId", "characterId"),
  // atividade de uma campanha, ordenada pela data (activityKey = occurredAt#operationId)
  table(tables.activity, "campaignId", "activityKey"),
  // operações já contadas
  table(tables.operations, "operationId"),
  // mensagens já processadas; o DynamoDB apaga cada uma quando passa o `expiresAt`
  table(tables.inbox, "messageId"),
];

const INBOX_TTL_ATTRIBUTE = "expiresAt";

async function createTable(client: DynamoDBClient, input: CreateTableCommandInput): Promise<void> {
  try {
    await client.send(new CreateTableCommand(input));
  } catch (error) {
    // Já existe, criada antes ou por outra réplica subindo ao mesmo tempo.
    if (!(error instanceof Error && error.name === "ResourceInUseException")) {
      throw error;
    }
  }

  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: input.TableName });
}

// O CreateTable não aceita TTL; ele é ligado depois, numa chamada separada.
async function enableTtl(client: DynamoDBClient, tableName: string, attribute: string): Promise<void> {
  try {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: tableName,
        TimeToLiveSpecification: { Enabled: true, AttributeName: attribute },
      }),
    );
  } catch (error) {
    // Ligar de novo dá erro; só é problema se o TTL não estiver no atributo certo.
    const { TimeToLiveDescription } = await client.send(
      new DescribeTimeToLiveCommand({ TableName: tableName })
    );

    if (TimeToLiveDescription?.AttributeName !== attribute) {
      throw error;
    }
  }
}

export async function ensureTables(client: DynamoDBClient, tables: Tables): Promise<void> {
  await Promise.all(definitions(tables).map((input) => createTable(client, input)));
  await enableTtl(client, tables.inbox, INBOX_TTL_ATTRIBUTE);
}
