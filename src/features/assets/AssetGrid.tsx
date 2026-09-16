import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

const MIN_CARD_WIDTH = 220;
const GAP = 12;

interface CardProps {
  asset: Asset;
  selected: boolean;
  active: boolean;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
}

/**
 * Memoized so a selection toggle only re-renders the one card whose `selected` prop
 * actually changed — every other card gets the same props it had last render and React
 * bails out. See SUBMISSION.md "Performance" for the measured before/after.
 */
export const AssetCard = memo(function AssetCard({
  asset,
  selected,
  active,
  onToggleSelect,
  onOpen,
}: CardProps) {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __mvRenderCounts?: Map<string, number> };
    w.__mvRenderCounts ??= new Map();
    w.__mvRenderCounts.set(asset.id, (w.__mvRenderCounts.get(asset.id) ?? 0) + 1);
  }

  const [broken, setBroken] = useState(false);
  const showPlaceholder = !asset.hasThumbnail || broken;
  const shiftKeyRef = useRef(false);

  return (
    <div
      className={'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '')}
      onClick={() => onOpen(asset.id)}
    >
      {showPlaceholder ? (
        <div className="card__thumb card__thumb--placeholder" aria-hidden="true">
          <span className="muted">No preview</span>
        </div>
      ) : (
        <img
          className="card__thumb"
          src={thumbnailUrl(asset.id)}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      )}
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <span className={`pill pill--${asset.status}`}>{statusLabel(asset.status)}</span>
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={selected}
        onClick={(e) => {
          // Let the native toggle happen (fighting it with preventDefault desynced React's
          // controlled `checked` from the DOM in testing) — just stop it opening the card,
          // and stash the modifier key for the onChange that follows in the same tick.
          e.stopPropagation();
          shiftKeyRef.current = e.shiftKey;
        }}
        onChange={() => onToggleSelect(asset.id, shiftKeyRef.current)}
      />
    </div>
  );
});

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

/**
 * Row-virtualized grid: only rows near the viewport are mounted, so DOM node count stays
 * bounded by viewport size regardless of how many of the 12,400 assets have been fetched.
 * Row height is measured (not guessed), so real content never causes layout shift once
 * placed — only the very first paint of a row uses `estimateSize` as a placeholder.
 */
export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = entry.contentRect.width;
      setColumns(Math.max(1, Math.floor((width + GAP) / (MIN_CARD_WIDTH + GAP))));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rowCount = Math.ceil(assets.length / columns);
  const virtualRowCount = hasNextPage ? rowCount + 1 : rowCount;

  // getScrollElement/estimateSize must stay referentially stable across renders — a new
  // function identity each render makes the virtualizer tear down and reinitialize its
  // internal scroll-element subscription on every render.
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => 268, []);

  const rowVirtualizer = useVirtualizer({
    count: virtualRowCount,
    getScrollElement,
    estimateSize,
    overscan: 4,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  // Index of the last row actually rendered this pass (not just virtualRows[length-1], which
  // is a new object every call) — used as a primitive so the load-more effect below only
  // re-runs when the visible range genuinely changes, not on every unrelated re-render.
  const lastRenderedIndex = virtualRows.length ? virtualRows[virtualRows.length - 1]!.index : -1;

  useEffect(() => {
    if (lastRenderedIndex >= rowCount - 1 && hasNextPage && !isFetchingNextPage) {
      onLoadMore();
    }
  }, [lastRenderedIndex, rowCount, hasNextPage, isFetchingNextPage, onLoadMore]);

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search box or widen the status filter.</p>
      </div>
    );
  }

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualRows.map((virtualRow) => {
          const isLoaderRow = virtualRow.index >= rowCount;
          const start = virtualRow.index * columns;
          const rowItems = isLoaderRow ? [] : assets.slice(start, start + columns);
          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="grid-row"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {isLoaderRow ? (
                <p className="grid-loading-more muted">Loading more…</p>
              ) : (
                rowItems.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    selected={selectedIds.has(asset.id)}
                    active={activeId === asset.id}
                    onToggleSelect={onToggleSelect}
                    onOpen={onOpen}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
