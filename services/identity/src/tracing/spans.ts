import {
  type Attributes,
  type Context,
  context,
  createContextKey,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

const tracer = trace.getTracer("rpg-nexus.identity");
const UNTRACED = createContextKey("rpg-nexus.identity.untraced");

export function untraced<T>(fn: () => Promise<T>): Promise<T> {
  return context.with(context.active().setValue(UNTRACED, true), fn);
}
export const isUntraced = (ctx: Context = context.active()): boolean =>
  ctx.getValue(UNTRACED) === true;
export function traceHeaders(
  ctx: Context = context.active(),
): Record<string, string> {
  const headers: Record<string, string> = {};
  propagation.inject(ctx, headers);
  return headers;
}
export function markError(span: Span, error: unknown): void {
  if (error instanceof Error) span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message:
      error instanceof Error ? error.message || error.name : String(error),
  });
}
export async function inSpan<T>(
  name: string,
  kind: SpanKind,
  attributes: Attributes,
  parent: Context,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    name,
    { kind, attributes },
    parent,
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        markError(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
function messagingAttributes(
  operation: "process" | "publish",
  destination: string,
): Attributes {
  return {
    "messaging.system": "rabbitmq",
    "messaging.operation": operation,
    "messaging.destination.name": destination,
  };
}
export function withConsumerSpan<T>(
  queue: string,
  headers: Record<string, unknown> | undefined,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = propagation.extract(ROOT_CONTEXT, headers ?? {});
  return inSpan(
    `${queue} process`,
    SpanKind.CONSUMER,
    { ...messagingAttributes("process", queue), ...attributes },
    parent,
    fn,
  );
}
export function withProducerSpan<T>(
  routingKey: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  parentHeaders?: Record<string, string>,
): Promise<T> {
  const parent = parentHeaders
    ? propagation.extract(ROOT_CONTEXT, parentHeaders)
    : context.active();
  return inSpan(
    `${routingKey} publish`,
    SpanKind.PRODUCER,
    { ...messagingAttributes("publish", routingKey), ...attributes },
    parent,
    fn,
  );
}
