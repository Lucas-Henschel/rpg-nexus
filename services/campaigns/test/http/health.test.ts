import { expect, it } from "vitest";
import { buildApp } from "../../src/http/app.js";
import { loadEnv } from "../../src/config.js";
import { createCampaignService } from "../../src/services/campaigns.js";
import { fakeRepositories } from "../fake-repositories.js";
import { AUTH_ENV } from "../tokens.js";

function testApp({ busConnected = true, pingDatabase = async () => {} } = {}) {
  return buildApp({
    env: loadEnv(AUTH_ENV),
    campaigns: createCampaignService(fakeRepositories()),
    pingDatabase,
    isBusConnected: () => busConnected,
    logger: false,
  });
}

it("GET /health responde ok", async () => {
  const res = await testApp().inject({ method: "GET", url: "/health" });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok" });
});

it("GET /ready → 200 quando DynamoDB e RabbitMQ respondem", async () => {
  const res = await testApp().inject({ method: "GET", url: "/ready" });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ready", checks: { dynamodb: "ok", rabbitmq: "ok" } });
});

it("GET /ready → 503 degraded quando o barramento está desconectado", async () => {
  const res = await testApp({ busConnected: false }).inject({ method: "GET", url: "/ready" });

  expect(res.statusCode).toBe(503);
  expect(res.json()).toEqual({
    status: "degraded",
    checks: { dynamodb: "ok", rabbitmq: "disconnected" },
  });
});

it("GET /ready → 503 com o nome do erro quando o DynamoDB falha", async () => {
  const pingDatabase = async () => {
    throw new TypeError("sem conexão");
  };

  const res = await testApp({ pingDatabase }).inject({ method: "GET", url: "/ready" });

  expect(res.statusCode).toBe(503);
  expect(res.json()).toMatchObject({ checks: { dynamodb: "error: TypeError" } });
});
