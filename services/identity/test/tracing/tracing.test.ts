import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { createDynamoClient } from "../../src/db/client.js";
import { buildApp } from "../../src/http/app.js";
import { handleValidationDelivery } from "../../src/messaging/validation.js";
import { publishValidationResponse } from "../../src/messaging/validation-outbox.js";
import { startTracing, stopTracing } from "../../src/tracing/setup.js";
import { traceHeaders, withConsumerSpan } from "../../src/tracing/spans.js";
import { fakeDependencies, fakeHistory } from "../fakes.js";

const exporter = new InMemorySpanExporter();
const processor = new SimpleSpanProcessor({ exporter });

beforeAll(() => startTracing("identity-test", processor));
afterAll(async () => stopTracing());
beforeEach(() => exporter.reset());

it("extrai traceparent da mensagem AMQP e cria span filho no S4", async () => {
  const producer = trace.getTracer("test").startSpan("inventory request");
  const headers = traceHeaders(trace.setSpan(context.active(), producer));
  producer.end();

  await withConsumerSpan(
    "actions.validation-requested.v1",
    headers,
    { "messaging.message.id": "request-1" },
    async () => {},
  );
  await processor.forceFlush();
  const consumer = exporter
    .getFinishedSpans()
    .find((span) => span.name === "actions.validation-requested.v1 process");

  expect(consumer?.name).toBe("actions.validation-requested.v1 process");
  expect(consumer?.spanContext().traceId).toBe(producer.spanContext().traceId);
  expect(consumer?.parentSpanContext?.spanId).toBe(
    producer.spanContext().spanId,
  );
});

it("grava no registro da resposta o contexto do span de consumo", async () => {
  const publisher = trace
    .getTracer("test")
    .startSpan("inventory validation request");
  const headers = traceHeaders(trace.setSpan(context.active(), publisher));
  publisher.end();
  let stored: Record<string, string> | undefined;

  await withConsumerSpan(
    "actions.validation-requested.v1",
    headers,
    {},
    async () =>
      handleValidationDelivery(
        {
          parse: () => ({
            messageId: "request-2",
            correlationId: "op-2",
            occurredAt: new Date().toISOString(),
            operationId: "op-2",
            campaignId: "camp-1",
            characterId: "char-1",
            itemId: "item-1",
            quantity: 1,
          }),
          repository: {
            async record(_request, _response, traceContext) {
              stored = traceContext;
              return "applied";
            },
          },
          policy: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
          failureRate: 0,
          minDelayMs: 0,
          maxDelayMs: 0,
          now: () => new Date(),
          random: () => 0,
        },
        Buffer.from("{}"),
        undefined,
      ),
  );

  expect(stored?.traceparent).toMatch(
    new RegExp(`^00-${publisher.spanContext().traceId}-[0-9a-f]{16}-01$`),
  );
});

it("cria um span nomeado para uma rota HTTP e mantém o contexto W3C recebido", async () => {
  const deps = fakeDependencies();
  const identity = (
    await import("../../src/services/identity.js")
  ).createIdentityService(deps);
  const app = buildApp({
    env: deps.env,
    identity,
    history: fakeHistory(),
    pingDatabase: async () => {},
    logger: false,
  });
  const parent = trace.getTracer("test").startSpan("upstream request");
  const headers = traceHeaders(trace.setSpan(context.active(), parent));
  parent.end();

  await app.inject({
    method: "POST",
    url: "/auth/register",
    headers: {
      traceparent: headers.traceparent!,
      "content-type": "application/json",
    },
    payload: {
      username: "trace-user",
      email: "trace@example.test",
      password: "password-for-tracing-test",
    },
  });
  await app.inject({ method: "GET", url: "/health" });
  await app.close();
  await processor.forceFlush();
  const spans = exporter.getFinishedSpans();
  const http = spans.find((span) => span.name === "POST /auth/register");

  expect(http?.spanContext().traceId).toBe(parent.spanContext().traceId);
  expect(http?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  expect(spans.some((span) => span.name === "GET /health")).toBe(false);
});

it("publica a resposta da outbox como filha do processamento e injeta traceparent no AMQP", async () => {
  const request = trace.getTracer("test").startSpan("validation request");
  const stored = traceHeaders(trace.setSpan(context.active(), request));
  request.end();
  let publishOptions: Record<string, unknown> | undefined;
  const channel = {
    async publish(
      _exchange: string,
      _routingKey: string,
      _body: Buffer,
      options: Record<string, unknown>,
    ) {
      publishOptions = options;
    },
  };
  let marked = "";

  await publishValidationResponse(
    channel,
    "rpg.events",
    {
      messageId: "response-1",
      routingKey: "external.validation.succeeded.v1",
      envelope: {
        messageId: "response-1",
        correlationId: "op-1",
        version: 1,
        type: "rpg.external.validation-succeeded.v1",
        occurredAt: new Date().toISOString(),
        payload: {
          operationId: "op-1",
          campaignId: "camp-1",
          characterId: "char-1",
          itemId: "item-1",
          quantity: 1,
        },
      },
      traceContext: stored,
    },
    async (messageId) => {
      marked = messageId;
    },
  );

  await processor.forceFlush();
  const producer = exporter.getFinishedSpans().find((span) => span.kind === 3);
  expect(producer?.spanContext().traceId).toBe(request.spanContext().traceId);
  expect(producer?.parentSpanContext?.spanId).toBe(
    request.spanContext().spanId,
  );
  expect(publishOptions?.headers).toMatchObject({
    traceparent: expect.any(String),
  });
  expect(marked).toBe("response-1");
});

it("cria spans filhos para comandos DynamoDB e identifica a tabela", async () => {
  const client = createDynamoClient(
    loadEnv({
      AWS_ENDPOINT_URL: "http://127.0.0.1:9",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
    }),
  );
  await withConsumerSpan("history-test", undefined, {}, () =>
    client
      .send(
        new GetItemCommand({
          TableName: "identity_history_test",
          Key: { id: { S: "1" } },
        }),
      )
      .catch(() => undefined),
  );
  await processor.forceFlush();
  const spans = exporter.getFinishedSpans();
  const dynamo = spans.find((span) => span.name === "DynamoDB GetItem");
  const consumer = spans.find((span) => span.name === "history-test process");
  expect(dynamo?.parentSpanContext?.spanId).toBe(
    consumer?.spanContext().spanId,
  );
  expect(dynamo?.attributes["aws.dynamodb.table_names"]).toEqual([
    "identity_history_test",
  ]);
});

it("não cria span solto para sondagens ou trabalho de fundo sem trace ativo", async () => {
  const client = createDynamoClient(
    loadEnv({
      AWS_ENDPOINT_URL: "http://127.0.0.1:9",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
    }),
  );
  await client
    .send(
      new GetItemCommand({
        TableName: "identity_probe_test",
        Key: { id: { S: "1" } },
      }),
    )
    .catch(() => undefined);
  await processor.forceFlush();
  expect(exporter.getFinishedSpans()).toEqual([]);
});
