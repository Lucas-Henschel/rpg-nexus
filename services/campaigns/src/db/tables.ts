// Tabelas DynamoDB do S1. O serviço as cria ao subir (ensureTables), se ainda não existirem.
import {
  CreateTableCommand,
  type CreateTableCommandInput,
  DescribeTimeToLiveCommand,
  type DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

export interface Tables {
  campaigns: string;
  members: string;
  activity: string;
  operations: string;
  inbox: string;
}

export const TABLES: Tables = {
  campaigns: "campaigns",
  members: "campaign_members",
  activity: "campaign_activity",
  operations: "campaign_operations",
  inbox: "campaign_inbox",
};

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
