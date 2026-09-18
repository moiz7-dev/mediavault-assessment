# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

**Link:** https://drive.google.com/file/d/1qN7N_qFpalzgxjDP3dQYgjX2P_Y_ERUS/view?usp=sharing

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

Same class of false alarm turned up again in Task 5: testing "return focus to
opener on close" by synthetically dispatching a click on `document.querySelector('.card')`
found a real-looking scroll jump. The cause was the test, not the app —
with only ~24 items loaded, overscan renders nearly every row regardless of
scroll position, so `querySelector` (first DOM match) can return a card that's
mounted but not actually visible, something a real mouse could never click.
Re-tested by filtering to a card whose `getBoundingClientRect()` was actually
within the scroll container's viewport (i.e. what a user could really click):
scroll went 500 → 495 (the small, already-documented reflow from the panel
narrowing the grid) → 500 exactly on close, with focus correctly landing back
on that same card. Both false alarms share a lesson: a scripted a11y/behaviour
check is only as good as whether it reproduces something a real user
interaction could actually do.

**Optimistic updates and rollback**

Every selected id is patched to the new status directly in TanStack Query's
infinite-query cache *before* any request is sent (`useBulkStatus.apply`,
`patchAssetsInCache`) — confirmed the grid re-paints within 50ms of clicking,
well before the server's 90ms+ baseline latency could plausibly have returned
anything. Ids are chunked to the 50-id server cap and sent with bounded
concurrency (3 chunks in flight at once, not all of them — the brief is
explicit that firing 40 parallel requests is the wrong answer). Each chunk's
own per-id `results` array then either confirms that id with the authoritative
asset the server returned, or rolls back *only that id* to whatever status it
had before the batch started — a snapshot taken once, up front, per id, so a
partially-successful batch never loses track of what to roll a given id back
to. Verified with a 96-id "select all loaded" batch under real chaos: 77
succeeded, 19 failed (13 `legal_hold`, 6 `conflict`), and only the 19 failing
rows kept their original status.

The two failure reasons get different treatment, per the brief's hint that one
of them never succeeds on retry: `legal_hold` is deterministic (anything
tagged `legal-hold` always fails, confirmed against `server/data.mjs`), so
those rows are reported but never offered a retry; `conflict` is a random ~7%
and *is* retryable, so a "Retry N failed" button appears counting only those.
Retrying the 6 `conflict` failures from that same run succeeded on all 6.
`not_found` (asset deleted from under you) is treated like `legal_hold` — no
retry, since the id is simply gone.

A chunk that fails entirely (retries exhausted on a transient error, not a
per-id rejection) is treated as every id in it failing, so nothing is left
stuck in a "confirmed" state that never actually confirmed.

**Single-asset conflict (`409 version_conflict`) in the detail panel:** on
conflict, the panel refetches the asset and shows a plain-language notice
("This asset changed elsewhere — refreshed to the latest version. Choose a
status again to apply your change.") rather than silently retrying the write
with the new version. Justification: a version conflict means someone else's
change already landed, and we don't know whether the user's intended status
still makes sense against whatever they changed it to — silently reapplying
could clobber a concurrent edit the user never saw. Refetching and asking for
one more click costs little and guarantees the user is looking at current
state before deciding. Verified end-to-end: forced a real 409 by PATCHing the
same asset directly while the panel held a stale version, confirmed the panel
showed the conflict notice and the freshly-changed name, then confirmed a
second click against the refreshed version saved cleanly.

Saving from the detail panel also patches the same cache (`handleSaved` →
`patchAssetsInCache`) so the grid reflects the edit immediately — this closes
baseline defect #12, where `onSaved` was a documented no-op and the grid kept
showing the stale row after an edit; confirmed the grid card's name/status
update without a refetch after closing the panel.

**Range selection:** click (or Space, keyboard) selects one id and sets it as
the anchor; shift-click or Shift+arrow selects the contiguous range between
the anchor and the target, *added to* whatever was selected as of that last
plain action, not the live selection — a `baseSelectionRef` snapshot taken at
that moment. That distinction matters once keyboard entered the picture in
Task 5: without it, Shift+arrow could only ever grow the selection, because
each step would union against a selection that already included the previous
step's range. Snapshotting the base means moving back the other way correctly
shrinks the range again — verified: Space, then Shift+Right ×2 → 3 selected,
then Shift+Left → 2 selected. Both anchor and base live in refs, not state, so
`toggleSelect` keeps one stable identity across renders — required for
`AssetCard`'s memo to keep working during a selection change. "Select all
loaded" selects every currently-fetched id (not the whole 12,400 — only what
infinite scroll has actually brought into the cache so far).

One implementation note worth flagging: the checkbox's `onClick` originally
called `preventDefault()` to fully own the toggle (since a shift-click can
mean "select a whole range", not just this id). That desynced React's
controlled `checked` from the actual DOM property — the card's own
`.card--selected` styling was correct but the checkbox itself silently stayed
unchecked, caught by scripted before/after checks of the DOM `checked`
property, not just visual inspection. Fixed by letting the native toggle
happen and capturing the modifier key in `onClick` for the `onChange` that
follows in the same tick to read, rather than fighting the browser's default
action.

**Retry and backoff policy**

Landed earlier than Task 4 proper because Task 1 needed it: without a retry,
the ~6% baseline `503` rate on `GET /api/assets` would surface as a visible
error on roughly 1 in 17 searches, which fails Task 1's "loading/empty/error
must be distinguishable and correct" bar on its own. `queryClient.ts` centralises
it: `retryDelay` honours `Retry-After` exactly (plus a small jitter) when the
server gives one, otherwise exponential backoff with equal jitter (50-100% of
`min(500 * 2^attempt, 8000)`ms); `retry` checks `ApiError.retryable`, which is
computed structurally from HTTP status (`429`/`503`/`500` only) in
`api/errors.ts` — never from message text. Capped at 4 attempts.

`lib/retry.ts` extracts the same policy (`shouldRetry`/`backoffDelay`) into a
standalone `withRetry(fn)` for the two write paths that don't go through
`useQuery`/`useMutation`: the bulk-status chunks (Task 3) and, now, the
single-asset load and save in `AssetDetail` — the baseline never retried a
`500 write_failed` on save even though `API.md` documents it as safe to
retry, and the detail load had no cancellation at all (closing and reopening
the panel quickly could let a stale asset's response land after the current
one — the same class of race Task 1 fixed for search, now fixed here with an
`AbortController` in the same effect).

**Offline handling.** TanStack Query already pauses queries while
`navigator.onLine` is false and resumes them on reconnect (default
`networkMode: 'online'`) — `useOnlineStatus` (a thin wrapper on the
`online`/`offline` window events) is mainly there to *tell* the user, via a
persistent banner, and to gate the two raw-`fetch` write paths (bulk status,
single-asset save) that aren't covered by that automatic pause. Verified with
Playwright's `context.setOffline`: the banner appeared immediately, typing a
new search while offline produced no repeated request storm (one attempt,
then silence — retries correctly wait rather than burning the budget while
offline), and reconnecting made the banner disappear and querying resume
without user action. Bulk-action and single-asset status buttons are
disabled while offline rather than left to fail and report an error — no
value in letting the user fire a request we already know will fail.
**Queueing writes made while offline is a cut, not a requirement** — see
Trade-offs.

**Error boundary.** `ErrorBoundary` (a small class component, `main.tsx`)
wraps the whole app once as a last resort, and `App.tsx` wraps `AssetGrid` and
`AssetDetail` each in their own instance so a failure in one can't blank the
other or the header/search. Verified by temporarily throwing inside
`AssetCard` for a real, currently-loaded asset id: the grid showed "The grid
hit a snag showing these assets." with a "Try again" button, while the search
box stayed fully interactive — confirmed via a scripted check that it was
still typeable, not just visually present.

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
| Production bundle, gzipped | 48 kB (stated baseline) | **~74.1 kB** (72.21 kB JS + 1.91 kB CSS, final) | `npm run build` output |

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

**Keyboard model.** The grid is `role="grid"` with a single roving tabindex
over the loaded assets: one card is `tabindex="0"` at a time (verified
scripted — exactly one `[role="gridcell"][tabindex="0"]` exists no matter how
many are loaded), everything else is `-1`, so Tab is one stop in and one stop
out rather than thousands. Inside the grid: arrow keys move the roving focus
by one card (or by the current column count for up/down), Enter opens the
detail panel, Space toggles the focused card's selection, and Shift+arrow
extends *or shrinks* a range from the last plain-selected anchor (shrinking
needed its own snapshot — see "Range selection" above; a naive version could
only grow). Moving focus past what's currently virtualized asks the
virtualizer to scroll that row into view, then focuses the card once it
actually exists in the DOM (polled a few animation frames, not assumed
synchronous). Opening the panel moves focus to its Close button; Escape or
Close both return focus to the exact card that opened it, and a filter/search
change that shrinks the list re-clamps focus instead of leaving it pointing
at a row that no longer exists. Checkboxes are `tabindex="-1"` (mouse-clickable,
not an extra Tab stop) with their own `aria-label`; each gridcell carries an
`aria-label` combining name, status and selection state, and `aria-selected`
for assistive tech to track selection independent of the checkbox's own
label. A single `aria-live="polite"` region announces result counts and bulk
outcomes — deliberately keyed on the *loading-finished* transition, not on
every render, so background pagination and refetches stay silent and it never
fires once per keystroke.

**How tested.** Entirely via scripted checks against the real accessibility
tree (Playwright reading `role`/`aria-*`/`document.activeElement`, not just
pixels) — confirmed the roving-tabindex count, arrow/Enter/Escape/Space
behaviour, focus landing on Close on open and on the exact opener card on
close, and the live region's text at the moments it's supposed to update.
**I did not run a screen reader (NVDA/VoiceOver/JAWS) against it** — the
semantics are real and match the WAI-ARIA grid pattern, but I haven't heard
it read aloud, so I'm not claiming a pass I didn't observe.

**Known gaps.** No screen-reader audio pass (above). Shift+arrow range
extension is relative to the last plain click/Space, not full "grow into
column below" grid-selection semantics some spreadsheets implement — a
simpler, still-correct choice for a gallery-style grid. The detail panel is a
non-modal dialog (`role="dialog"`, no focus trap, per the brief) — a
keyboard-only user can Tab out of it into the page behind, which is
intentional here but worth calling out as a deliberate choice, not an
oversight.

---

## Interface decisions

Optimising for a reviewer scanning hundreds of cards under real chaos: status
has to read at a glance without relying on colour, every non-happy state
(loading, empty, error, offline, partial failure) needs to look like a
different thing rather than a variation on "blank", and none of it should
need a design tool or an icon library to justify. Everything below is CSS
custom properties and existing DOM — no illustration, no motion, no dark
mode, per the brief.

- **Visual system.** All colour, spacing, radius and type live as `:root`
  custom properties in `styles.css` (`--ink`, `--ink-soft`, `--line` /
  `--line-soft`, `--accent`, `--danger`, a `--space-1…5` scale, `--radius-*`).
  Two border tokens on purpose: `--line` meets the 3:1 UI-component threshold
  for things whose edge matters (inputs, selects, checkboxes), `--line-soft`
  is decorative (card edges, dividers) where spacing already carries the
  structure — so a reader of the tokens can tell which borders are load-bearing.
- **Status treatment.** `StatusBadge` renders status as a 4-dot progression
  (draft=1 dot lit, in review=2, approved=3, archived=4) plus the label — the
  *count* is the primary signal, so it still reads correctly for someone who
  can't distinguish the tint, or on a greyscale printout. The tint/label are
  the faster secondary scan for everyone else. See `docs/screenshots/grid.png`.
- **States.** Loading, empty and error are three visually distinct outcomes,
  not one collapsing into another (the baseline's actual bug — see defect
  #14): empty is plain and quiet ("nothing to see, not broken"), error gets a
  `--danger`-tinted box with a retry action, offline gets a full-width amber
  banner that's impossible to miss but doesn't block the rest of the UI, and
  a partial bulk failure gets its own panel naming exactly which assets
  failed and why, with a scoped retry action (`docs/screenshots/bulk-outcome.png`).
- **Contrast.** Computed with the actual WCAG relative-luminance formula (a
  small Node script, not a browser extension or eyeballing) against every
  colour pair actually in use. Body text (`--ink` on white) is 17.76:1;
  secondary text (`--ink-soft`) is 6.13:1 on white and 5.62:1 on `--bg-soft`,
  both clearing the 4.5:1 AA text threshold with room to spare; `--accent` and
  `--danger` on white are 6.63:1 and 6.54:1; the darkened `--line` border used
  on real controls is 3.18:1, clearing the 3:1 AA non-text threshold; all four
  status dot colours clear 3:1 against white (3.21–6.13:1). Full pairs and
  numbers are in the script output, reproducible on request.
- **Copy.** `friendlyMessage`/`describeBulkFailure` (Tasks 1/3/4) already
  replaced every raw `"429: Too many requests…"`-shaped string; Task 6 added
  the last two gaps — `bad_request` and `bad_cursor` — so no HTTP-shaped text
  can reach the user even from an edge case the UI can't normally trigger
  (e.g. a hand-edited URL with an invalid sort). The offline banner, bulk
  outcome summary and empty-state copy were all written as plain sentences a
  non-technical reviewer would say out loud, not error-log text.
- **Narrow window.** At ≤720px the detail panel and grid stack instead of
  sitting side by side; the grid keeps a genuinely usable ~38vh scrollable
  strip rather than shrinking to a sliver when the panel is open, and the
  panel gets the rest (`docs/screenshots/detail-panel.png` is the wide
  layout; verified narrow separately by resizing to 375px and confirming
  no overlap and single-column cards).

Screenshots: [`docs/screenshots/grid.png`](docs/screenshots/grid.png),
[`docs/screenshots/detail-panel.png`](docs/screenshots/detail-panel.png),
[`docs/screenshots/bulk-outcome.png`](docs/screenshots/bulk-outcome.png).

---

## Trade-offs and cuts

Deliberately skipped, all three optional items — none of Tasks 0-6 felt
solid enough to spend the remaining time on a bonus instead:

- **Live updates (`GET /api/events`)** — not implemented. Reconciling an SSE
  `asset.updated` push with an optimistic-update cache that's mid-flight on a
  bulk action (Task 3) without clobbering either is a real design problem,
  not a quick add, and Tasks 0-5 carry more signal per the brief's own
  ordering.
- **Tests** — none written. The brief is explicit that sharp concurrency/
  rollback tests beat broad shallow coverage, and I spent the equivalent
  effort as scripted Playwright verification instead (documented inline
  throughout this file) — real assertions against the running app under
  real chaos, not mocks. I'd trade some of that for a handful of unit tests
  around `useBulkStatus`'s chunking/rollback logic specifically, if I had
  more time — that's the one piece I'd actually want a regression net around.
- **`/api/stats`** — never called. Nothing in the brief for Tasks 0-6 needed
  library-wide counts, so there was nothing to make non-blocking.

Cut within the required tasks, smaller scope decisions:

- **Undo, not offered** for bulk actions — only retry for the failed subset.
  The brief allows either; retry directly addresses the two documented
  failure reasons (legal_hold/conflict), while undo would need to revert
  each succeeded id to its own *individual* prior status (not one shared
  value), which is a materially bigger feature for less payoff here.
- **Shift+arrow range selection** extends/shrinks from the last plain
  action, not full "drag in any direction across multiple prior ranges"
  spreadsheet semantics — simpler, still correct for a gallery grid (see
  Accessibility → Known gaps).
- **No screen reader audio pass** — semantics verified against the real
  accessibility tree, not heard. Disclosed rather than claimed.
- **kind/tag/collectionId/owner filters** exist in the API and the type
  system (`AssetQuery`) but have no UI — the baseline never exposed them
  either, and adding filter UI wasn't a stated defect or requirement. Left
  alone rather than scope-creeping Task 6 into new features.

With another day: SSE reconciliation first (it's the most interesting
remaining problem), then the `useBulkStatus` unit tests, then a second pass
on mobile/narrow polish beyond "doesn't break."

## Critique of the API

- **Bulk vs single-asset legal-hold rules disagree.** `PATCH /api/assets/:id`
  only blocks `legal-hold` assets from moving to `archived`, but
  `POST /api/assets/bulk-status` blocks a `legal-hold` asset from *any*
  status change (confirmed in `server/data.mjs`/`server/index.mjs`). A
  reviewer who successfully sets a legal-hold asset to `in_review` one at a
  time, then selects it in a batch with others, sees it fail for a reason
  the single-asset endpoint wouldn't have raised. I built the client to
  match whichever endpoint the user actually hits (which is contract-correct)
  but had to explain this asymmetry to myself once I noticed the failure
  counts didn't match my mental model — worth reconciling one way or the other.
- **Bulk-status has no `version`.** Every single-asset write is
  optimistic-concurrency-safe; a bulk write to an asset someone just edited
  elsewhere just silently overwrites their change (no `409` possible, by
  design). Given the brief's own scenario — many reviewers working the same
  library — that's a real gap, not just a client inconvenience.
- **`stale_cursor`'s fingerprint excludes `limit`.** Convenient (I can page
  size independently of the filter fingerprint) but slightly surprising the
  first time you read `server/index.mjs`'s `fingerprint()` — worth a line in
  `API.md` saying explicitly which params are and aren't part of a cursor's
  identity.
- **No per-request client identifier for the rate limiter** — it's keyed by
  IP (`req.socket.remoteAddress`), fine for local dev, but worth flagging
  since it means every user behind the same NAT/proxy in a real deployment
  shares one 80-req/10s budget.

## Anything you would like us to look at

- **`useBulkStatus.ts`** — the whole optimistic/chunk/rollback flow in one
  place. It's the piece I'd most want to walk through live: why the snapshot
  happens once up front rather than per-chunk, and why a fully-failed chunk
  (network down mid-batch) has to be treated as a per-id failure rather than
  a single top-level error.
- **The two "false alarm" investigations in SUBMISSION.md** (search for
  "false alarm") — both looked like real app bugs (scroll resetting to 0,
  focus restoration breaking scroll position) and both turned out to be the
  *test* clicking something a real mouse never could. I left the reasoning
  in rather than cleaning it up, because I think how I ruled out "is this
  real" is more informative than a diff with the dead ends removed.
- **Genuinely unsure about:** the detail panel's 409 behaviour (refetch +
  ask the user to re-confirm, rather than any kind of merge or silent
  retry). I think it's the safer default, but "what should happen when two
  people edit the same asset" doesn't have one obviously-correct answer, and
  I'd like to hear how you'd want it to behave.
