import { QueryClient } from '@tanstack/react-query';
import { ApiError, isRetryable } from '@/api/errors';

/** Hard cap on retry attempts — a retry storm is exactly what the rate limiter punishes. */
const MAX_RETRIES = 4;

function backoffDelay(attempt: number, error: unknown): number {
  // Honour Retry-After exactly (plus a touch of jitter) rather than second-guessing the server.
  if (error instanceof ApiError && error.retryAfterSec != null) {
    return error.retryAfterSec * 1000 + Math.random() * 300;
  }
  // Exponential backoff with equal jitter (50%-100% of the exponential ceiling), capped at 8s.
  const ceiling = Math.min(500 * 2 ** attempt, 8000);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  return isRetryable(error);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      retryDelay: backoffDelay,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
    mutations: {
      retry: shouldRetry,
      retryDelay: backoffDelay,
    },
  },
});
