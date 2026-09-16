import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { Asset, AssetPage } from '@/lib/types';

/**
 * Patches specific assets, wherever they appear across an infinite query's already-fetched
 * pages, without refetching. Used for optimistic bulk updates, their rollback, and reflecting
 * a single-asset save back into the grid it came from.
 */
export function patchAssetsInCache(
  queryClient: QueryClient,
  queryKey: QueryKey,
  patches: Map<string, Partial<Asset>>,
): void {
  if (patches.size === 0) return;
  queryClient.setQueryData<InfiniteData<AssetPage>>(queryKey, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        items: page.items.map((asset) => {
          const patch = patches.get(asset.id);
          return patch ? { ...asset, ...patch } : asset;
        }),
      })),
    };
  });
}

export function readAssetsFromCache(
  queryClient: QueryClient,
  queryKey: QueryKey,
): Map<string, Asset> {
  const data = queryClient.getQueryData<InfiniteData<AssetPage>>(queryKey);
  const byId = new Map<string, Asset>();
  data?.pages.forEach((page) => page.items.forEach((asset) => byId.set(asset.id, asset)));
  return byId;
}
