# Day Trips v2 — Rebuild Plan

Status: **in progress** · Started 2026-06-19

## Goal

Rebuild the Day Trips experience mobile-first with fewer tabs, **without deleting the
current version**. Build it as a parallel route so we can flip between old and new and
compare on a real phone. Retire the old one only once v2 is confirmed better and
feature-complete.

## Approach & ground rules

- **Parallel route:** new code lives at `/daytrips-v2`. The existing `/daytrips` and its
  components stay 100% untouched until v2 is signed off.
- **Reuse the data layer and utils** — no new data model. Same `$lib/data/dogs.ts`
  (`logManualTrip`, `endDayTrip`, `setDogTripStatus`, `importHistoricalDayTrip`,
  `deleteDayTripLog`, `listAllDayTripLogs`, `importedTripId`, `recomputeLastDayTripDate`)
  and `$lib/utils/daytrips.ts` / `kennelLayout.ts` / `tripNotesParser.ts` / `attention.ts`.
- **No behavior regressions:** every capability of the current page must exist in v2
  (inventory below) before we consider deleting the old.
- **Never delete old code before v2 is verified** (refactor-plan.md ground rules).
- `npm run check` clean + smoke test on mobile before each checkpoint.

## Current feature inventory + mobile status (read in full 2026-06-19)

The current feature is more complete and mostly more mobile-ready than first assumed.
Per component, with its real mobile state:

- **Board** (`BoardTab.svelte`) — ✅ already mobile-good. Out Now / Eligible / Not
  Eligible as **stacked cards** (3-col only ≥640px); color filter; Eligible cards show
  kennel, reset-aware days-since (`getDayTripGapDays`), Overdue + Adults-only tags,
  all-time count, top eligibility reason, Send Out; Out Now shows out-since + Mark
  Returned; **Not Eligible already lists the reason per dog.**
- **Log** (`LogTab.svelte`) — ✅ now responsive (mobile cards built 2026-06-19; table ≥768px).
  Collapsible log form (coordinators), month vs all-time toggle, delete, ASM copy block.
- **Dogs** (`DogsTab.svelte`) — ⚠️ **table, `min-width:400px` + `overflow-x:auto` → cut
  off / side-scrolls on mobile.** All-time trips, last-trip (reset-aware), month
  trips/hrs, status pill, overdue row highlight, out-now badge. **Needs card treatment.**
- **Stats** (`StatsTab.svelte`, lazy-loaded) — ✅ already responsive (KPI grid + charts +
  rank lists collapse to 1 col ≤640px). Pulls from `/api/sheets/stats`; year pills;
  monthly/cumulative/weekday/top-dog charts; top dogs + volunteers; monthly-detail table
  (4 narrow cols — minor side-scroll only).
- **Import** (`ImportTab.svelte`) — ⚠️ wide preview table (name/match/trips/dates +
  per-row override `<select>`), side-scrolls on mobile. Desktop-leaning by nature.
  Load-from-sheet → dry run (with ASM status lookup for unmatched) → import; wipes &
  re-imports per dog; can auto-create adopted records; import log.
- **Trip log form** (`TripLogForm.svelte`) — ✅ already mobile-friendly (Duolingo style):
  volunteer autocomplete, dog select, date + time out/back, 7 behavior ratings, notes;
  builds ASM copy text on submit.
- **Page glue** (`+page.svelte`): top bar chips, scrollable tab bar, permission gating
  (`canAccessDayTrips`/`canEditDayTrips`), `refresh()` (loads dogs + all logs + sheet
  colors + volunteers, clears `awaitingEvaluation` when a sheet color appears),
  `toggleOut` (visual-only via `setDogTripStatus`), and **`autoImportFromHiddenNotes`**
  (parses "Day Trip Notes M/D" from ASM hidden comments, logs idempotently via
  `importedTripId`, strips the note). Excludes incoming/perm-foster/in-foster dogs.

### Honest assessment

Not a teardown candidate. What's genuinely wrong on mobile is narrow: **Dogs** and
**Import** are wide tables that get cut off (same bug we just fixed on Log). Board, Stats,
and the log form are already fine. So "v2" is really **(a) consolidate 5 tabs → fewer**
and **(b) finish the mobile-card treatment on the two remaining tables** — not a rewrite.

## New information architecture (mobile-first, fewer tabs)

Collapse 5 tabs → **2 primary tabs + an overflow menu**:

1. **Today** (default) — the daily-driver, phone-first:
   - "Out now" list with Return action + elapsed time
   - "Due / overdue for a trip" queue (sorted by reset-aware gap), with Send Out
   - Quick "Log a trip" entry (sheet/expander reusing TripLogForm logic)
   - Compact month summary chip (trips · hours · out now)
2. **Log** — history:
   - Mobile cards / desktop table (already built in LogTab); month vs all-time toggle;
     delete; ASM copy.
3. **More** (overflow menu / secondary): **Dogs** stats, **Stats** charts, **Import**.
   These are manager/desktop-leaning, so they live behind a menu rather than top-level tabs.

Eligibility, color stripes, and "not eligible" reasoning fold into the Today queue
(e.g. ineligible dogs shown collapsed or with a reason chip) rather than a separate column.

## Build steps (checklist)

- [ ] **0. Scaffold** `/daytrips-v2/+page.svelte` — route guard (`canAccessDayTrips`),
      data load (mirror current `refresh()`), shared state. Add a temporary link from
      `/daytrips` → `/daytrips-v2` (and back) for easy comparison.
- [ ] **1. Shared bits** — extract any still-inline pure helpers the page needs into
      `$lib/utils/daytrips.ts` (reuse, don't duplicate). Keep `autoImportFromHiddenNotes`
      working (move to a shared helper if cleaner).
- [ ] **2. Today tab** — out-now list + due/overdue queue + Send Out / Return +
      quick-log entry. Mobile-first cards.
- [ ] **3. Log tab** — reuse the v1 LogTab layout (already responsive) or a trimmed copy.
- [ ] **4. More menu** — Dogs stats (cards on mobile), Stats (lazy chart), Import.
- [ ] **5. Polish** — empty states, loading, permissions, toasts; verify nothing from the
      inventory is missing.
- [ ] **6. Compare on phone** with Camilla; iterate.
- [ ] **7. Cutover** (only after sign-off): point `/daytrips` at v2, delete old
      components, update nav. One commit, `npm run check` clean.

## Open questions

- "Today" tab: should ineligible dogs be visible (collapsed w/ reason) or hidden entirely?

## Decisions log

- 2026-06-19: Mobile-first, fewer tabs; build full functionality (not a thin slice);
  parallel route, old version untouched until verified. (Camilla)
- 2026-06-19: Working route name `/daytrips-v2` is fine — it'll be renamed to `/daytrips`
  at cutover, so the name doesn't matter. (Camilla)
- 2026-06-19: Import already works on mobile + desktop today; keep it working on both. (Camilla)
