// A conexão com o RabbitMQ, dividida pelo consumidor e pelo publisher da outbox. Reconecta sozinha.
import amqp, { type AmqpConnectionManager } from "amqp-connection-manager";
import type { FastifyBaseLogger } from "fastify";

export function connectRabbit(url: string, log: FastifyBaseLogger): AmqpConnectionManager {
  const connection = amqp.connect([url]);

  connection.on("connect", () => log.info("rabbitmq.connected"));
  connection.on("disconnect", ({ err }) => log.warn({ err }, "rabbitmq.disconnected"));
  // Endereço ou senha errados, broker fora: sem este log o serviço tentaria em silêncio.
  connection.on("connectFailed", ({ err }) => log.warn({ err }, "rabbitmq.connect_failed"));

  return connection;
}
