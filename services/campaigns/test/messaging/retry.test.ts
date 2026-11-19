import { expect, it } from "vitest";
import { decideRetry, readRetryCount } from "../../src/messaging/retry.js";

const policy = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 15000 };

it("espera 1000, 2000, 4000 ms e manda para a DLQ na 4ª falha", () => {
  expect(decideRetry(policy, 0)).toEqual({ action: "retry", attempt: 1, delayMs: 1000 });
  expect(decideRetry(policy, 1)).toEqual({ action: "retry", attempt: 2, delayMs: 2000 });
  expect(decideRetry(policy, 2)).toEqual({ action: "retry", attempt: 3, delayMs: 4000 });
  expect(decideRetry(policy, 3)).toEqual({ action: "dead-letter" });
});

it("não espera mais que o teto", () => {
  expect(decideRetry({ ...policy, maxRetries: 10 }, 7)).toEqual({
    action: "retry",
    attempt: 8,
    delayMs: 15000,
  });
});

it("readRetryCount: ausente ou inválido vale 0", () => {
  expect(readRetryCount(undefined)).toBe(0);
  expect(readRetryCount({})).toBe(0);
  expect(readRetryCount({ "x-retry-count": "abc" })).toBe(0);
  expect(readRetryCount({ "x-retry-count": -2 })).toBe(0);
  expect(readRetryCount({ "x-retry-count": 2 })).toBe(2);
});
