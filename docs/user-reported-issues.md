# User-Reported Issues — History

Log of issues Camilla reported and how they were resolved. Everything is fixed except
**#4**, a deferred feature. Dates are when the fix landed.

## 1. Feeding amount calculations feel wrong — RESOLVED 2026-06-12

Fixed a transcription error in the puppy 10–12mo / 20–35 lb cell of the "Serving Sizes"
wall chart in `estimateFoodAmountPerMeal` (`src/lib/utils/feeding.ts`); all chart values
now pinned by `feeding.test.ts`. Decision: the wall chart stays authoritative (staff's
per-meal conversion, not Hill's raw daily tables). Dogs with an explicit `foodAmount`
bypass the chart.

## 2. Snake route doesn't snake correctly — RESOLVED 2026-06-17

Replaced the row-index-alternating logic in `getWalkRank` (`src/lib/utils/kennelLayout.ts`)
with an explicit staff-confirmed `SNAKE_ROUTE_ORDER` (Puppy → 15→1 → 35 → 17–20 → 21–24 →
34→25 → Rock last); pinned by `kennelLayout.test.ts`.

## 3. Modals not viewport-centered / duplicate modal styling — FIXED 2026-06-30

Converted the feeding "didn't eat" panel and the playgroups "Log playgroup" modal to the
shared `Modal.svelte` (portals to `<body>`, one canonical style); removed their duplicate
markup/CSS and a dead local `portal()`. Also moved `will-change` off `.page-paper` (a
containing-block trap for fixed modals) onto the `.page-turn-*` classes. The
adoption/transfer/foster/incoming celebration overlays intentionally stay custom.

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
  type + small copy buttons on each page.

## 5. ASM sync re-flags "Hidden comments" every sync — FIXED 2026-06-30

A write-fight: ASM wrote the full `HIDDENANIMALDETAILS` (including "Day Trip Notes"), the
day-trips page stripped + re-saved them, so every sync saw a diff. Fix: removed the
strip-and-persist from `autoImportFromHiddenNotes`; ASM solely owns `hiddenComments`, and
the dog detail page strips notes for display only. Trip import unaffected (idempotent via
`importedTripId`).

## 6. ASM sync re-flags `inFosterSince` every sync — FIXED 2026-06-30

Date-format mismatch (ASM plain date vs app ISO timestamp) read as a change because
`inFosterSince` was missing from `DATE_FIELDS`. Fix: added it to `DATE_FIELDS` in
`src/lib/data/asm-sync.ts` so both sides normalize before comparing.

## 7. Day-trip vaccine rule — FIXED 2026-06-30

Replaced the unreliable "vaccines-given count < 8" puppy rule with ASM's
`VACCOUTSTANDINGCOUNT` (threaded through the data layer as `vaccinesOutstanding`): eligible
now requires `isVaccinated` AND `vaccinesOutstanding === 0`, in `checkDayTripEligibility`
(`src/lib/utils/dates.ts`). Removed the leftover debug log.

## 8. Awaiting-evaluation dog still showed eligible (Hattie) — FIXED 2026-06-30

A page-load auto-clear set `awaitingEvaluation = false` for any dog on the DT sheet with a
color, on **every** load — so a manual re-check never stuck. Fix: made the auto-clear
one-time via an `evaluationAutoCleared` flag; after the first clear, a manual re-check is
respected.

## 9. Puppies blocked from day trips until settled in — IMPLEMENTED 2026-06-30

Policy: a puppy (under 6 months) isn't day-trip eligible until 30+ days at the shelter
(constants `PUPPY_MAX_AGE_MONTHS` / `PUPPY_MIN_DAYS_AT_SHELTER` in `src/lib/utils/dates.ts`).
A manager can override per-dog via `dayTripPuppyOverride` (board caret menu → "Allow day
trips (under 30d)").
