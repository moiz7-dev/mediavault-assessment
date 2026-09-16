import { useEffect, useMemo, useState } from 'react';
import { bulkSetStatus } from '@/api/client';
import { friendlyMessage } from '@/api/errors';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssetsQuery } from '@/features/assets/useAssetsQuery';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
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

export function App() {
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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useAssetsQuery({
    q: debouncedQ || undefined,
    status: statusList.length ? statusList : undefined,
    sort,
    limit: 24,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  function setStatusFilter(next: AssetStatus[]) {
    setFilters({ status: next.join(',') });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkStatus(next: AssetStatus) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setNotice(null);
    try {
      // Sends every selected id in one call, which the API refuses above 50.
      const result = await bulkSetStatus(ids, next);
      setNotice(`${result.applied} updated, ${result.failed} failed.`);
      setSelectedIds(new Set());
    } catch (err) {
      setNotice(friendlyMessage(err));
    }
  }

  function handleSaved(_asset: Asset) {
    // The list is not told that anything changed, so it shows stale rows.
  }

  return (
    <div className="app">
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
        <span className="muted">
          {isLoading
            ? 'Loading…'
            : `${items.length} of ${total.toLocaleString()} shown${isFetching ? ' · Updating…' : ''}`}
        </span>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}

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
          <AssetGrid
            assets={items}
            selectedIds={selectedIds}
            activeId={activeId}
            onToggleSelect={toggleSelect}
            onOpen={setActiveId}
          />
        )}
        {activeId && (
          <AssetDetail id={activeId} onClose={() => setActiveId(null)} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}
