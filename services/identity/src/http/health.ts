import type { FastifyPluginAsync } from "fastify";

export interface HealthChecks {
  pingDatabase: () => Promise<void>;
}

export function healthRoutes({ pingDatabase }: HealthChecks): FastifyPluginAsync {
  return async (app) => {
    app.get("/health", async () => ({ status: "ok" }));
    app.get("/ready", async (_request, reply) => {
      const dynamodb = await pingDatabase().then(
        () => "ok",
        (error: Error) => `error: ${error.name}`,
      );
      return reply.status(dynamodb === "ok" ? 200 : 503).send({
        status: dynamodb === "ok" ? "ready" : "degraded",
        checks: { dynamodb },
      });
    });
  };
}
