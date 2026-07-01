# User-Reported Issues To Investigate

Reported by Camilla 2026-06-12 while reviewing the feeding page. These are behavior
checks/changes, **not** part of the refactor — handle separately, after or alongside
refactor phases, each as its own verified fix.

## 1. Feeding amount calculations feel wrong — RESOLVED 2026-06-12

- The computed food amounts "often feel wrong."
- Verified `estimateFoodAmountPerMeal` (`src/lib/utils/feeding.ts`) against a photo of
  the shelter's laminated "Serving Sizes" wall chart (the authoritative source; it is
  the shelter's own per-meal conversion and intentionally differs from Hill's
  published per-day tables).
- **Found and fixed a transcription error**: the puppy 10-12 months column was shifted
  one row down for 20-35 lbs, showing 1/4 cup less per meal than the wall chart
  (e.g. 20 lb -> 3/4 c instead of 1 c). Adult chart and the other two puppy columns
  matched exactly.
- All chart values are now pinned by unit tests in `src/lib/utils/feeding.test.ts`.
- **Decision (Camilla, 2026-06-12): the wall chart stays authoritative.** It is the
  staff's own per-meal conversion of Hill's per-day recommendations (halved, rounded
  to quarter-cup scoops) — within 1/8 cup of exact-half-Hill's on every row. Do not
  "correct" the app to Hill's raw daily tables.
- Open question for staff: dogs *with* an explicit `foodAmount` in their profile
  bypass the chart entirely — if amounts still feel wrong for specific dogs, check
  their stored `foodAmount` values.

## 2. Snake route doesn't snake correctly — RESOLVED 2026-06-17

- The "Snake Route" walk-path ordering on the feeding page did not match the physical
  walking order.
- **Fix:** replaced the old row-index-alternating logic in `getWalkRank`
  (`src/lib/utils/kennelLayout.ts`) with an explicit staff-confirmed sequence
  `SNAKE_ROUTE_ORDER` (2026-06-17): Puppy Run → top wall 15→1 → 35 → left island 17–20 →
  right island 21–24 → bottom row 34→25 → Rock Run last.
- Pinned by `src/lib/utils/kennelLayout.test.ts` ("snake_route follows the confirmed
  physical walk…"), which asserts strictly increasing rank in that exact order.

## 3. Modals centered in viewport / share one component — FIXED 2026-06-30 (pending visual verification)

- Symptom: page-local `position: fixed` modals (e.g. feeding's "didn't eat" panel) centered
  within the content area instead of the full viewport, and duplicated modal styling.
- **Real fix:** convert page-local form modals to the shared `Modal.svelte`, which portals
  to `<body>` (so it's viewport-centered regardless of any ancestor) and carries the one
  canonical modal styling. Converted:
  - feeding "didn't eat" panel (`src/routes/(app)/feeding/+page.svelte`) — removed its
    `.didnt-eat-overlay/-modal/-head/-title/-close` markup + CSS.
  - playgroups "Log playgroup" modal (`src/routes/(app)/playgroups/+page.svelte`) — removed
    its `.manual-modal-*` markup + CSS and the now-dead local `portal()` action.
  - (feeding history + stool, and dogs add-dog already used the shared `Modal`.)
- Secondary cleanup: `.page-paper` had `will-change: transform` (in
  `src/routes/(app)/+layout.svelte`), which establishes a containing block that traps any
  remaining page-local `position: fixed` element. Moved the hint onto the `.page-turn-*`
  classes (only active during the transition).
- **Not converted (intentional):** the adoption/transfer/foster/incoming **celebration
  overlays** (layout, admin, dog-detail) are bespoke full-screen animations, not form
  dialogs — they stay custom.
- **Pending:** visual confirm — open the didn't-eat panel and the playgroups log-playgroup
  modal and check they center on the full screen.

## 4. Feature: copy daily updates as Slack-formatted text — DEFERRED (backlog)

- Deferred 2026-06-30 (Camilla): not building now. Kept as a backlog feature idea.
- Many daily statuses get re-typed into Slack by hand: baths, playgroups, who didn't
  eat, etc. Wanted: a "copy as Slack update" action that formats the relevant list as a
  ready-to-paste Slack message (e.g. copy the didn't-eat list from the feeding page).
- Candidate spots: feeding page (didn't-eat list, per-meal summary), playgroups page
  (sessions logged today), bath logs, possibly day trips out/returned.
- Existing pieces to build on: the daytrips page already has a `copyToClipboard`
  helper; there is an inbound Slack webhook (`src/routes/api/slack/events/+server.ts`)
  that imports playgroup messages — this feature is the outbound counterpart
  (clipboard first; true Slack API posting could come later).
- Suggested shape: a shared `$lib/utils/slackFormat.ts` with one formatter per update
  type + small copy buttons on each page. Slot in after the relevant Phase 2 page
  decompositions so the buttons land in clean components.

---

Reported by Camilla 2026-06-30 (day trips + ASM sync review).

## 5. ASM sync re-flags "Hidden comments" as changed every sync — FIX IMPLEMENTED 2026-06-30 (pending live-sync verification)

- Every sync reports a long list of dogs as `Updated: Hidden comments` even though
  nothing changed in ASM. Example sync (2026-06-30): Arcanine (Jerry), Artemis, Bagel,
  Dot (Freya), Electro, Emma, Junior, Kaylie, Oliver.
- **Root cause (identified):** a write-fight over `hiddenComments`. ASM sync writes the
  full ASM `HIDDENANIMALDETAILS` (which still contains the "Day Trip Notes M/D:" blocks);
  the day-trips page then *strips* those blocks and writes the shortened value back. Next
  sync sees stored (stripped) ≠ ASM (full) → flags "Hidden comments" changed and rewrites
  the full value → repeat forever.
- Side effect: most recent day-trip notes can be destroyed if the strip runs before the
  note is logged.
- Where to look: `asmToStoredFields` / change-detection in `src/lib/data/asm-sync.ts`
  (writes full ASM value); `autoImportFromHiddenNotes` in
  `src/routes/(app)/daytrips/+page.svelte` (was stripping + persisting `hiddenComments`).
- **Fix (implemented 2026-06-30):** removed the strip-and-persist from
  `autoImportFromHiddenNotes` in `src/routes/(app)/daytrips/+page.svelte`. The page no
  longer writes a shortened `hiddenComments`; ASM now solely owns the field, and the dog
  detail page strips the notes for display only. Trip import is unaffected (still
  idempotent via `importedTripId`, patch-guarded).
- **Pending verification:** expect one final "Hidden comments" change per affected dog on
  the first sync after deploy, as each stored value heals back to the full ASM value — then
  the list should stop recurring. Confirm on a live sync (watch the dogs from the
  2026-06-30 example: Arcanine, Artemis, Bagel, Dot, Electro, Emma, Junior, Kaylie, Oliver).

## 6. ASM sync re-flags `inFosterSince` as changed every sync — FIXED 2026-06-30

- Foster dogs get `Updated: ... inFosterSince (DATE)` on every sync even when the foster
  date hasn't changed (e.g. Arcanine `inFosterSince 2024-11-08`, Kaylie
  `inFosterSince 2026-06-09`).
- Expected: only flag/write when the value actually changed.
- **Root cause (confirmed):** two writers store the field in different formats. ASM sync
  writes a plain date `"2024-11-08"` (`normalizeDateStr`); the app writes a full timestamp
  `"2024-11-08T00:00:00.000Z"` (`serializeDog` → `toDateString` → `toISOString`). The sync's
  change-detector compared `inFosterSince` **raw** (`stored !== v`) because it was missing
  from the `DATE_FIELDS` normalization set, so the two formats always read as "changed."
  Only foster dogs showed it (non-fosters have `null` on both sides → equal).
- **Fix (2026-06-30):** added `inFosterSince` to `DATE_FIELDS` in `src/lib/data/asm-sync.ts`
  so both sides are normalized to a plain date before comparing. Now it only flags on a real
  change. (`intakeDate`, `dateOfBirth`, microchip/fixed/vaccinated dates were already in the
  set; `inFosterSince` was the only ASM-written date field missing from it.)

## 7. Day-trip vaccine logic — FIX IMPLEMENTED 2026-06-30 (pending data verification)

- Problem: eligibility used a *count of vaccines given* (`vaccineCount` =
  ASM `VACCGIVENCOUNT`) with a `< 8` puppy threshold. That count inflates with non-core
  vaccines (bordetella, lepto, flu) and boosters, so it's an unreliable "fully vaccinated"
  signal. Also had a leftover `console.log('[puppy-vaccine] …')`.
- Research: ASM's `json_shelter_animals` feed exposes only aggregate counts, not per-vaccine
  detail. The better field is **`VACCOUTSTANDINGCOUNT`** (vaccinations still due). True
  per-vaccine records would require an authenticated `json_report` against the
  `animalvaccination` table (we have credentials) — deferred unless the count proves
  insufficient.
- **Fix (2026-06-30):** thread `VACCOUTSTANDINGCOUNT` through the data layer as
  `vaccinesOutstanding` (ASM sync → `Dog` → serialize/deserialize) and changed the rule in
  `checkDayTripEligibility` (`src/lib/utils/dates.ts`) to:
  eligible requires `isVaccinated` **AND** `vaccinesOutstanding === 0`. Removed the puppy
  `< 8` count rule and the debug log. The `isVaccinated` (given > 0) check stays, so a dog
  with **no** vaccine records is still blocked (outstanding 0 alone wouldn't catch them).
- **Pending verification (the one risk):** `VACCOUTSTANDINGCOUNT` is only meaningful if
  staff enter required/scheduled vaccinations with due dates in ASM. If they only log shots
  as "given" and never schedule the next round, outstanding reads 0 for everyone and the
  check would wave through incomplete puppies. Confirm against live data that known
  incomplete puppies show outstanding > 0 and done adults show 0 before trusting it in
  production.

## 8. Awaiting-evaluation dog still showed eligible (Hattie) — FIXED 2026-06-30

- Reported: Hattie had `awaitingEvaluation` **checked** but still appeared in Eligible, and
  re-checking the box didn't make it stick.
- The eligibility logic itself was never the problem — `checkDayTripEligibility`
  (`src/lib/utils/dates.ts`) and `isDayTripEligible` (`src/lib/utils/attention.ts`) both
  treat `awaitingEvaluation` as ineligible.
- **Root cause:** an **auto-clear** on page load (in both `src/routes/(app)/daytrips/+page.svelte`
  and `src/routes/(app)/dogs/+page.svelte`) set `awaitingEvaluation = false` for any dog that
  appears on the DT Numbers sheet with a color. It ran **every load**, so the moment a user
  re-checked the box, the next page load wiped it again → the dog kept reverting to eligible.
- **Fix (2026-06-30):** made the auto-clear **one-time** via a new `evaluationAutoCleared`
  flag (threaded through `Dog`/`StoredDog`/serialize/deserialize). The auto-clear now only
  fires when `awaitingEvaluation && !evaluationAutoCleared`, and sets `evaluationAutoCleared:
  true` when it does. After that first clear, a **manual re-check is respected** — it won't be
  auto-cleared again. Normal first-time behavior is unchanged.
- For an already-affected dog (Hattie): on the first load after deploy she gets auto-cleared
  once more and the marker is set; **re-check awaiting-evaluation once after that and it will
  stick** (she'll then read ineligible everywhere).

## 9. Puppies blocked from day trips until settled in — IMPLEMENTED 2026-06-30

- New policy (Camilla 2026-06-30): a **puppy** (under **6 months** by date of birth) is
  **not** day-trip eligible until it has been with us **30+ days**. Older dogs unaffected.
- **Implemented** in `checkDayTripEligibility` (`src/lib/utils/dates.ts`): `isPuppy` =
  `differenceInMonths(today, dateOfBirth) < 6`; `daysWithUs` from `intakeDate`; a puppy with
  `daysWithUs < 30` (or unknown intake → conservative block) is ineligible with reason
  "Puppy — needs 30+ days at the shelter before day trips". Folded into `blockedByStatus`
  and the status pill so it shows ineligible, not a green pill.
- Note: uses `intakeDate` for "time with us" (already passed into the function). If staff
  want re-entries to reset the clock, switch to `shelterSince ?? intakeDate` (would add one
  param + the 4 call sites). Parameters are named constants `PUPPY_MAX_AGE_MONTHS` (6) /
  `PUPPY_MIN_DAYS_AT_SHELTER` (30) in `src/lib/utils/dates.ts`.
- **Override (2026-06-30):** the 30-day rule is the default, but a manager can allow a
  specific under-30-day puppy out early via `dayTripPuppyOverride` (threaded through the data
  layer; `checkDayTripEligibility` skips the puppy block when set). Surfaced on the board: the
  per-card caret menu shows an "Allow day trips (under 30d)" toggle for underage dogs
  (`isUnderageForDayTrips` in `src/lib/utils/dates.ts`).
