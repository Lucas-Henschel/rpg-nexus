import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";

describe("loadEnv", () => {
  it("usa os padrões do spec", () => {
    const env = loadEnv({});

    expect(env).toMatchObject({
      PORT: 3001,
      CORS_ORIGINS: ["http://localhost:5173"],
      RABBITMQ_QUEUE: "campaigns.activity.v1",
      RABBITMQ_PREFETCH: 16,
      MAX_RETRIES: 3,
      RETRY_BASE_DELAY_MS: 1000,
      RETRY_MAX_DELAY_MS: 15000,
      TABLE_CAMPAIGNS: "campaigns",
      TABLE_INBOX: "campaign_inbox",
      INBOX_TTL_DAYS: 7,
    });
    expect(env.AWS_ENDPOINT_URL).toBeUndefined();
  });

  it("lê as variáveis de ambiente", () => {
    const env = loadEnv({ PORT: "4000", CORS_ORIGINS: "http://a, http://b", TABLE_INBOX: "x" });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(["http://a", "http://b"]);
    expect(env.TABLE_INBOX).toBe("x");
  });

  it("recusa número inválido citando a variável", () => {
    expect(() => loadEnv({ RABBITMQ_PREFETCH: "abc" })).toThrow(/RABBITMQ_PREFETCH/);
  });
});
