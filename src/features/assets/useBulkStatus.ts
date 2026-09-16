import { useQueryClient } from '@tanstack/react-query';
import { bulkSetStatus } from '@/api/client';
import { withRetry } from '@/lib/retry';
import { patchAssetsInCache, readAssetsFromCache } from '@/features/assets/assetCache';
import type { AssetQuery, AssetStatus } from '@/lib/types';

/** Server hard cap for POST /api/assets/bulk-status. */
const CHUNK_SIZE = 50;
/** Bounded concurrency — the brief is explicit that 40 parallel requests is the wrong answer. */
const CONCURRENCY = 3;

export interface BulkFailure {
  id: string;
  code: string;
  message?: string;
}

export interface BulkApplyResult {
  succeededIds: string[];
  failures: BulkFailure[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Chunked, bounded-concurrency bulk status update with optimistic apply and precise rollback.
 *
 * Every id is set to `status` in the cache immediately, before any request completes. Each
 * chunk's real per-id result (200/207's `results` array) then either confirms that id with the
 * authoritative server copy, or rolls *only that id* back to whatever status it had before —
 * successes elsewhere in the same batch are untouched either way.
 */
export function useBulkStatus(query: AssetQuery) {
  const queryClient = useQueryClient();
  const queryKey = ['assets', query];

  async function apply(ids: string[], status: AssetStatus): Promise<BulkApplyResult> {
    const before = readAssetsFromCache(queryClient, queryKey);
    const originalStatus = new Map<string, AssetStatus>();
    for (const id of ids) {
      const asset = before.get(id);
      if (asset) originalStatus.set(id, asset.status);
    }

    // Optimistic: the grid shows the new status before any request has even been sent.
    patchAssetsInCache(queryClient, queryKey, new Map(ids.map((id) => [id, { status }])));

    const chunks = chunk(ids, CHUNK_SIZE);
    const chunkOutcomes = await mapWithConcurrency(chunks, CONCURRENCY, async (idsInChunk) => {
      try {
        return await withRetry(() => bulkSetStatus(idsInChunk, status));
      } catch (err) {
        // The whole chunk couldn't be attempted (e.g. offline, or retries exhausted on a
        // transient failure) — every id in it reverts, not just the ones the server rejected.
        const message = err instanceof Error ? err.message : 'Request failed.';
        return {
          applied: 0,
          failed: idsInChunk.length,
          results: idsInChunk.map((id) => ({ id, ok: false as const, code: 'request_failed', message })),
        };
      }
    });

    const succeededIds: string[] = [];
    const failures: BulkFailure[] = [];
    const settle = new Map<string, { status: AssetStatus }>();

    for (const outcome of chunkOutcomes) {
      for (const result of outcome.results) {
        if (result.ok) {
          succeededIds.push(result.id);
          settle.set(result.id, { status: result.asset.status });
        } else {
          failures.push({ id: result.id, code: result.code, message: result.message });
          const prevStatus = originalStatus.get(result.id);
          if (prevStatus) settle.set(result.id, { status: prevStatus });
        }
      }
    }

    patchAssetsInCache(queryClient, queryKey, settle);
    return { succeededIds, failures };
  }

  return { apply };
}
