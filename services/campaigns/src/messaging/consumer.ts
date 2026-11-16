// Liga na fila de atividade (RABBITMQ_QUEUE) e aplica no RabbitMQ a decisão do handleDelivery.
import amqp from "amqp-connection-manager";
import type { ConsumeMessage } from "amqplib";
import type { FastifyBaseLogger } from "fastify";
import type { Outcome } from "./handle-delivery.js";
import { markError, traceHeaders, withConsumerSpan } from "../tracing/spans.js";
import { RETRY_HEADER } from "./retry.js";

export interface ConsumerOptions {
  url: string;
  queue: string;
  retryQueue: string;
  prefetch: number;
  handle: (body: Buffer, headers: Record<string, unknown> | undefined) => Promise<Outcome>;
  log: FastifyBaseLogger;
}

export interface Consumer {
  isConnected(): boolean;
  close(): Promise<void>;
}

export function startConsumer({
  url,
  queue,
  retryQueue,
  prefetch,
  handle,
  log,
}: ConsumerOptions): Consumer {
  const connection = amqp.connect([url]);
  const channel = connection.createChannel({ confirm: true });

  connection.on("connect", () => log.info({ queue }, "rabbitmq.connected"));
  connection.on("disconnect", ({ err }) => log.warn({ err }, "rabbitmq.disconnected"));

  async function onMessage(message: ConsumeMessage) {
    const { headers, messageId, contentType } = message.properties;
    const attributes = messageId ? { "messaging.message.id": messageId } : {};

    // O span do processamento continua o trace de quem publicou (traceparent nos headers).
    await withConsumerSpan(queue, headers, attributes, async (span) => {
      const outcome = await handle(message.content, headers);

      span.setAttribute(
        "campaigns.outcome",
        outcome.kind === "ack" ? outcome.result : outcome.kind,
      );

      switch (outcome.kind) {
        case "ack":
          if (outcome.result === "unknown-campaign") {
            log.warn(
              { messageId, campaignId: outcome.campaignId },
              "campaigns.activity.unknown_campaign",
            );
          } else {
            log.info(
              {
                messageId,
                campaignId: outcome.campaignId,
                result: outcome.result,
              },
              "campaigns.activity.processed",
            );
          }

          channel.ack(message);
          break;

        case "retry":
          // Vai para a fila de retry, que devolve a mensagem para cá quando a espera (expiration) acaba.
          // O traceparent é trocado pelo deste span, para a nova tentativa aparecer no mesmo trace.
          log.warn(
            { messageId, attempt: outcome.attempt, reason: outcome.reason },
            "campaigns.activity.retry",
          );
          markError(span, outcome.reason);

          await channel.publish("", retryQueue, message.content, {
            persistent: true,
            expiration: String(outcome.delayMs),
            headers: { ...headers, ...traceHeaders(), [RETRY_HEADER]: outcome.attempt },
            contentType,
            messageId,
          });
          channel.ack(message);
          break;

        case "dead-letter":
          // Sem requeue: a fila manda a mensagem para a .dlq.
          log.error({ messageId, reason: outcome.reason }, "campaigns.activity.dead_letter");
          markError(span, outcome.reason);
          channel.nack(message, false, false);
          break;
      }
    });
  }

  channel.consume(
    queue,
    (message) => {
      onMessage(message).catch((err: unknown) => {
        // Erro inesperado (por exemplo, falha ao publicar no retry): devolve para a fila.
        log.error({ err }, "campaigns.activity.unexpected_error");
        channel.nack(message, false, true);
      });
    },
    { prefetch },
  );

  return {
    isConnected: () => connection.isConnected(),
    async close() {
      await channel.close();
      await connection.close();
    },
  };
}
