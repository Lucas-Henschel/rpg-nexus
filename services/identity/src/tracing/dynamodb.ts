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
export function traceDynamoCommands(client: DynamoDBClient): void {
  client.middlewareStack.add(
    (next, { commandName = "Command" }) =>
      (args) => {
        if (isUntraced() || !trace.getSpan(context.active())?.isRecording())
          return next(args);
        const operation = commandName.replace(/Command$/, "");
        return inSpan(
          `DynamoDB ${operation}`,
          SpanKind.CLIENT,
          {
            "db.system": "dynamodb",
            "rpc.method": operation,
            "aws.dynamodb.table_names": tableNames(args.input),
          },
          context.active(),
          () => next(args),
        );
      },
    { step: "initialize", name: "openTelemetrySpan" },
  );
}
