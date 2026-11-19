// Relay da outbox: reserva os eventos pendentes, publica cada um no RabbitMQ e marca como publicado.
//
// Se o processo cair entre publicar e marcar, a reserva vence e o evento sai de novo: a entrega é
// at-least-once, e quem consome descarta a repetição pelo messageId. Com o RabbitMQ fora, os eventos
// esperam na outbox e saem quando a conexão volta.
import type { OutboxMessage } from "./outgoing.js";
import { untraced, withProducerSpan } from "../tracing/spans.js";

export interface RelayOutbox {
  claim(limit: number, leaseMs: number, now: Date): Promise<OutboxMessage[]>;
  markPublished(messageId: string, now: Date): Promise<void>;
}

type LogFn = (fields: object, message: string) => void;

export interface RelayOptions {
  outbox: RelayOutbox;
  /** Publica no RabbitMQ e só resolve depois da confirmação do broker. */
  publish: (message: OutboxMessage) => Promise<void>;
  isConnected: () => boolean;
  batchSize: number;
  leaseMs: number;
  intervalMs: number;
  log: { info: LogFn; warn: LogFn; error: LogFn };
  now?: () => Date;
}

export function createOutboxRelay({
  outbox,
  publish,
  isConnected,
  batchSize,
  leaseMs,
  intervalMs,
  log,
  now = () => new Date(),
}: RelayOptions) {
  /** Uma rodada: publica o que estiver pendente e devolve quantos eventos saíram. */
  async function runOnce(): Promise<number> {
    if (!isConnected()) {
      return 0;
    }

    const batch = await untraced(() => outbox.claim(batchSize, leaseMs, now()));
    let published = 0;

    for (const message of batch) {
      const { messageId, routingKey } = message;

      try {
        // O span continua o trace da requisição que gerou o evento.
        await withProducerSpan(
          routingKey,
          { "messaging.message.id": messageId },
          async () => {
            await publish(message);
            await outbox.markPublished(messageId, now());
          },
          message.headers,
        );
      } catch (err) {
        // O resto do lote continua reservado e sai quando a reserva vencer, na ordem.
        log.warn({ err, messageId, routingKey }, "campaigns.outbox.publish_failed");

        return published;
      }

      published++;
      log.info({ messageId, routingKey }, "campaigns.outbox.published");
    }

    return published;
  }

  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> | undefined;
  let stopped = false;

  async function tick() {
    let published = 0;

    try {
      published = await runOnce();
    } catch (err) {
      // DynamoDB fora ou lento: tenta de novo na próxima rodada.
      log.error({ err }, "campaigns.outbox.cycle_failed");
    }

    if (!stopped) {
      // Lote cheio: ainda tem fila, segue sem esperar.
      timer = setTimeout(run, published >= batchSize ? 0 : intervalMs);
    }
  }

  function run() {
    current = tick();
  }

  return {
    runOnce,

    start() {
      stopped = false;
      run();
    },

    /** Para de procurar eventos e espera a rodada em andamento terminar. */
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}
