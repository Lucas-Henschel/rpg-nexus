// Cria as tabelas DynamoDB do S1, se ainda não existirem. No Compose quem cria é o Terraform;
// isto é usado pelo script create-tables e pelos testes de integração.
import {
  CreateTableCommand,
  type CreateTableCommandInput,
  DescribeTimeToLiveCommand,
  type DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { MEMBERS_BY_USER_INDEX } from "../repositories/member-repository.js";
import type { Tables } from "./tables.js";

/** Tabela com chave de partição e, se informada, chave de ordenação. Todas as chaves são texto. */
function table(name: string, partitionKey: string, sortKey?: string): CreateTableCommandInput {
  const keys = sortKey ? [partitionKey, sortKey] : [partitionKey];

  return {
    TableName: name,
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: keys.map((key, index) => ({
      AttributeName: key,
      KeyType: index === 0 ? "HASH" : "RANGE",
    })),
    AttributeDefinitions: keys.map((key) => ({ AttributeName: key, AttributeType: "S" })),
  };
}

/** Participantes de uma campanha, com o índice byUser para achar as campanhas de um usuário. */
function membersTable(name: string): CreateTableCommandInput {
  return {
    ...table(name, "campaignId", "userId"),
    GlobalSecondaryIndexes: [
      {
        IndexName: MEMBERS_BY_USER_INDEX,
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "campaignId", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "KEYS_ONLY" },
      },
    ],
  };
}

const definitions = (tables: Tables): CreateTableCommandInput[] => [
  table(tables.campaigns, "campaignId"),
  // códigos de entrada em uso: cada código aponta para uma campanha
  table(tables.joinCodes, "joinCode"),
  membersTable(tables.members),
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
async function enableTtl(
  client: DynamoDBClient,
  tableName: string,
  attribute: string,
): Promise<void> {
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
      new DescribeTimeToLiveCommand({ TableName: tableName }),
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
