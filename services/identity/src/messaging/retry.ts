export const RETRY_HEADER = "x-retry-count";

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function readRetryCount(headers: Record<string, unknown> | undefined): number {
  const value = Number(headers?.[RETRY_HEADER]);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function decideRetry(policy: RetryPolicy, retriesSoFar: number) {
  if (retriesSoFar >= policy.maxRetries) return { action: "dead-letter" as const };
  const attempt = retriesSoFar + 1;
  return {
    action: "retry" as const,
    attempt,
    delayMs: Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs),
  };
}
