import type { ConsumeMessage, Options } from "amqplib";
import type { Outcome } from "./handle-delivery.js";
import { RETRY_HEADER } from "./retry.js";

export interface SettleChannel {
  ack(message: ConsumeMessage): void;
  nack(message: ConsumeMessage, allUpTo?: boolean, requeue?: boolean): void;
  publish(exchange: string, routingKey: string, content: Buffer, options: Options.Publish): Promise<unknown>;
}

export async function settle(
  channel: SettleChannel,
  message: ConsumeMessage,
  outcome: Outcome,
  retryQueue: string,
) {
  if (outcome.kind === "ack") return channel.ack(message);
  if (outcome.kind === "dead-letter") return channel.nack(message, false, false);

  const { headers, messageId, contentType } = message.properties;
  await channel.publish("", retryQueue, message.content, {
    persistent: true,
    expiration: String(outcome.delayMs),
    headers: { ...headers, [RETRY_HEADER]: outcome.attempt },
    contentType,
    messageId,
  });
  channel.ack(message);
}
