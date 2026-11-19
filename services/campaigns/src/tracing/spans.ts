// Spans criados pelo próprio código: consumo e publicação de mensagens no RabbitMQ.
//
// O `traceparent` vai nos headers AMQP. Quem consome abre o span de processamento como filho de
// quem publicou; quem publica coloca nos headers o `traceparent` do span atual.
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

const tracer = trace.getTracer("rpg-nexus.campaigns");

const UNTRACED = createContextKey("rpg-nexus.campaigns.untraced");

/**
 * Roda `fn` sem abrir spans de DynamoDB. O relay consulta a outbox a cada meio segundo; sem isto,
 * cada consulta vazia viraria um trace no Jaeger.
 */
export function untraced<T>(fn: () => Promise<T>): Promise<T> {
  return context.with(context.active().setValue(UNTRACED, true), fn);
}

export const isUntraced = (ctx: Context = context.active()): boolean =>
  ctx.getValue(UNTRACED) === true;

/** `traceparent` (e `tracestate`) do contexto, para ir nos headers de uma mensagem. */
export function traceHeaders(ctx: Context = context.active()): Record<string, string> {
  const headers: Record<string, string> = {};

  propagation.inject(ctx, headers);

  return headers;
}

/** Marca o span como erro; aceita a exceção ou só o motivo. */
export function markError(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordException(error);
  }

  const message = error instanceof Error ? error.message || error.name : String(error);

  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

/** Roda `fn` dentro de um span. Se der erro, marca o span e deixa o erro continuar subindo. */
export async function inSpan<T>(
  name: string,
  kind: SpanKind,
  attributes: Attributes,
  parent: Context,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { kind, attributes }, parent, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      markError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

function messagingAttributes(operation: "process" | "publish", destination: string): Attributes {
  return {
    "messaging.system": "rabbitmq",
    "messaging.operation": operation,
    "messaging.destination.name": destination,
  };
}

/** Processamento de uma mensagem, filho de quem a publicou (pelo `traceparent` dos headers). */
export function withConsumerSpan<T>(
  queue: string,
  headers: Record<string, unknown> | undefined,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = propagation.extract(ROOT_CONTEXT, headers ?? {});
  const allAttributes = { ...messagingAttributes("process", queue), ...attributes };

  return inSpan(`${queue} process`, SpanKind.CONSUMER, allAttributes, parent, fn);
}

/**
 * Publicação de uma mensagem. Use `traceHeaders()` dentro de `fn` para o trace ir junto. Com
 * `parentHeaders` (o `traceparent` guardado na outbox), o span é filho de quem gerou o evento, e não
 * do contexto atual.
 */
export function withProducerSpan<T>(
  routingKey: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  parentHeaders?: Record<string, string>,
): Promise<T> {
  const allAttributes = { ...messagingAttributes("publish", routingKey), ...attributes };
  const parent = parentHeaders
    ? propagation.extract(ROOT_CONTEXT, parentHeaders)
    : context.active();

  return inSpan(`${routingKey} publish`, SpanKind.PRODUCER, allAttributes, parent, fn);
}
