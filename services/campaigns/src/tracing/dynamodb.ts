// Cada comando enviado ao DynamoDB vira um span `DynamoDB <Operação>`, filho de quem chamou, a não
// ser dentro de `untraced`.
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { context, SpanKind } from "@opentelemetry/api";
import { inSpan, isUntraced } from "./spans.js";

interface CommandInput {
  TableName?: string;
  /** Cada item da transação tem uma operação (Put, Update, ConditionCheck...) com sua tabela. */
  TransactItems?: Record<string, { TableName?: string }>[];
}

/** Tabelas citadas por um comando, inclusive as de cada item de uma transação. */
function tableNames(input: unknown): string[] {
  const { TableName, TransactItems = [] } = (input ?? {}) as CommandInput;

  const fromTransaction = TransactItems.flatMap((item) =>
    Object.values(item).map((operation) => operation.TableName),
  );

  const names = [TableName, ...fromTransaction].filter((name): name is string => Boolean(name));

  return [...new Set(names)];
}

/** Coloca no cliente um middleware que abre um span em volta de cada comando. */
export function traceDynamoCommands(client: DynamoDBClient): void {
  client.middlewareStack.add(
    (next, { commandName = "Command" }) =>
      (args) => {
        if (isUntraced()) {
          return next(args);
        }

        const operation = commandName.replace(/Command$/, ""); // GetItemCommand → GetItem

        const attributes = {
          "db.system": "dynamodb",
          "rpc.method": operation,
          "aws.dynamodb.table_names": tableNames(args.input),
        };

        return inSpan(`DynamoDB ${operation}`, SpanKind.CLIENT, attributes, context.active(), () =>
          next(args),
        );
      },
    { step: "initialize", name: "openTelemetrySpan" },
  );
}
