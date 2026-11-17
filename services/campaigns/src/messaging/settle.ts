// Aplica no RabbitMQ a decisão do handleDelivery: confirmar, mandar para o retry ou para a DLQ.
import type { ConsumeMessage, Options } from "amqplib";
import { traceHeaders } from "../tracing/spans.js";
import type { Outcome } from "./handle-delivery.js";
import { RETRY_HEADER } from "./retry.js";

/** O que o settle usa do canal. O ChannelWrapper do amqp-connection-manager já atende. */
export interface SettleChannel {
  ack(message: ConsumeMessage): void;
  nack(message: ConsumeMessage, allUpTo?: boolean, requeue?: boolean): void;
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
  ): Promise<unknown>;
}

export async function settle(
  channel: SettleChannel,
  message: ConsumeMessage,
  outcome: Outcome,
  retryQueue: string,
): Promise<void> {
  const { headers, messageId, contentType } = message.properties;

  switch (outcome.kind) {
    case "ack":
      channel.ack(message);
      break;

    case "retry":
      // Vai para a fila de retry, que devolve a mensagem para cá quando a espera (expiration) acaba.
      // O traceparent é trocado pelo do span atual, para a nova tentativa aparecer no mesmo trace.
      // Só confirma depois que o RabbitMQ aceitou a cópia: se a publicação falhar, nada se perde.
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
      channel.nack(message, false, false);
      break;
  }
}

/**
 * Devolve a mensagem para a fila depois de `delayMs`. Usado em erro inesperado: a espera evita que
 * a mesma mensagem volte na hora e gire em loop enquanto o problema continua.
 *
 * Se o canal já fechou, o nack falha; tudo bem, o RabbitMQ reentrega a mensagem sozinho.
 */
export function requeueLater(
  channel: SettleChannel,
  message: ConsumeMessage,
  delayMs: number,
  onError: (error: unknown) => void,
): void {
  setTimeout(() => {
    try {
      channel.nack(message, false, true);
    } catch (error) {
      onError(error);
    }
  }, delayMs);
}
