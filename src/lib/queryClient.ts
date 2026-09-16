import { QueryClient } from '@tanstack/react-query';
import { backoffDelay, shouldRetry } from '@/lib/retry';

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
