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

**Stale response handling**

**Virtualization approach**

**Optimistic updates and rollback**

**Retry and backoff policy**

**State placement and URL sync**

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | | | |
| Cards re-rendered when toggling one selection | | | |
| Longest task during sustained scroll | | | |
| Requests fired while typing a 6-character query | | | |
| Production bundle, gzipped | | | |

What was the actual bottleneck, and how did you find it?

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
