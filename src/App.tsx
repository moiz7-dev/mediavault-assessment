import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyMessage } from '@/api/errors';
import { ErrorBoundary } from '@/ErrorBoundary';
import { patchAssetsInCache } from '@/features/assets/assetCache';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssetsQuery } from '@/features/assets/useAssetsQuery';
import { useBulkStatus, type BulkFailure } from '@/features/assets/useBulkStatus';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useOnlineStatus } from '@/lib/useOnlineStatus';
import { useUrlState } from '@/lib/useUrlState';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetStatus, AssetQuery } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

interface UrlFilters {
  [key: string]: string;
  q: string;
  status: string;
  sort: string;
}

const URL_DEFAULTS: UrlFilters = { q: '', status: '', sort: 'updatedAt:desc' };

interface BulkOutcome {
  status: AssetStatus;
  succeededCount: number;
  failures: BulkFailure[];
}

/** legal_hold and not_found can never succeed on retry; only conflict (a random ~7%) can. */
function isRetryableFailure(code: string): boolean {
  return code !== 'legal_hold' && code !== 'not_found';
}

function describeBulkFailure(code: string): string {
  switch (code) {
    case 'legal_hold':
      return 'on legal hold — cannot be changed this way';
    case 'conflict':
      return 'changed by someone else at the same time';
    case 'not_found':
      return 'no longer exists';
    default:
      return "didn't save";
  }
}

export function App() {
  const isOnline = useOnlineStatus();
  const [filters, setFilters] = useUrlState(URL_DEFAULTS);

  // The input box updates instantly; only the debounced value feeds the URL and the API,
  // so ordinary typing never fires a request or a history write per keystroke.
  const [qInput, setQInput] = useState(filters.q);
  const debouncedQ = useDebouncedValue(qInput, 400);

  useEffect(() => {
    setFilters({ q: debouncedQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // replaceState (used by useUrlState) never fires popstate, so this only ever runs for
  // real back/forward navigation — it can't fight the effect above.
  useEffect(() => {
    const onPopState = () => setQInput(new URLSearchParams(window.location.search).get('q') ?? '');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const statusList = useMemo(
    () => (filters.status ? (filters.status.split(',') as AssetStatus[]) : []),
    [filters.status],
  );
  const sort = (filters.sort || URL_DEFAULTS.sort) as NonNullable<AssetQuery['sort']>;

  const assetQuery: AssetQuery = {
    q: debouncedQ || undefined,
    status: statusList.length ? statusList : undefined,
    sort,
    limit: 24,
  };

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkOutcome | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);

  const {
    items,
    total,
    isLoading,
    isError,
    error,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useAssetsQuery(assetQuery);

  const queryClient = useQueryClient();
  const bulkStatus = useBulkStatus(assetQuery);

  // Range selection needs the current loaded order and the last plain-clicked id, but must
  // not change identity when either does — toggleSelect stays stable so AssetCard's memo
  // still only re-renders the one card whose own props actually changed.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const anchorIdRef = useRef<string | null>(null);

  function setStatusFilter(next: AssetStatus[]) {
    setFilters({ status: next.join(',') });
  }

  // baseSelectionRef snapshots the selection as of the last *non-shift* action, so a run of
  // shift-click/shift-arrow extensions grows and shrinks relative to that same fixed point
  // (moving back past the anchor un-selects) instead of only ever accumulating.
  const baseSelectionRef = useRef<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      if (shiftKey && anchorIdRef.current) {
        const ids = itemsRef.current.map((a) => a.id);
        const from = ids.indexOf(anchorIdRef.current);
        const to = ids.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          const next = new Set(baseSelectionRef.current);
          for (let i = lo; i <= hi; i++) next.add(ids[i]!);
          return next;
        }
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      baseSelectionRef.current = next;
      anchorIdRef.current = id;
      return next;
    });
  }, []);

  const openAsset = useCallback((id: string) => setActiveId(id), []);
  const loadMore = useCallback(() => fetchNextPage(), [fetchNextPage]);
  const selectAllLoaded = useCallback(() => {
    const all = new Set(itemsRef.current.map((a) => a.id));
    baseSelectionRef.current = all;
    setSelectedIds(all);
  }, []);
  const clearSelection = useCallback(() => {
    baseSelectionRef.current = new Set();
    anchorIdRef.current = null;
    setSelectedIds(new Set());
  }, []);

  async function applyBulkStatus(next: AssetStatus, idsOverride?: string[]) {
    const ids = idsOverride ?? [...selectedIds];
    if (ids.length === 0) return;
    setBulkOutcome(null);
    setBulkApplying(true);
    try {
      const result = await bulkStatus.apply(ids, next);
      setBulkOutcome({ status: next, succeededCount: result.succeededIds.length, failures: result.failures });
      // Leave only the still-unresolved (failed) ones selected — a visual "these still need
      // attention" cue, and lets the bulk bar itself serve as a second way to retry.
      const stillSelected = new Set(result.failures.map((f) => f.id));
      baseSelectionRef.current = stillSelected;
      setSelectedIds(stillSelected);
    } finally {
      setBulkApplying(false);
    }
  }

  function retryFailed() {
    if (!bulkOutcome) return;
    const retryIds = bulkOutcome.failures.filter((f) => isRetryableFailure(f.code)).map((f) => f.id);
    if (retryIds.length === 0) return;
    void applyBulkStatus(bulkOutcome.status, retryIds);
  }

  function handleSaved(asset: Asset) {
    patchAssetsInCache(queryClient, ['assets', assetQuery], new Map([[asset.id, asset]]));
  }

  const retryableFailureCount = bulkOutcome
    ? bulkOutcome.failures.filter((f) => isRetryableFailure(f.code)).length
    : 0;
  const itemsById = useMemo(() => new Map(items.map((a) => [a.id, a])), [items]);

  // A single polite live region for everything worth announcing. Deliberately keyed on the
  // isLoading/isError *transition*, not on items/total directly — a background page load from
  // scrolling (isFetchingNextPage) or a silent refetch must not re-announce on every page,
  // only a genuine new search/filter result landing or failing.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (isError) setAnnouncement(friendlyMessage(error));
    else if (!isLoading) setAnnouncement(`${items.length} of ${total.toLocaleString()} assets shown`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isError]);
  useEffect(() => {
    if (!bulkOutcome) return;
    setAnnouncement(
      `${bulkOutcome.succeededCount} set to ${statusLabel(bulkOutcome.status).toLowerCase()}${
        bulkOutcome.failures.length > 0 ? `, ${bulkOutcome.failures.length} failed` : ''
      }.`,
    );
  }, [bulkOutcome]);

  return (
    <div className="app">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {!isOnline && (
        <p className="offline-banner" role="status">
          You're offline. We'll stop sending requests and pick back up automatically once
          you're back.
        </p>
      )}

      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <select value={sort} onChange={(e) => setFilters({ sort: e.target.value })}>
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      <div className="filters">
        {STATUSES.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={statusList.includes(s)}
              onChange={(e) =>
                setStatusFilter(
                  e.target.checked ? [...statusList, s] : statusList.filter((x) => x !== s),
                )
              }
            />
            {statusLabel(s)}
          </label>
        ))}
        <button onClick={selectAllLoaded} disabled={items.length === 0}>
          Select all loaded ({items.length})
        </button>
        <span className="muted">
          {isLoading
            ? 'Loading…'
            : `${items.length} of ${total.toLocaleString()} shown${
                isFetching && !isFetchingNextPage ? ' · Updating…' : ''
              }`}
        </span>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} disabled={bulkApplying || !isOnline} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button disabled={bulkApplying} onClick={clearSelection}>
            Clear selection
          </button>
          {bulkApplying && <span className="muted">Applying…</span>}
        </div>
      )}

      {bulkOutcome && (
        <div className="bulk-outcome" role="status">
          <p>
            {bulkOutcome.succeededCount} set to {statusLabel(bulkOutcome.status).toLowerCase()}
            {bulkOutcome.failures.length > 0 && `, ${bulkOutcome.failures.length} failed`}.
          </p>
          {bulkOutcome.failures.length > 0 && (
            <>
              <ul className="bulk-outcome__list">
                {bulkOutcome.failures.slice(0, 8).map((f) => (
                  <li key={f.id}>
                    {itemsById.get(f.id)?.name ?? f.id} — {describeBulkFailure(f.code)}
                  </li>
                ))}
                {bulkOutcome.failures.length > 8 && <li>and {bulkOutcome.failures.length - 8} more…</li>}
              </ul>
              {retryableFailureCount > 0 && (
                <button disabled={bulkApplying || !isOnline} onClick={retryFailed}>
                  Retry {retryableFailureCount} failed
                </button>
              )}
            </>
          )}
          <button onClick={() => setBulkOutcome(null)}>Dismiss</button>
        </div>
      )}

      <main className="content">
        {isError ? (
          <div className="empty">
            <p className="error">{friendlyMessage(error)}</p>
            <button onClick={() => refetch()}>Try again</button>
          </div>
        ) : isLoading ? (
          <div className="empty">
            <p className="muted">Loading assets…</p>
          </div>
        ) : (
          <ErrorBoundary fallbackMessage="The grid hit a snag showing these assets.">
            <AssetGrid
              assets={items}
              selectedIds={selectedIds}
              activeId={activeId}
              onToggleSelect={toggleSelect}
              onOpen={openAsset}
              hasNextPage={!!hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={loadMore}
            />
          </ErrorBoundary>
        )}
        {activeId && (
          <ErrorBoundary fallbackMessage="This asset's details hit a snag.">
            <AssetDetail
              id={activeId}
              isOnline={isOnline}
              onClose={() => setActiveId(null)}
              onSaved={handleSaved}
            />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
