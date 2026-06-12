# User-Reported Issues To Investigate

Reported by Camilla 2026-06-12 while reviewing the feeding page. These are behavior
checks/changes, **not** part of the refactor — handle separately, after or alongside
refactor phases, each as its own verified fix.

## 1. Feeding amount calculations feel wrong (verify correctness)

- The computed food amounts "often feel wrong."
- Where to look: `estimateFoodAmountPerMeal` in `src/lib/utils/feeding.ts` (used by
  `foodAmountLabel` on the feeding page when a dog has no explicit `foodAmount`).
- Plan: walk through the formula (weight/age/food-type based) with real examples and
  confirm against the chart the shelter actually feeds from; add unit tests pinning the
  expected amounts once confirmed.

## 2. Snake route doesn't snake correctly

- The "Snake Route" walk-path ordering on the feeding page does not produce the
  expected physical walking order.
- Where to look: `getWalkRank` in `src/lib/utils/kennelLayout.ts` (extracted 2026-06-12,
  behavior unchanged from the original page code — the bug predates the extraction).
- Note: ranking currently alternates direction by *row index* among rows that contain
  runs (rows 1, 2, 4, 6). Suspect the real route should account for the physical
  bridge/bank layout, not just row order. Get the expected run sequence from Camilla
  before changing; then pin it with a test.

## 3. Modals must be centered within the page (viewport)

- At least the "didn't eat" panel/modal on the feeding page centers within the content
  area instead of the full viewport. Audit all modals app-wide.
- Where to look: `src/lib/components/ui/Modal.svelte` (the shared modal) vs page-local
  modal/panel markup. Pages using local modals or panels (feeding's didn't-eat panel,
  stool modal, playgroups' manual/import modals, dogs page add-dog modal, etc.) may not
  use the shared component or may be missing a portal to `document.body`.
- Note: playgroups and dog-detail pages define a local `portal()` action for this —
  candidates to standardize on one shared modal/portal during Phase 2 component
  extraction, which would fix centering everywhere at once.

## 4. Feature: copy daily updates as Slack-formatted text

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
