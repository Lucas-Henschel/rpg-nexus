// Liga na fila de atividade (RABBITMQ_QUEUE) e aplica no RabbitMQ a decisão do handleDelivery.
import type { AmqpConnectionManager } from "amqp-connection-manager";
import type { ConsumeMessage } from "amqplib";
import type { FastifyBaseLogger } from "fastify";
import type { Outcome } from "./handle-delivery.js";
import { markError, withConsumerSpan } from "../tracing/spans.js";
import { requeueLater, settle } from "./settle.js";

/** Espera antes de devolver à fila uma mensagem que deu erro inesperado. */
const UNEXPECTED_ERROR_REQUEUE_MS = 1000;

export interface ConsumerOptions {
  connection: AmqpConnectionManager;
  queue: string;
  retryQueue: string;
  prefetch: number;
  handle: (body: Buffer, headers: Record<string, unknown> | undefined) => Promise<Outcome>;
  log: FastifyBaseLogger;
}

export interface Consumer {
  close(): Promise<void>;
}

function logOutcome(log: FastifyBaseLogger, messageId: string | undefined, outcome: Outcome) {
  switch (outcome.kind) {
    case "ack":
      if (outcome.result === "unknown-campaign") {
        log.warn(
          { messageId, campaignId: outcome.campaignId },
          "campaigns.activity.unknown_campaign",
        );
      } else {
        log.info(
          { messageId, campaignId: outcome.campaignId, result: outcome.result },
          "campaigns.activity.processed",
        );
      }
      break;

    case "retry":
      log.warn(
        { messageId, attempt: outcome.attempt, reason: outcome.reason },
        "campaigns.activity.retry",
      );
      break;

    case "dead-letter":
      log.error({ messageId, reason: outcome.reason }, "campaigns.activity.dead_letter");
      break;
  }
}

export function startConsumer({
  connection,
  queue,
  retryQueue,
  prefetch,
  handle,
  log,
}: ConsumerOptions): Consumer {
  const channel = connection.createChannel({ confirm: true });

  // Falha ao preparar o canal ou o consumidor (por exemplo, fila inexistente). O canal tenta de novo
  // sozinho; sem quem escute, o evento "error" derrubaria o processo.
  channel.on("error", (err) => log.error({ err }, "rabbitmq.channel_error"));

  async function onMessage(message: ConsumeMessage) {
    const { headers, messageId } = message.properties;
    const attributes = messageId ? { "messaging.message.id": messageId } : {};

    // O span do processamento continua o trace de quem publicou (traceparent nos headers).
    await withConsumerSpan(queue, headers, attributes, async (span) => {
      const outcome = await handle(message.content, headers);

      span.setAttribute(
        "campaigns.outcome",
        outcome.kind === "ack" ? outcome.result : outcome.kind,
      );

      if (outcome.kind !== "ack") {
        markError(span, outcome.reason);
      }

      logOutcome(log, messageId, outcome);
      await settle(channel, message, outcome, retryQueue);
    });
  }

  channel
    .consume(
      queue,
      (message) => {
        onMessage(message).catch((err: unknown) => {
          // Erro inesperado (por exemplo, falha ao publicar no retry): devolve para a fila, com espera.
          log.error(
            { err, messageId: message.properties.messageId },
            "campaigns.activity.unexpected_error",
          );
          requeueLater(channel, message, UNEXPECTED_ERROR_REQUEUE_MS, (nackError) =>
            log.warn({ err: nackError }, "campaigns.activity.requeue_failed"),
          );
        });
      },
      { prefetch },
    )
    .catch((err: unknown) => log.error({ err, queue }, "rabbitmq.consume_failed"));

  return {
    async close() {
      await channel.close();
    },
  };
}
