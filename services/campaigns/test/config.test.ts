import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";
import { AUTH_ENV } from "./tokens.js";

describe("loadEnv", () => {
  it("usa os padrões do spec", () => {
    const env = loadEnv({ JWT_SECRET: AUTH_ENV.JWT_SECRET });

    expect(env).toMatchObject({
      PORT: 3001,
      CORS_ORIGINS: ["http://localhost:5173"],
      RABBITMQ_EXCHANGE: "rpg.events",
      RABBITMQ_QUEUE: "campaigns.activity.v1",
      RABBITMQ_RETRY_QUEUE: "campaigns.activity.v1.retry",
      RABBITMQ_PREFETCH: 16,
      TABLE_CAMPAIGNS: "campaigns",
      TABLE_JOIN_CODES: "campaign_join_codes",
      TABLE_MEMBERS: "campaign_members",
      TABLE_ACTIVITY: "campaign_activity",
      TABLE_OPERATIONS: "campaign_operations",
      TABLE_INBOX: "campaign_inbox",
      MAX_RETRIES: 3,
      RETRY_BASE_DELAY_MS: 1000,
      RETRY_MAX_DELAY_MS: 15000,
      INBOX_TTL_DAYS: 7,
      TRACING_ENABLED: false,
      SERVICE_NAME: "campaigns",
      JWT_ISSUER: "rpg-nexus-identity",
      JWT_AUDIENCE: "rpg-nexus-services",
    });
    expect(env.AWS_ENDPOINT_URL).toBeUndefined();
  });

  it("lê as variáveis de ambiente", () => {
    const env = loadEnv({
      ...AUTH_ENV,
      PORT: "4000",
      CORS_ORIGINS: "http://a, http://b",
      INBOX_TTL_DAYS: "3",
      TRACING_ENABLED: "true",
    });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(["http://a", "http://b"]);
    expect(env.INBOX_TTL_DAYS).toBe(3);
    expect(env.TRACING_ENABLED).toBe(true);
  });

  it("recusa número inválido citando a variável", () => {
    expect(() => loadEnv({ ...AUTH_ENV, RABBITMQ_PREFETCH: "abc" })).toThrow(/RABBITMQ_PREFETCH/);
  });

  it("sem JWT_SECRET, ou com menos de 32 caracteres, não sobe", () => {
    expect(() => loadEnv({})).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ JWT_SECRET: "curto" })).toThrow(/JWT_SECRET/);
  });
});
