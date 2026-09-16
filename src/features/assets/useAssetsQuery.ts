import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { listAssets } from '@/api/client';
import type { AssetQuery } from '@/lib/types';

/**
 * Cursor-paginated results for the current filters, loaded incrementally.
 *
 * `query` never carries a cursor — each distinct filter/sort combination gets its own
 * infinite-query cache entry starting from an empty page list. That's what makes
 * `stale_cursor` structurally unreachable: switching filters can't accidentally reuse a
 * cursor from a different query because the old query's pages live under a different key
 * entirely, not because we remembered to clear something.
 *
 * See useAssetsQuery's sibling note in App.tsx / SUBMISSION.md for cancellation and
 * de-duplication, which apply identically here.
 */
export function useAssetsQuery(query: AssetQuery) {
  const infinite = useInfiniteQuery({
    queryKey: ['assets', query],
    queryFn: ({ pageParam, signal }) => listAssets({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const items = infinite.data?.pages.flatMap((page) => page.items) ?? [];
  const total = infinite.data?.pages[0]?.total ?? 0;

  return { ...infinite, items, total };
}
