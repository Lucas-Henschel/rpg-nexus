import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "../../src/http/app.js";
import { loadEnv } from "../../src/config.js";
import { createCampaignService } from "../../src/services/campaigns.js";
import { fakeRepositories } from "../fake-repositories.js";

function testApp({ busConnected = true, pingDatabase = async () => {} } = {}) {
  return buildApp({
    env: loadEnv({}),
    campaigns: createCampaignService(fakeRepositories()),
    pingDatabase,
    isBusConnected: () => busConnected,
    logger: false,
  });
}

it("corpo inválido vira 422 VALIDATION_ERROR com o campo", async () => {
  const app = testApp();

  app
    .withTypeProvider<ZodTypeProvider>()
    .post(
      "/echo",
      { schema: { body: z.object({ name: z.string().min(1) }) } },
      async (request) => request.body,
    );

  const res = await app.inject({ method: "POST", url: "/echo", payload: {} });

  expect(res.statusCode).toBe(422);
  expect(res.json()).toMatchObject({
    error: {
      code: "VALIDATION_ERROR",
      message: "requisição inválida",
      details: [{ field: "name" }],
    },
  });
});

it("JSON malformado ou corpo vazio → 400 INVALID_REQUEST, não 500", async () => {
  const app = testApp();
  const post = (payload: string) =>
    app.inject({
      method: "POST",
      url: "/campaigns",
      headers: { "content-type": "application/json" },
      payload,
    });

  for (const res of [await post("{bad"), await post("")]) {
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: "INVALID_REQUEST", message: "requisição inválida" },
    });
  }
});
