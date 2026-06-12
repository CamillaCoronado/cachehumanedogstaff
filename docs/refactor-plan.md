# Incremental Refactor Plan

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

## Phase 4 — Cleanups

- [ ] Review `docs/unused-code.md` (inventory of unreferenced exports, generated
      2026-06-12) and delete confirmed-dead code, one commit per module.

- [ ] `admin/+page.svelte` is the only page importing Firestore directly — move those
      operations into `src/lib/data/` (e.g. `users.ts`).
- [ ] Unify date/duration formatters on `utils/dates.ts`; delete page-local duplicates.
- [ ] Review `src/lib/utils/storage.ts` + scattered `localStorage` use for one pattern.
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
