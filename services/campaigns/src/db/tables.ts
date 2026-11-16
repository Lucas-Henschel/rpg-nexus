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
  inbox: string;
}

/** Campanha, participantes, atividade e marcadores de operação, separados pelo prefixo do `sk`. */
const campaignsTable = (name: string): CreateTableCommandInput => ({
  TableName: name,
  BillingMode: "PAY_PER_REQUEST",
  KeySchema: [
    { AttributeName: "pk", KeyType: "HASH" },
    { AttributeName: "sk", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "pk", AttributeType: "S" },
    { AttributeName: "sk", AttributeType: "S" },
  ],
});

/** Mensagens já processadas; o DynamoDB apaga cada uma quando passa o `expiresAt`. */
const inboxTable = (name: string): CreateTableCommandInput => ({
  TableName: name,
  BillingMode: "PAY_PER_REQUEST",
  KeySchema: [{ AttributeName: "messageId", KeyType: "HASH" }],
  AttributeDefinitions: [{ AttributeName: "messageId", AttributeType: "S" }],
});

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
  await createTable(client, campaignsTable(tables.campaigns));
  await createTable(client, inboxTable(tables.inbox));
  await enableTtl(client, tables.inbox, INBOX_TTL_ATTRIBUTE);
}
