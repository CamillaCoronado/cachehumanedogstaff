# Completed Work — Archive

Finished plans and records, consolidated 2026-07-04. Each section below is the
full final text of a doc that used to live in docs/; originals were deleted in
the same commit (git history has every revision).

Contents: Incremental Refactor Plan (complete 2026-07-02) · Unused-Code Inventory
(fully resolved) · Day Trips v2 Plan (superseded — fixed in place) · Security
Hardening Notes (shipped March 2026).

---

# Incremental Refactor Plan

Status: **COMPLETE 2026-07-02** — all phases done; kept as a record of what moved where
and why. Follow-up work now lives in the deferred docs (Phase 5).

Goal: make the codebase safe to change — for humans and AI agents — without altering
any behavior. No data-model changes, no redesigns. The v2 event-timeline model
(`docs/v2-information-architecture.md`) is explicitly deferred until this plan is done.

## Ground rules (apply to every step)

1. **Extract, never rewrite.** Move code verbatim; resist "improving" it in the same step.
2. **One page per commit.** Each commit leaves the app fully working.
3. **Verify before deleting.** Old code is removed only after the replacement is imported
   and `npm run check` passes with zero new errors.
4. **`npm run check` after every extraction** — svelte-check catches broken references
   project-wide.
5. **Manual smoke test** of the touched page before committing.
6. **Never push** without explicit instruction.

## Phase 0 — Baseline (do first)

- [ ] Commit the ~17 currently-modified files + untracked `src/lib/components/daytrips/`,
      `src/lib/utils/dogs.ts`, `src/lib/utils/tripNotesParser.ts` (current WIP).
- [ ] Run `npm run check`; record the existing error/warning count as the baseline.
      New errors introduced by refactoring = stop and fix.
- [ ] Optional but recommended: add `vitest` (dev-only) so extracted pure functions in
      Phase 1 get tests. Zero tests exist today.

## Phase 1 — Extract pure domain logic into `$lib/utils`

Lowest risk, highest payoff: these are pure functions currently trapped inside page
`<script>` blocks. Moving them shrinks the giant files and makes the logic testable.
Continue the pattern already established by `attention.ts` and `feeding.ts`.

| Source page | Functions (current names) | Destination |
|---|---|---|
| `playgroups/+page.svelte` | `isPuppy`, `isPuppyVaccinated`, `intactConflict`, `getReadiness`, `guidanceForDog`, `energyRank`, `sizeCategory`, `sizeRank`, `sizeCompatible`, `eligiblePuppies`, `buildRecommendations`, `buildTestSuggestions` | new `src/lib/utils/playgroupRecommendations.ts` |
| `feeding/+page.svelte` | `makeRunCells`, `assignMobileColumn`, `getDogRun`, `getRunLabel`, `runIdToKey`, `getRunPosition`, `getWalkRank`, `compareByWalkPath` | new `src/lib/utils/kennelLayout.ts` (the redesign plan already calls for sharing this with the kennels page) |
| `feeding/+page.svelte` | `feedingFlags`, `specialFeedingReasons`, `isSpecialFeeding`, `foodSummary`, `foodAmountLabel`, `getFedMap`, `isSurgeryBlocked`, `isSurgeryDay` | extend `src/lib/utils/feeding.ts` |
| `daytrips/+page.svelte` | `durationHours`, `formatDuration`, `formatTime`, `formatShortDate`, `getEligibility`, stats aggregation helpers | `src/lib/utils/dates.ts` (formatters) + new `src/lib/utils/daytrips.ts` |
| `dogs/+page.svelte` | pill/label helpers (`tripPillClass`, `tripLabel`, `handlingPillClass`, `handlingLabel`, `adoptionLabel`, `adoptionPillClass`, `missingEvaluations`, `pendingItems`, `getTripEligibility`) | extend `src/lib/utils/dogs.ts` / `labels.ts` / `attention.ts` |
| `dogs/[id]/+page.svelte` | `stoolColor`, `stoolLabel`, `shelterTimeLabel`, `reentryDatesLabel`, `dayTripHours` | shared utils (note: `dayTripHours` ≈ daytrips' `durationHours` — unify) |
| `volunteers/+page.svelte` | local `formatDate` | ~~delete~~ NOT a duplicate (checked 2026-06-12): renders "Sat, Jun 13" (weekday, no year) vs shared "Jun 13, 2026". Keep page-local. |

Each row = one commit. Add a small vitest file per extracted module if vitest was set up.

## Phase 2 — Decompose the monolithic pages into components

One page per commit (or several commits per page). Extract markup+state into components
under `src/lib/components/<area>/`. The page file becomes a coordinator (~300 lines):
loads data, owns top-level state, composes components.

Suggested order (most self-contained seams first):

1. **`daytrips/+page.svelte` (3,100 lines)** — already has natural seams: 5 tabs.
   Extract `BoardTab.svelte`, `LogTab.svelte`, `DogsTab.svelte`, `StatsTab.svelte`
   (with the four chart builders), `ImportTab.svelte` (dry-run/import flow) into
   `src/lib/components/daytrips/` alongside the existing `TripLogForm.svelte`.
2. **`feeding/+page.svelte` (2,255 lines)** — extract `FeedingGrid` (run-layout view),
   `FeedingHistoryPanel`, `DidntEatPanel`, `StoolModal`, `EditFeedModal` into
   `src/lib/components/feeding/`.
3. **`playgroups/+page.svelte` (2,348 lines)** — extract `RecommendationsList`,
   `ManualSessionModal`, `SlackImportPanel`, `PendingSessionModal`, `SessionHistory`
   into `src/lib/components/playgroups/`.
4. **`dogs/[id]/+page.svelte` (2,004 lines)** — extract per-section components
   (`BathLogSection`, `FeedingLogSection`, `StoolLogSection`, `TripLogSection`,
   `ConfirmModal`); `DogForm.svelte` already exists.
5. **`dogs/+page.svelte` (1,983 lines)** — extract `DogCard.svelte` (the card with
   pills/actions/dismissals) and `AddDogModal`.
6. **`(app)/+layout.svelte` (1,797 lines)** and **`+page.svelte` dashboard (1,330)** —
   extract nav/sync-status pieces and dashboard cards last; they touch everything.

Conventions: props down / events up (Svelte 4 `createEventDispatcher`), styles move with
their markup, no logic changes during extraction.

### Bundle audit findings (2026-06-12)

Production build measured: ~1.65 MB total client JS, PWA precaches all of it so repeat
loads are served from cache. Per-page code splitting already works. Two notes:

- Firebase chunk (579 kB raw / 143 kB gz) dominates first paint on every page. Already
  modular imports + persistent local cache; accepted cost, do not fight it.
- chart.js (85 kB gz) is confined to the daytrips chunk but loads even if the Stats tab
  is never opened. **When extracting `StatsTab.svelte` (step 1 above), load it with a
  dynamic `import()` on tab activation.**
- Optional: pin `@sveltejs/adapter-vercel` in `svelte.config.js` instead of
  `adapter-auto` (already installed, silences local build warning).

Conclusion: load speed is a data-fetching problem (full dog-collection refetch per
page), not a bundle problem — Phase 3 is the fix.

## Phase 3 — Shared dog store

Today every page calls `listDogs()` independently on mount and re-fetches via
`syncVersion`. Create `src/lib/stores/dogs.ts`:

- holds `dogs` (writable store), `loading`, `lastLoaded`
- `ensureLoaded()` — fetch once, reuse across navigations; refresh when `syncVersion`
  increments (existing mechanism, keep it)
- mutation helpers that update the store after `updateDog`/`createDog`/etc. so pages
  stop hand-patching local arrays
- migrate pages one at a time; keep `onSnapshot`/realtime out of scope for now

This removes duplicated `refreshDogs()` plumbing from ~8 pages and cuts Firestore reads.

### Progress (2026-07-01)

`src/lib/stores/dogs.ts` created: `ensureDogsLoaded()` (cache + 2-min
stale-while-revalidate), `refreshDogs()` (forced, shared inflight), `patchDogInStore()`,
and the syncVersion re-fetch handled once at the store level.

- [x] kennels · medical · feeding · playgroups · dogs roster · home dashboard
      (one commit each; initial loads use the cache, sync/mutation paths force-fetch)
- [x] daytrips (2026-07-02) — `loadDayTripData` sources dogs from the store and patches
      the sheet-color sync + eval auto-clear into it (side effects now reach every page)

**Phase 3 complete.** Deliberately out of scope (decided 2026-07-02):

- admin — direct `listDogs`; fold into the Phase 4 admin data-layer cleanup
- trip-log (public QR page) — stays standalone: it runs outside the app shell/auth
  context and one fetch per QR visit is fine
- dogs/[id] detail page — uses `getDog(id)` per dog, not the collection

## Phase 4 — Cleanups

- [x] Review `docs/unused-code.md` and delete confirmed-dead code (2026-07-02: re-ran
      the scan, deleted 12 truly-dead exports + the unused `dogColors` store + the dead
      year-stats reactives on the daytrips page; see unused-code.md for what stayed and
      why. Still pending owner sign-off: `startDayTrip`/`endDayTrip`,
      `markStaleAsmDogsArchived`, one-time migrations.)
- [x] Move user-profile Firestore ops into `src/lib/data/users.ts` (2026-07-02); the
      admin page's `listDogs` calls stay direct on purpose — its destructive tools
      (merge, repair) should always read fresh.
- [x] Unify date/duration formatters (done across Phases 1–2; volunteers' local
      `formatDate` stays — verified 2026-06-12 as intentionally different).
- [x] One localStorage pattern (2026-07-02): all raw `localStorage` calls now go through
      `utils/storage.ts` (`readJson`/`writeJson`, plus `readString`/`writeString` for the
      plain-string role key); writes swallow quota errors in the helper.
- [ ] Delete `src/lib/data/migrate-food-types.ts` and `backfillBathLogsFromDogs` if the
      one-time migrations have been run (confirm with owner first).

## Phase 5 — Deferred (separate effort, not part of this refactor)

- v2 event-timeline data model and route restructure (`docs/v2-information-architecture.md`)
- Realtime `onSnapshot` subscriptions
- Page redesigns (`docs/page-redesign-plan.md`)

## Definition of done

- No `+page.svelte` over ~800 lines; no page-level `<script>` over ~300 lines.
- All pure domain logic lives in `$lib/utils` (unit-testable).
- All Firestore access lives in `$lib/data`.
- Dog data flows through one store.
- `npm run check` error count ≤ Phase 0 baseline.

---

# Unused / Unreferenced Code Inventory

Originally generated 2026-06-12; **re-scanned and acted on 2026-07-02** (Phase 4).
Deletions followed the ground rules in `refactor-plan.md`: re-verified (including
own-file usage), deleted in per-module commits, `npm run check` at baseline after each.

## Deleted 2026-07-02

| Export | File | Notes |
|---|---|---|
| `getEffectiveAdoptionDate` | `utils/adoption.ts` | no callers |
| `normalizeDay`, `ageInYears` | `utils/dates.ts` | no callers |
| `adoptionRequirementAction` | `utils/dogCard.ts` | no callers |
| `dayTripLabel` | `utils/labels.ts` | no callers |
| `roleLabel` | `utils/permissions.ts` | no callers |
| `eligiblePuppies`, `priorityLabel` | `utils/playgroupRecommendations.ts` | leftover from earlier puppy-group feature |
| `stripDayTripNotes` | `utils/tripNotesParser.ts` | orphaned when strip-and-persist was removed (issue #5); display stripping lives elsewhere |
| `logDayTrip` | `data/dogs.ts` | superseded by `logManualTrip` |
| `hasAnyUserProfiles` | `data/users.ts` (ex `firebase/firestore.ts`) | old admin-bootstrap flow |
| `dogColors`, `loadDogColors` | `stores/dogColors.ts` (file deleted) | abandoned approach; sheet colors are persisted onto dogs via `syncSheetColorsToDogs` and read with `dogStripeColor(dog)` |
| year-stats reactives | `daytrips/+page.svelte` | `yearLogs`/`yearlyStats`/`yearTripTotal`/`yearHourTotal` computed but never rendered |

## Corrections from the 06-12 inventory (now LIVE, do not delete)

- `canHandleDog`, `handlingRequirementLabel` (`utils/permissions.ts`) — used by
  `handlingRestrictionReason`.
- `missingAdoptionMedicalRequirements` (`utils/adoption.ts`) — used by
  `getAdoptionAvailability`.
- `isPuppyFood`, `isNormalFood`, `isOwnFood` (`utils/feeding.ts`) — live internals.
- `getRunPosition`, `getWalkRank` (`utils/kennelLayout.ts`) — used by `compareByWalkPath`.
- `recomputeLastDayTripDate` (`data/dogs.ts`) — used internally by trip log mutations.

## Resolved with owner sign-off 2026-07-02

- `startDayTrip`, `endDayTrip` — deleted; Camilla confirmed the visual-only
  out/return model is staying.
- `data/migrate-food-types.ts` + admin "Migrate food types" card — deleted; migration
  confirmed run.
- `backfillBathLogsFromDogs` — deleted, including the layout call that re-ran it
  every session (it was reading the full dogs collection + all bath logs on each
  app load for editors).
- `backfillLastDayTripFromLogs` — deleted (same pattern, also ran every session);
  every trip-log write path recomputes `lastDayTripDate` via
  `recomputeLastDayTripDate`, so the repair was redundant.

## Still pending owner sign-off

(none — all resolved 2026-07-02)

Correction: `markStaleAsmDogsArchived` (`data/asm-sync.ts`) is LIVE — called by
`syncAnimalsFromASM` in its own file (the 06-12 scan only checked external refs).
It archives dogs that disappear from the ASM feed. Do not delete.

## Internal-only (used within their own file; exported unnecessarily or for tests)

Not dead code — just exports that could become module-private. Low priority.

- `utils/dates.ts`: `isMondayOrThursday`, `PUPPY_MAX_AGE_MONTHS`, `PUPPY_MIN_DAYS_AT_SHELTER`
- `utils/attention.ts`: `BATH_OVERDUE_DAYS`
- `utils/playgroupRecommendations.ts`: `isPuppyVaccinated`, `intactConflict`,
  `energyRank`, `dogEnergyRank`, `sizeRank`, `sizeCompatible` — engine internals,
  exported for unit tests; keep.
- `stores/dogs.ts`: `dogsLoading` — store API, exercised by `dogs.test.ts`.

## Re-running the scan

```sh
for f in src/lib/utils/*.ts src/lib/data/*.ts src/lib/stores/*.ts; do
  [[ "$f" == *.test.ts ]] && continue
  grep -oE "^export (async )?(function|const) [A-Za-z0-9_]+" "$f" | awk '{print $NF}' | while read -r n; do
    refs=$(grep -rE "\b${n}\b" src --include='*.svelte' --include='*.ts' -l | grep -v "$f" | grep -v '\.test\.ts' | wc -l | tr -d ' ')
    [[ "$refs" == "0" ]] && echo "$f: $n"
  done
done
```

A hit only means "no references outside its own file" — always check own-file usage
before deleting (several 06-12 entries turned out to be live internals).

---

# Day Trips v2 — Rebuild Plan

Status: **SUPERSEDED 2026-07-01** · Started 2026-06-19

> **Decision (Camilla, 2026-07-01): no parallel rebuild.** The feature inventory below
> showed v1 was already mostly mobile-ready — a rewrite wasn't warranted. The real gaps
> were fixed in place on `/daytrips` instead:
>
> - **Dogs tab**: mobile card layout (cards <768px, table ≥768px — same pattern as Log).
> - **Colors tab**: tap-to-assign for touch (tap a dog → "Move here" buttons appear per
>   column); HTML5 drag never fired on touch, so phones couldn't set colors at all.
>   Drag still works on desktop.
> - **Shared data layer**: the page's `refresh()` load + hidden-notes auto-import moved
>   to `src/lib/data/daytripSync.ts` (`loadDayTripData`, `autoImportTripsFromHiddenNotes`).
>
> Deliberately **not** done: tab consolidation (tabs are permission-gated, most users see
> 3–4; a "More" menu would hide tools), quick-log on Board (stays on Log tab), Import
> mobile cards (desktop-leaning by nature, works as-is).
>
> The inventory below is kept for reference.

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

---

# Security Hardening Notes

Status: **SHIPPED** (March 2026). Historical reference — describes changes that are
live; the admin-bootstrap steps below are still the procedure for a fresh project.

## What Changed

- Self-service profile creation is now staff-only.
- Only admins can create, update, or delete user profiles.
- Local fallback role default changed from manager to staff.

## Files

- `firestore.rules`
- `src/lib/stores/auth.ts`
- `src/lib/stores/role.ts`

## Operational Impact

- A brand-new user can no longer grant themselves admin/manager by writing their own profile.
- Manager users can no longer modify user accounts directly in Firestore.
- In local-role fallback mode, the UI defaults to least-privileged behavior.

## Admin Bootstrap

If your project has no admin profile yet:

1. Create a user profile document in Firestore for a trusted account.
2. Set `role` to `admin`.
3. Sign in with that account and manage other roles from there.


