import { expect, it } from "vitest";
import { createPublisher } from "../../src/messaging/publisher.js";

it("publica o envelope no exchange, persistente, com messageId e tipo", async () => {
  const sent: unknown[][] = [];
  const publish = createPublisher(
    {
      async publish(...args) {
        sent.push(args);
      },
    },
    "rpg.events",
  );

  await publish({
    messageId: "m1",
    type: "rpg.campaign.created.v1",
    routingKey: "campaign.created.v1",
    body: '{"messageId":"m1"}',
    headers: {},
    createdAt: "2026-11-19T12:00:00.000Z",
  });

  expect(sent).toEqual([
    [
      "rpg.events",
      "campaign.created.v1",
      Buffer.from('{"messageId":"m1"}'),
      expect.objectContaining({
        persistent: true,
        contentType: "application/json",
        messageId: "m1",
        type: "rpg.campaign.created.v1",
        headers: expect.any(Object),
      }),
    ],
  ]);
});
