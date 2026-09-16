import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listAssets } from '@/api/client';
import type { AssetQuery } from '@/lib/types';

/**
 * First page of results for the current filters.
 *
 * Cancellation: the `signal` TanStack Query hands the queryFn is forwarded to `fetch`.
 * When `query` changes (filters/search/sort), this query's cache key changes too, so the
 * previous key loses its only observer and TanStack Query aborts that in-flight fetch —
 * a slow response for an old query can never land after a newer one.
 *
 * De-duplication: two callers requesting the same key share one in-flight fetch; React's
 * StrictMode double-invoke in dev exercises exactly this path.
 *
 * `placeholderData: keepPreviousData` keeps the previous page on screen while a new query
 * is in flight instead of flashing to empty — `isFetching` distinguishes "showing stale
 * data while refreshing" from "this data is final" so the UI never claims a finished state
 * it hasn't reached, and `isPlaceholderData` tells the grid the rows it's showing belong to
 * the previous query, not this one.
 */
export function useAssetsQuery(query: AssetQuery) {
  return useQuery({
    queryKey: ['assets', query],
    queryFn: ({ signal }) => listAssets(query, signal),
    placeholderData: keepPreviousData,
  });
}
