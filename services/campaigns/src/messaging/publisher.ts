// Publica no RabbitMQ os eventos da outbox. Com o canal em modo confirm, só resolve depois que o
// broker aceitou a mensagem.
import type { Options } from "amqplib";
import { traceHeaders } from "../tracing/spans.js";
import type { OutboxMessage } from "./outgoing.js";

/** O que o publisher usa do canal. O ChannelWrapper do amqp-connection-manager já atende. */
export interface PublishChannel {
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
  ): Promise<unknown>;
}

export function createPublisher(channel: PublishChannel, exchange: string) {
  return async (message: OutboxMessage): Promise<void> => {
    await channel.publish(exchange, message.routingKey, Buffer.from(message.body), {
      persistent: true,
      contentType: "application/json",
      messageId: message.messageId,
      type: message.type,
      // O traceparent do span de publicação, aberto pelo relay.
      headers: traceHeaders(),
    });
  };
}
