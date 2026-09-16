import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import { StatusBadge } from '@/features/assets/StatusBadge';
import type { Asset } from '@/lib/types';

const MIN_CARD_WIDTH = 220;
const GAP = 12;

interface CardProps {
  asset: Asset;
  index: number;
  tabIndex: 0 | -1;
  selected: boolean;
  active: boolean;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onOpen: (index: number) => void;
  onFocusCard: (index: number) => void;
  registerRef: (index: number, el: HTMLDivElement | null) => void;
}

/**
 * Memoized so a selection toggle only re-renders the one card whose `selected` prop
 * actually changed — every other card gets the same props it had last render and React
 * bails out. See SUBMISSION.md "Performance" for the measured before/after.
 */
export const AssetCard = memo(function AssetCard({
  asset,
  index,
  tabIndex,
  selected,
  active,
  onToggleSelect,
  onOpen,
  onFocusCard,
  registerRef,
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
      ref={(el) => registerRef(index, el)}
      className={'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '')}
      role="gridcell"
      tabIndex={tabIndex}
      aria-selected={selected}
      aria-label={`${asset.name}, ${statusLabel(asset.status)}${selected ? ', selected' : ''}`}
      onFocus={() => onFocusCard(index)}
      onClick={() => onOpen(index)}
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
        <StatusBadge status={asset.status} />
      </div>
      <input
        type="checkbox"
        className="card__check"
        tabIndex={-1}
        aria-label={`Select ${asset.name}`}
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
 *
 * Keyboard model: a single roving tabindex over `assets` (one card is tabbable at a time;
 * Tab moves in and out of the grid as one stop, arrows move within it). Moving focus past the
 * edge of what's currently mounted asks the virtualizer to scroll that row into view first,
 * then focuses the card once it exists in the DOM.
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

  // --- Keyboard / roving tabindex -----------------------------------------------------
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const [focusedIndex, setFocusedIndex] = useState(0);
  const cardNodesRef = useRef(new Map<number, HTMLDivElement>());
  const pendingFocusRef = useRef<number | null>(null);
  const lastOpenerIndexRef = useRef<number | null>(null);

  const registerRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) cardNodesRef.current.set(index, el);
    else cardNodesRef.current.delete(index);
  }, []);

  const focusIndexWhenMounted = useCallback((index: number) => {
    pendingFocusRef.current = index;
    let attempts = 0;
    const tryFocus = () => {
      const node = cardNodesRef.current.get(index);
      if (node) {
        node.focus();
        pendingFocusRef.current = null;
        return;
      }
      attempts += 1;
      if (attempts < 12) requestAnimationFrame(tryFocus);
    };
    tryFocus();
  }, []);

  const openIndex = useCallback(
    (index: number) => {
      const asset = assetsRef.current[index];
      if (!asset) return;
      lastOpenerIndexRef.current = index;
      onOpen(asset.id);
    },
    [onOpen],
  );

  const moveFocus = useCallback(
    (rawIndex: number, extendSelection: boolean) => {
      const list = assetsRef.current;
      const index = Math.max(0, Math.min(list.length - 1, rawIndex));
      setFocusedIndex(index);
      rowVirtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' });
      focusIndexWhenMounted(index);
      if (extendSelection) {
        const asset = list[index];
        if (asset) onToggleSelect(asset.id, true);
      }
    },
    [columns, focusIndexWhenMounted, onToggleSelect, rowVirtualizer],
  );

  const handleFocusCard = useCallback((index: number) => setFocusedIndex(index), []);

  function handleGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(focusedIndex + 1, e.shiftKey);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(focusedIndex - 1, e.shiftKey);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(focusedIndex + columns, e.shiftKey);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(focusedIndex - columns, e.shiftKey);
        break;
      case 'Enter':
        e.preventDefault();
        openIndex(focusedIndex);
        break;
      case ' ':
      case 'Spacebar': {
        e.preventDefault();
        const asset = assetsRef.current[focusedIndex];
        if (asset) onToggleSelect(asset.id, e.shiftKey);
        break;
      }
      default:
        break;
    }
  }

  // Return focus to the card that opened the panel once it closes (any way it closes). No
  // scrollToIndex here on purpose: closing the panel returns the grid to the width (and so the
  // same column count and scroll position) it had before opening, so the card is already where
  // it was — forcing a scroll using `columns` here raced the ResizeObserver that updates it for
  // the just-reverted width, computing the wrong row and discarding the preserved scroll offset.
  useEffect(() => {
    if (activeId !== null || lastOpenerIndexRef.current === null) return;
    const index = lastOpenerIndexRef.current;
    lastOpenerIndexRef.current = null;
    setFocusedIndex(index);
    focusIndexWhenMounted(index);
  }, [activeId, focusIndexWhenMounted]);

  // A genuinely new result set (filter/search/sort changed, not just another page loading in)
  // resets keyboard focus and scroll to the top — detected by the first id changing, since
  // pagination only ever appends past the end.
  const firstAssetIdRef = useRef<string | undefined>(assets[0]?.id);
  useEffect(() => {
    if (assets[0]?.id !== firstAssetIdRef.current) {
      firstAssetIdRef.current = assets[0]?.id;
      setFocusedIndex(0);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    } else if (focusedIndex > assets.length - 1) {
      // The list shrank under the current focus (e.g. a filter now excludes it) — move focus
      // to the new last item rather than leaving it pointing at a row that no longer exists.
      setFocusedIndex(Math.max(0, assets.length - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search box or widen the status filter.</p>
      </div>
    );
  }

  return (
    <div
      className="grid-scroll"
      ref={scrollRef}
      role="grid"
      aria-label="Assets"
      aria-multiselectable="true"
      onKeyDown={handleGridKeyDown}
    >
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
              role={isLoaderRow ? undefined : 'row'}
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
                rowItems.map((asset, i) => {
                  const index = start + i;
                  return (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      index={index}
                      tabIndex={index === focusedIndex ? 0 : -1}
                      selected={selectedIds.has(asset.id)}
                      active={activeId === asset.id}
                      onToggleSelect={onToggleSelect}
                      onOpen={openIndex}
                      onFocusCard={handleFocusCard}
                      registerRef={registerRef}
                    />
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
