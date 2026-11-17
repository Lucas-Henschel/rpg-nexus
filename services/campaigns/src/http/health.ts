// Rotas que o Docker e o Compose usam para saber se o serviço está de pé e pronto.
import type { FastifyPluginAsync } from "fastify";

export interface HealthChecks {
  /** Falha se o DynamoDB não responde. */
  pingDatabase: () => Promise<void>;
  /** Se o consumidor está ligado ao RabbitMQ. */
  isBusConnected: () => boolean;
}

export function healthRoutes({ pingDatabase, isBusConnected }: HealthChecks): FastifyPluginAsync {
  return async (app) => {
    app.get("/health", async () => ({ status: "ok" }));

    // Pronto para atender: DynamoDB responde e o consumidor está ligado ao RabbitMQ.
    app.get("/ready", async (_request, reply) => {
      const checks = {
        dynamodb: await pingDatabase().then(
          () => "ok",
          (error: Error) => `error: ${error.name}`,
        ),
        rabbitmq: isBusConnected() ? "ok" : "disconnected",
      };
      const ready = checks.dynamodb === "ok" && checks.rabbitmq === "ok";

      return reply.status(ready ? 200 : 503).send({ status: ready ? "ready" : "degraded", checks });
    });
  };
}
