import { ApiError, NetworkError, isAbortError } from '@/api/errors';
import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.kind?.length) params.set('kind', query.kind.join(','));
  if (query.tag?.length) params.set('tag', query.tag.join(','));
  if (query.collectionId) params.set('collectionId', query.collectionId);
  if (query.owner) params.set('owner', query.owner);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new NetworkError();
  }

  if (!res.ok) {
    let code = 'unknown';
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      /* response was not JSON */
    }
    const retryAfterHeader = res.headers.get('retry-after');
    throw new ApiError(res.status, code, message, retryAfterHeader ? Number(retryAfterHeader) : null);
  }

  return res.json() as Promise<T>;
}

export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, { signal });
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, { signal });
}

export function getAssetsByIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ items: Asset[]; missing: string[] }> {
  // Note: the endpoint rejects more than 25 ids per call — callers must chunk.
  return request(`/api/assets/batch?ids=${ids.join(',')}`, { signal });
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, patch }),
  });
}

export function bulkSetStatus(ids: string[], status: Asset['status']): Promise<BulkResult> {
  // Note: the endpoint rejects more than 50 ids per call — callers must chunk.
  return request<BulkResult>('/api/assets/bulk-status', {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
