import type { FastifyPluginAsync } from "fastify";

export interface HealthChecks {
  pingDatabase: () => Promise<void>;
  isBusConnected?: () => boolean;
}

export function healthRoutes({ pingDatabase, isBusConnected }: HealthChecks): FastifyPluginAsync {
  return async (app) => {
    app.get("/health", async () => ({ status: "ok" }));
    app.get("/ready", async (_request, reply) => {
      const dynamodb = await pingDatabase().then(
        () => "ok",
        (error: Error) => `error: ${error.name}`,
      );
      const rabbitmq = isBusConnected ? (isBusConnected() ? "ok" : "error: disconnected") : "not-checked";
      const ready = dynamodb === "ok" && rabbitmq !== "error: disconnected";
      return reply.status(ready ? 200 : 503).send({
        status: ready ? "ready" : "degraded",
        checks: { dynamodb, rabbitmq },
      });
    });
  };
}
