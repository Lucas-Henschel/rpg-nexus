// Quando uma mensagem falha: tentar de novo mais tarde ou desistir e mandar para a DLQ.

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type RetryDecision =
  { action: "retry"; attempt: number; delayMs: number } | { action: "dead-letter" };

/** Header que conta quantas vezes a mensagem já voltou pela fila de retry. */
export const RETRY_HEADER = "x-retry-count";

export function readRetryCount(headers: Record<string, unknown> | undefined): number {
  const value = Number(headers?.[RETRY_HEADER]);

  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** Espera dobrando a cada tentativa (1 s, 2 s, 4 s...), até o teto. */
export function decideRetry(policy: RetryPolicy, retriesSoFar: number): RetryDecision {
  if (retriesSoFar >= policy.maxRetries) {
    return { action: "dead-letter" };
  }

  const attempt = retriesSoFar + 1;
  const delayMs = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);

  return { action: "retry", attempt, delayMs };
}
