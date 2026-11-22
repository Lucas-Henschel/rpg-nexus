import amqp from "amqp-connection-manager";
import type { FastifyBaseLogger } from "fastify";
import type { ValidationRepository } from "../repositories/validation-repository.js";

interface Options {
  url: string;
  exchange: string;
  intervalMs: number;
  repository: Pick<ValidationRepository, "pending" | "markPublished">;
  log: FastifyBaseLogger;
}

export function startValidationOutbox(options: Options) {
  const connection = amqp.connect([options.url]);
  const channel = connection.createChannel({ confirm: true });
  let running = false;

  async function publishPending() {
    if (running || !connection.isConnected()) return;
    running = true;
    try {
      for (const event of await options.repository.pending()) {
        await channel.publish(options.exchange, event.routingKey, Buffer.from(JSON.stringify(event.envelope)), {
          contentType: "application/json",
          deliveryMode: 2,
          messageId: event.messageId,
          correlationId: event.envelope.correlationId,
          type: event.envelope.type,
        });
        await options.repository.markPublished(event.messageId);
        options.log.info({ messageId: event.messageId, routingKey: event.routingKey }, "actions.validation.published");
      }
    } catch (error) {
      options.log.warn({ error }, "actions.validation.publish_failed");
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void publishPending(), options.intervalMs);
  timer.unref();
  connection.on("connect", () => void publishPending());

  return {
    isConnected: () => connection.isConnected(),
    async close() {
      clearInterval(timer);
      await channel.close();
      await connection.close();
    },
  };
}
