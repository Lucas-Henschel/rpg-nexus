import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { createDynamoClient } from "../../src/db/client.js";
import { buildApp } from "../../src/http/app.js";
import { createCampaignService } from "../../src/services/campaigns.js";
import { startTracing, stopTracing } from "../../src/tracing/setup.js";
import { traceHeaders, withConsumerSpan } from "../../src/tracing/spans.js";
import { fakeRepositories } from "../fake-repositories.js";
import { AUTH_ENV, accessToken } from "../tokens.js";

const exporter = new InMemorySpanExporter();
const processor = new SimpleSpanProcessor({ exporter });

beforeAll(() => {
  startTracing("campaigns-test", processor);
});

afterAll(async () => {
  await stopTracing();
});

beforeEach(() => {
  exporter.reset();
});

/** Os spans terminados. A exportação é assíncrona: espera ela acabar antes de ler. */
async function exported() {
  await processor.forceFlush();

  return exporter.getFinishedSpans();
}

const finished = async (name: string) => (await exported()).filter((span) => span.name === name);

it("o consumo continua o trace de quem publicou, lido do traceparent dos headers", async () => {
  const publisher = trace.getTracer("test").startSpan("publish");
  const headers = traceHeaders(trace.setSpan(context.active(), publisher));
  publisher.end();

  await withConsumerSpan(
    "campaigns.activity.v1",
    headers,
    { "messaging.message.id": "m1" },
    async () => {},
  );

  const [consumed] = await finished("campaigns.activity.v1 process");

  expect(consumed?.spanContext().traceId).toBe(publisher.spanContext().traceId);
  expect(consumed?.parentSpanContext?.spanId).toBe(publisher.spanContext().spanId);
  expect(consumed?.attributes).toMatchObject({
    "messaging.system": "rabbitmq",
    "messaging.message.id": "m1",
  });
});

it("sem traceparent, o consumo abre um trace novo", async () => {
  await withConsumerSpan("campaigns.activity.v1", undefined, {}, async () => {});

  expect((await finished("campaigns.activity.v1 process"))[0]?.parentSpanContext).toBeUndefined();
});

it("cada comando do DynamoDB vira um span filho, com erro quando falha", async () => {
  const client = createDynamoClient(
    loadEnv({
      ...AUTH_ENV,
      AWS_ENDPOINT_URL: "http://127.0.0.1:9",
      AWS_ACCESS_KEY_ID: "x",
      AWS_SECRET_ACCESS_KEY: "x",
    }),
  );

  await withConsumerSpan("fila", undefined, {}, () =>
    client
      .send(new GetItemCommand({ TableName: "t", Key: { id: { S: "1" } } }))
      .catch(() => undefined),
  );

  const [dynamo] = await finished("DynamoDB GetItem");
  const [consumed] = await finished("fila process");

  expect(dynamo?.parentSpanContext?.spanId).toBe(consumed?.spanContext().spanId);
  expect(dynamo?.attributes).toMatchObject({
    "db.system": "dynamodb",
    "aws.dynamodb.table_names": ["t"],
  });
  expect(dynamo?.status.code).toBe(2); // ERROR
});

it("cada requisição HTTP vira um span 'MÉTODO /rota'; /health e /ready não", async () => {
  const app = buildApp({
    env: loadEnv(AUTH_ENV),
    campaigns: createCampaignService(fakeRepositories()),
    pingDatabase: async () => {},
    isBusConnected: () => true,
    logger: false,
  });

  await app.inject({
    method: "POST",
    url: "/campaigns",
    headers: { authorization: `Bearer ${accessToken({ userId: "u-ana", username: "ana" })}` },
    payload: { name: "Um" },
  });
  await app.inject({ method: "GET", url: "/health" });

  const names = (await exported()).map((span) => span.name);

  // Um span por requisição, com nome legível; sem o span do handler (o nome dele é o código da função).
  expect(names).toEqual(["POST /campaigns"]);
});
