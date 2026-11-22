import amqp from "amqp-connection-manager";
import type { Options } from "amqplib";
import type { FastifyBaseLogger } from "fastify";
import type { ValidationRepository } from "../repositories/validation-repository.js";
import type { PendingValidationResponse } from "../domain/validation.js";
import { traceHeaders, untraced, withProducerSpan } from "../tracing/spans.js";

interface PublishChannel {
  publish(exchange: string, routingKey: string, content: Buffer, options: Options.Publish): Promise<unknown>;
}

export async function publishValidationResponse(
  channel: PublishChannel,
  exchange: string,
  event: PendingValidationResponse,
  markPublished: (messageId: string) => Promise<void>,
): Promise<void> {
  await withProducerSpan(event.routingKey, { "messaging.message.id": event.messageId }, async () => {
    await channel.publish(exchange, event.routingKey, Buffer.from(JSON.stringify(event.envelope)), {
      contentType: "application/json",
      deliveryMode: 2,
      messageId: event.messageId,
      correlationId: event.envelope.correlationId,
      type: event.envelope.type,
      headers: traceHeaders(),
    });
    await markPublished(event.messageId);
  }, event.traceContext);
}

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
      for (const event of await untraced(() => options.repository.pending())) {
        await publishValidationResponse(channel, options.exchange, event, (messageId) => options.repository.markPublished(messageId));
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
