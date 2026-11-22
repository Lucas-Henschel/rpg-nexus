import amqp from "amqp-connection-manager";
import type { ConsumeMessage } from "amqplib";
import type { FastifyBaseLogger } from "fastify";
import type { Outcome } from "./handle-delivery.js";
import { settle } from "./settle.js";

interface ConsumerOptions {
  url: string;
  queue: string;
  retryQueue: string;
  prefetch: number;
  handle: (body: Buffer, headers: Record<string, unknown> | undefined) => Promise<Outcome>;
  log: FastifyBaseLogger;
  consumerName?: string;
}

export function startConsumer(options: ConsumerOptions) {
  const name = options.consumerName ?? "history";
  const connection = amqp.connect([options.url]);
  const channel = connection.createChannel({ confirm: true });
  connection.on("connect", () => options.log.info({ queue: options.queue }, "rabbitmq.connected"));
  connection.on("disconnect", ({ err }) => options.log.warn({ err }, "rabbitmq.disconnected"));
  connection.on("connectFailed", ({ err }) => options.log.warn({ err }, "rabbitmq.connect_failed"));
  channel.on("error", (err) => options.log.error({ err }, "rabbitmq.channel_error"));

  async function onMessage(message: ConsumeMessage) {
    const outcome = await options.handle(message.content, message.properties.headers);
    const details = { messageId: message.properties.messageId, outcome: outcome.kind };
    outcome.kind === "dead-letter"
      ? options.log.error({ ...details, reason: outcome.reason }, `actions.${name}.dead_letter`)
      : options.log.info(details, `actions.${name}.processed`);
    await settle(channel, message, outcome, options.retryQueue);
  }

  channel.consume(options.queue, (message) => {
    onMessage(message).catch((err: unknown) => {
      options.log.error({ err, messageId: message.properties.messageId }, `actions.${name}.unexpected_error`);
      try { channel.nack(message, false, true); } catch { /* a conexão reentrega após reconectar */ }
    });
  }, { prefetch: options.prefetch }).catch((err: unknown) => {
    options.log.error({ err, queue: options.queue }, "rabbitmq.consume_failed");
  });

  return {
    isConnected: () => connection.isConnected(),
    async close() {
      await channel.close();
      await connection.close();
    },
  };
}
