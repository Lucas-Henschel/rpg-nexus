import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { context, SpanKind, trace } from "@opentelemetry/api";
import { inSpan, isUntraced } from "./spans.js";

interface CommandInput {
  TableName?: string;
  TransactItems?: Record<string, { TableName?: string }>[];
}
function tableNames(input: unknown): string[] {
  const { TableName, TransactItems = [] } = (input ?? {}) as CommandInput;
  const nested = TransactItems.flatMap((item) =>
    Object.values(item).map((operation) => operation.TableName),
  );
  return [
    ...new Set(
      [TableName, ...nested].filter((name): name is string => Boolean(name)),
    ),
  ];
}
// Recusa de escrita condicional (inbox detectando repetida) é resposta esperada, não erro do span.
function onlyConditionsFailed(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ConditionalCheckFailedException") return true;
  if (error.name !== "TransactionCanceledException") return false;
  const reasons =
    (error as { CancellationReasons?: { Code?: string }[] })
      .CancellationReasons ?? [];
  const codes = reasons
    .map((reason) => reason.Code)
    .filter((code) => code !== "None");
  return (
    codes.length > 0 && codes.every((code) => code === "ConditionalCheckFailed")
  );
}
export function traceDynamoCommands(client: DynamoDBClient): void {
  client.middlewareStack.add(
    (next, { commandName = "Command" }) =>
      async (args) => {
        if (isUntraced() || !trace.getSpan(context.active())?.isRecording())
          return next(args);
        const operation = commandName.replace(/Command$/, "");
        const outcome = await inSpan(
          `DynamoDB ${operation}`,
          SpanKind.CLIENT,
          {
            "db.system": "dynamodb",
            "rpc.method": operation,
            "aws.dynamodb.table_names": tableNames(args.input),
          },
          context.active(),
          async (span) => {
            try {
              return { output: await next(args) };
            } catch (error) {
              if (!onlyConditionsFailed(error)) throw error;
              span.setAttribute("db.condition_failed", true);
              return { refused: error };
            }
          },
        );
        if ("refused" in outcome) throw outcome.refused;
        return outcome.output;
      },
    { step: "initialize", name: "openTelemetrySpan" },
  );
}
