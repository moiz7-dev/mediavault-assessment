# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:**

---

## How to run it

Nothing beyond the README: `node >= 20.11`, `npm install`, `npm run dev`. That
starts the mock API on `:8787` and the app on `:5173` (Vite proxies `/api`).
Chaos and latency are on by default; use `CHAOS=0 npm run dev:api` /
`LATENCY=0 npm run dev:api` only while developing, never for the submitted
build.

## Time spent

Roughly, and how you split it.

---

## Baseline defects found

Found by reading `src/` against `API.md` and confirming each against the
running app with chaos on, before changing any code.

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends every selected id in one call; the API caps bulk-status at 50 ids and returns `400 too_many_ids` past that | `App.tsx` (`applyBulkStatus`) | Fixed — Task 3 |
| 2 | `useAssets` never cancels the in-flight request on re-run. Two queries can resolve out of order (the API is deliberately slower for short/broad queries) and whichever *response* lands last wins, even if its *request* was sent first — classic stale-response race | `useAssets.ts` | Fixed — Task 1 |
| 3 | Every keystroke in the search box fires a request immediately — no debounce/throttle. Typing a 6-character query can fire 6 requests, and ordinary typing can trip the 80-req/10s rate limit on its own | `App.tsx`, `useAssets.ts` | Fixed — Task 1 |
| 4 | Identical concurrent requests are not de-duplicated — StrictMode double-invocation or rapid re-renders can send the same query twice | `useAssets.ts` | Fixed — Task 1 |
| 5 | Filter/search/sort state lives only in component `useState` — never in the URL. Reloading or sharing the URL loses the current view entirely | `App.tsx` | Fixed — Task 1 |
| 6 | `nextCursor` is fetched but discarded — there is no pagination at all. The grid only ever shows the first `limit` (24) rows regardless of `total`, so most of the 12,400-asset library is unreachable | `useAssets.ts`, `App.tsx` | Fixed — Task 2 |
| 7 | The grid renders every item it is given with no virtualization. Once pagination is fixed and thousands of rows accumulate, DOM node count (and memory) grows without bound instead of staying flat at viewport size | `AssetGrid.tsx` | Fixed — Task 2 |
| 8 | Toggling one card's selection re-renders every card in the grid — `selectedIds` is a brand-new `Set` on every toggle and is passed whole to a non-memoized child, so React can't bail out on the rest | `AssetGrid.tsx`, `App.tsx` | Fixed — Task 2/3 |
| 9 | Thumbnails have no lazy-loading and no handling for the ~4% that 404 (`hasThumbnail: false` is on every asset and ignored) — a missing thumbnail shows a broken-image icon instead of a stable placeholder | `AssetGrid.tsx`, `AssetDetail.tsx` | Fixed — Task 2 |
| 10 | `request()` flattens every failure into a single `Error(string)`. Callers cannot structurally tell a retryable `503`/`500`/`429` apart from a terminal `400`/`409`/`422` without parsing the message text | `api/client.ts` | Fixed — Task 4 |
| 11 | No retry logic anywhere in the client — a single transient `503` (read) or `500` (write), both of which the API explicitly documents as safe/expected to retry, is surfaced to the user as a hard failure on the first attempt | `api/client.ts` | Fixed — Task 4 |
| 12 | `AssetDetail`'s `onSaved` callback is a documented no-op (`// The list is not told that anything changed`). Editing an asset's status in the panel leaves the grid showing the stale row underneath | `App.tsx` | Fixed — Task 3 |
| 13 | `409 version_conflict` from a single-asset PATCH is shown as a generic error string with no recovery path — no refetch-and-retry, no indication the row changed underneath the user | `AssetDetail.tsx` | Fixed — Task 3 |
| 14 | Loading/empty/error states collide: on a failed request the hook spreads previous state (so stale rows can sit under an error banner), and on a genuine empty result set the grid's "Nothing matches" empty state and a request failure look identical to a user because errors aren't distinguished before rendering the grid | `useAssets.ts`, `App.tsx`, `AssetGrid.tsx` | Fixed — Task 1 |
| 15 | Cards are plain `div`s reachable only by mouse — no `tabIndex`, no keyboard handlers, no roving tabindex. 12,400 assets means 12,400 unreachable rows for a keyboard-only user | `AssetGrid.tsx` | Fixed — Task 5 |
| 16 | Opening the detail panel doesn't move focus into it and closing doesn't return focus to the card that opened it; there's no `Escape` handler | `AssetDetail.tsx`, `App.tsx` | Fixed — Task 5 |
| 17 | No live region anywhere — result counts, bulk-action outcomes and errors are visual only and silent to a screen reader | `App.tsx` | Fixed — Task 5 |
| 18 | No error boundary in the tree — an unexpected render error (e.g. a malformed asset) blanks the entire app instead of failing one component | `main.tsx` | Fixed — Task 4 |
| 19 | Bulk status has no chunking or concurrency control and no per-id failure detail in the UI — one request for all ids, and the result is only a count (`"1 updated, 1 failed"`), never *which* ids failed or why | `App.tsx` | Fixed — Task 3 |

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**

TanStack Query, not a hand-rolled `useEffect` fetcher. It gives three of Task 1's
requirements for free as long as the `queryFn` forwards the `AbortSignal` it's
handed to `fetch`: per-key request de-duplication, cancellation of a query's
in-flight fetch when it loses its last observer (i.e. when the filters change),
and a `retry`/`retryDelay` hook that receives the actual error object, not just
a boolean — which is what makes the Task 4 backoff policy structural instead of
string-matched. Chose it over SWR mainly for `useInfiniteQuery`'s explicit
`pageParam`/`getNextPageParam` shape, which maps directly onto this API's
opaque-cursor contract (Task 2).

**Stale response handling**

Two layers, deliberately not just one:
1. **Debounce (400ms)** on the search input before it touches the query key or
   the URL at all — see `useDebouncedValue.ts` for the exact reasoning. This is
   the main defense against request volume (a 6-character query is 1 request,
   not 6) and against ever sending the API's slowest path (1-2 char prefixes)
   for a query the user was only passing through.
2. **Per-key cache isolation** — verified against the exact repro in the
   README (`tra` → `trail`): even when the `tra` request is still in flight
   when `trail`'s fires, `trail`'s response can never be overwritten by a late
   `tra` response, because they're different cache entries and the component
   only ever reads the entry for its *current* query key. Confirmed with a
   scripted Playwright run typing through the race with the `tra` request
   deliberately left in flight — final rendered rows and URL both reflect
   `trail` regardless of which HTTP response lands first. This holds even if
   cancellation didn't fire at all, which is a stronger guarantee than a manual
   `AbortController` + "ignore stale response" flag would give.

Cancellation still happens where it can (confirmed via the network log — a
superseded query's fetch shows `net::ERR_ABORTED`), which is what stops "no
longer wanted" requests from continuing to burn the 80-req/10s budget.

**Virtualization approach**

Row-based, via `@tanstack/react-virtual`, wrapping `useInfiniteQuery`'s cursor
pagination: each virtual "row" is a CSS grid strip of N cards (N computed from
container width via `ResizeObserver`, matching the old `auto-fill` behaviour),
absolutely positioned with a measured (not guessed) height via
`measureElement`, so real content never causes layout shift once placed — only
a row's very first paint uses the `estimateSize` guess. A sentinel "loading
more" row is appended to the virtual count whenever `hasNextPage` is true;
fetching the next page is triggered by an effect keyed on the *primitive*
index of the last rendered row, not the row object itself — an early version
kept the row object in the effect's dependency array, and since
`getVirtualItems()` returns a new array/objects on every call, that re-ran the
effect (and could re-fire `fetchNextPage`) on every unrelated render, not just
when the visible range actually changed.

`getScrollElement`/`estimateSize` are memoized with `useCallback`. During
development an unmemoized version briefly looked like it was resetting scroll
position to 0 on every re-render; that turned out to be a false alarm from the
*test tooling*, not the app — Playwright's `locator.click()` auto-scrolls its
target into view before clicking, and the checkbox/card `.first()` in my test
script kept resolving to a row that was scrolled out of view. A raw
`element.click()` in the page (no test-driver scrolling) proved scroll
position was fine all along. Memoizing the callbacks is still correct practice
for `useVirtualizer` and is kept.

**Optimistic updates and rollback**

*(Task 3)*

**Optimistic updates and rollback**

*(Task 3)*

**Retry and backoff policy**

Landed earlier than Task 4 proper because Task 1 needed it: without a retry,
the ~6% baseline `503` rate on `GET /api/assets` would surface as a visible
error on roughly 1 in 17 searches, which fails Task 1's "loading/empty/error
must be distinguishable and correct" bar on its own. `queryClient.ts` centralises
it: `retryDelay` honours `Retry-After` exactly (plus a small jitter) when the
server gives one, otherwise exponential backoff with equal jitter (50-100% of
`min(500 * 2^attempt, 8000)`ms); `retry` checks `ApiError.retryable`, which is
computed structurally from HTTP status (`429`/`503`/`500` only) in
`api/errors.ts` — never from message text. Capped at 4 attempts. Task 4 extends
this to mutations, offline detection, and an error boundary.

**State placement and URL sync**

`q` (debounced), `status` and `sort` live in the URL via a small hand-rolled
`useUrlState` hook rather than a router — this app has exactly one screen, so
React Router's route matching would be pure overhead for what is really just
`URLSearchParams` synced with component state. Always uses `history.replaceState`,
never `pushState`: filter and search changes are frequent enough that one
history entry per change would make the back button useless for real
navigation, and the brief only requires reload/share to restore the view, not
that back/forward step through every filter tweak. Verified: reloading
`/?q=trail&status=approved&sort=name:asc` restores the search box, the checkbox,
the sort dropdown and the filtered/sorted rows exactly.

---

## Performance

Measured via a scripted Playwright session (Chromium, headless) driving the
real dev app with chaos/latency on, not the browser's own DevTools UI — see
"How measured" per row. Windows 11, local dev server.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000+ rows loaded | N/A — baseline had no pagination past the first 24 rows at all (defect #6), so it never reaches this state | **~190 total DOM nodes**, flat, at 5,448 rows loaded | Scripted repeated `scrollTop = scrollHeight` + wait, reading `document.querySelectorAll('*').length` and `.card` count every 20 iterations. Card count stayed at 21-36 and total DOM nodes at 189-299 continuously from 168 through 5,448 loaded rows |
| Cards re-rendered when toggling one selection | All mounted cards (`AssetGrid` had no memo boundary, no stable callbacks) — not independently re-measured on the old code, stated qualitatively rather than guessed a number | **1 of 21** mounted cards | Dev-only counter (`window.__mvRenderCounts`, guarded by `import.meta.env.DEV`) incremented in `AssetCard`'s render body, read before/after a real checkbox click. Only the toggled card's count changed; all 20 others were bit-for-bit identical |
| Longest task during sustained scroll | Not measured — same N/A as above (feature didn't exist to stress) | **0 tasks over 50ms** across a 150-step sustained scroll with 2,208+ rows loaded | `PerformanceObserver({type:'longtask'})` recording during a scripted incremental scroll (60px/16ms steps, ~150 steps) |
| Requests fired while typing a 6-character query | **6** (one per keystroke — no debounce) | **1** | Counted `request` events matching `/api/assets\?` while typing "camera" at a 60ms/char cadence (well under the 400ms debounce window) |
| Production bundle, gzipped | 48 kB (stated baseline) | **~70.5 kB** (69.32 kB JS + 1.23 kB CSS) | `npm run build` output |

The bundle grew about 22.5 kB over baseline — entirely TanStack Query +
TanStack Virtual. That's a real jump and worth justifying rather than waving
away: both libraries are doing exactly the work Tasks 1 and 2 require
regardless of who writes it — cancellation, de-duplication, structural
retry/backoff, cursor-safe cache keys, and row virtualization with measured
heights. Hand-rolling equivalents would likely cost similar bytes eventually
and, with much higher confidence, more bugs; I'd rather spend the 22.5 kB than
debug a hand-rolled `AbortController` cache.

**What was the actual bottleneck, and how did you find it?** Two, both found
before writing any UI code, from reading the baseline against `API.md`: (1)
unbounded DOM growth, since the baseline never paginated past 24 rows at all,
so "5,000 rows" was structurally impossible before Task 2; (2) request volume,
since every keystroke firing a request would exhaust the 80-req/10s budget on
its own well before any real usage. Both are fixed at the data-layer, not
patched over in the view.

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

---

## Interface decisions

Three or four sentences: what you were optimising for, and the decisions that
follow from it. Then briefly:

- **Visual system.** Your colour, spacing and type decisions, and where they live.
- **Status treatment.** How the four statuses read as a progression, and how they
  stay distinguishable without relying on colour.
- **States.** What you did with loading, empty, error, offline and partial
  failure.
- **Contrast.** What you checked against, and with what.
- **Copy.** Any user-facing message you rewrote and why.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
