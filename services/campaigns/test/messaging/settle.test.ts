import type { ConsumeMessage } from "amqplib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requeueLater, settle, type SettleChannel } from "../../src/messaging/settle.js";

const RETRY_QUEUE = "campaigns.activity.v1.retry";

const message = {
  content: Buffer.from('{"messageId":"m1"}'),
  fields: { deliveryTag: 7 },
  properties: {
    messageId: "m1",
    contentType: "application/json",
    headers: { traceparent: "antigo", "x-retry-count": 1 },
  },
} as unknown as ConsumeMessage;

/** Canal falso que guarda a ordem das chamadas. */
function fakeChannel(publish: () => Promise<unknown> = async () => true) {
  const calls: string[] = [];

  const channel = {
    ack: vi.fn(() => {
      calls.push("ack");
    }),
    nack: vi.fn(() => {
      calls.push("nack");
    }),
    publish: vi.fn(async () => {
      calls.push("publish");
      return publish();
    }),
  } satisfies SettleChannel;

  return { channel, calls };
}

describe("settle", () => {
  it("ack: confirma a mensagem", async () => {
    const { channel, calls } = fakeChannel();

    await settle(
      channel,
      message,
      { kind: "ack", campaignId: "c1", result: "applied" },
      RETRY_QUEUE,
    );

    expect(calls).toEqual(["ack"]);
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it("retry: publica na fila de retry com a espera e a tentativa, e só então confirma", async () => {
    const { channel, calls } = fakeChannel();

    await settle(
      channel,
      message,
      { kind: "retry", attempt: 2, delayMs: 2000, reason: "timeout" },
      RETRY_QUEUE,
    );

    expect(calls).toEqual(["publish", "ack"]);
    expect(channel.publish).toHaveBeenCalledWith("", RETRY_QUEUE, message.content, {
      persistent: true,
      expiration: "2000",
      headers: { traceparent: "antigo", "x-retry-count": 2 },
      contentType: "application/json",
      messageId: "m1",
    });
  });

  it("retry: se a publicação falha, não confirma (a mensagem não se perde)", async () => {
    const { channel, calls } = fakeChannel(async () => {
      throw new Error("canal fechado");
    });

    await expect(
      settle(
        channel,
        message,
        { kind: "retry", attempt: 2, delayMs: 2000, reason: "x" },
        RETRY_QUEUE,
      ),
    ).rejects.toThrow("canal fechado");

    expect(calls).toEqual(["publish"]);
  });

  it("dead-letter: recusa sem devolver à fila (vai para a DLQ)", async () => {
    const { channel } = fakeChannel();

    await settle(channel, message, { kind: "dead-letter", reason: "inválida" }, RETRY_QUEUE);

    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});

describe("requeueLater", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("devolve a mensagem à fila só depois da espera", () => {
    vi.useFakeTimers();
    const { channel } = fakeChannel();

    requeueLater(channel, message, 1000, () => {});

    vi.advanceTimersByTime(999);
    expect(channel.nack).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  });

  it("canal já fechado: não derruba o processo, só avisa (o RabbitMQ reentrega)", () => {
    vi.useFakeTimers();
    const { channel } = fakeChannel();
    const failure = new Error("Channel closed");
    channel.nack.mockImplementation(() => {
      throw failure;
    });
    const onError = vi.fn();

    requeueLater(channel, message, 1000, onError);

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
