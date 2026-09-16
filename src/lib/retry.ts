import { ApiError, isRetryable } from '@/api/errors';

/** Hard cap on retry attempts — a retry storm is exactly what the rate limiter punishes. */
export const MAX_RETRIES = 4;

/** Shared by queryClient.ts (for useQuery/useMutation) and withRetry (for one-off calls). */
export function backoffDelay(attempt: number, error: unknown): number {
  // Honour Retry-After exactly (plus a touch of jitter) rather than second-guessing the server.
  if (error instanceof ApiError && error.retryAfterSec != null) {
    return error.retryAfterSec * 1000 + Math.random() * 300;
  }
  // Exponential backoff with equal jitter (50%-100% of the exponential ceiling), capped at 8s.
  const ceiling = Math.min(500 * 2 ** attempt, 8000);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  return isRetryable(error);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Applies the same retry/backoff policy as the query client to a one-off async call that
 * isn't itself a useQuery/useMutation — used for the raw bulk-status chunk requests, which
 * are orchestrated by hand (chunking + bounded concurrency) rather than by React Query.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!shouldRetry(attempt, err)) throw err;
      await sleep(backoffDelay(attempt, err));
      attempt++;
    }
  }
}
