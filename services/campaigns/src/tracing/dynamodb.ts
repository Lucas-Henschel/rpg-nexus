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

/**
 * A recusa de uma escrita condicional é resposta esperada, não falha: é assim que a inbox detecta
 * mensagem repetida e que uma operação não é contada duas vezes. Quem chamou decide o que fazer.
 * Numa transação, só conta se todos os itens recusados foram recusados pela condição.
 */
function onlyConditionsFailed(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "ConditionalCheckFailedException") {
    return true;
  }

  if (error.name !== "TransactionCanceledException") {
    return false;
  }

  const { CancellationReasons = [] } = error as { CancellationReasons?: { Code?: string }[] };
  const codes = CancellationReasons.map((reason) => reason.Code).filter((code) => code !== "None");

  return codes.length > 0 && codes.every((code) => code === "ConditionalCheckFailed");
}

/** Coloca no cliente um middleware que abre um span em volta de cada comando. */
export function traceDynamoCommands(client: DynamoDBClient): void {
  client.middlewareStack.add(
    (next, { commandName = "Command" }) =>
      async (args) => {
        if (isUntraced()) {
          return next(args);
        }

        const operation = commandName.replace(/Command$/, ""); // GetItemCommand → GetItem

        const attributes = {
          "db.system": "dynamodb",
          "rpc.method": operation,
          "aws.dynamodb.table_names": tableNames(args.input),
        };

        // A recusa da condição sai do span como resultado, para ele não ficar marcado como erro.
        const outcome = await inSpan(
          `DynamoDB ${operation}`,
          SpanKind.CLIENT,
          attributes,
          context.active(),
          async (span) => {
            try {
              return { output: await next(args) };
            } catch (error) {
              if (!onlyConditionsFailed(error)) {
                throw error;
              }

              span.setAttribute("db.condition_failed", true);

              return { refused: error };
            }
          },
        );

        if ("refused" in outcome) {
          throw outcome.refused;
        }

        return outcome.output;
      },
    { step: "initialize", name: "openTelemetrySpan" },
  );
}
