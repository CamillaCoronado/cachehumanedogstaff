# Page-by-Page Redesign Plan (Daily Shelter Operations)

## Design Principles

1. Every screen must answer: what is due now, what is blocked, what changed this shift.
2. One-click completion for repetitive tasks, with lightweight notes when needed.
3. Shared visibility across devices for all shift-critical status.
4. Clear separation between operational actions and administrative edits.

## Dashboard (`/`)

Current strength:
- Fast snapshot of feeding, cleaning, movement, foster, isolation, attention.

Redesign:
- Add assignee per action and "last updated by".
- Add handoff card (AM -> PM notes, unresolved blockers).
- Add SLA badges for due and overdue tasks.
- Pull cleaning and feeding completion from shared backend state, not local storage.

## Dogs Roster (`/dogs`)

Current strength:
- Useful priority cues and quick triage.

Redesign:
- Add saved filters: intake today, no enrichment 3d+, medical hold, foster.
- Add queue modes: "Intake Queue", "Care Queue", "Outcome Queue".
- Add bulk actions with role checks and audit notes.
- Move card action ranking rules into shared domain logic module.

## Dog Detail (`/dogs/[id]`)

Current strength:
- Rich profile with notes and logs.

Redesign:
- Convert to tabbed timeline model:
  - Summary
  - Medical
  - Behavior
  - Daily Care
  - Housing
  - Enrichment
  - Outcome
- Add immutable event timeline with typed events.
- Add warnings panel for cross-domain conflicts (surgery + feeding, isolation + playgroup).

## Kennels (`/kennels`)

Current strength:
- Excellent visual map and assignment workflow.

Redesign:
- Add occupancy rule panel (pairing constraints, max occupancy, isolation flags).
- Add conflict prevention before drop (hard block and reason).
- Add "next move suggestions" for cleaning/playgroup/day trip sequencing.
- Extract map layout config into a shared module used by feeding and kennels pages.

## Feeding (`/feeding`)

Current strength:
- Practical route-based execution and stool logging.

Redesign:
- Add route checkpoints with completion percent by zone.
- Add exception bucket pinned at top (surgery today, appetite risk, special diet).
- Add quick repeat templates for notes.
- Add care escalation action from abnormal stool entries.

## Cleaning (`/cleaning`)

Current strength:
- Thorough checklist content.

Redesign:
- Persist shift checklist to backend with assignees and timestamps.
- Add role lanes (cleaner/feeder/shared) with ownership controls.
- Add completion analytics (time-to-complete by shift).
- Add unresolved carry-over tasks visible on dashboard.

## Day Trips (`/daytrips`)

Current strength:
- Clear out-now / eligible / ineligible split.

Redesign:
- Add staff assignment and expected return time.
- Add incident note shortcut when marking returned.
- Add "due for trip" queue by days-since and behavior plan.
- Align actions to permissions so unavailable actions are disabled before submit.

## Playgroups (`/playgroups`)

Current strength:
- Readiness + recommendation starter workflow.

Redesign:
- Add pairing rationale transparency (scoring factors).
- Add incident protocol capture and follow-up tasks.
- Add yard/resource scheduling to avoid overlap conflicts.
- Add behavior progression tracking across sessions.

## Intake (`/intake`)

Current strength:
- Strong OCR/AI + manual parsing fallback.

Redesign:
- Split into steps:
  - Capture
  - Parse
  - Match/Deduplicate
  - Review
  - Apply
- Show confidence and diff view per field against existing profile.
- Add "required fields gate" for create/update apply.
- Break page and server logic into feature modules for maintainability.

## Suggested Execution Order

1. Backend-shared shift state (dashboard + cleaning).
2. Permission-aligned actions (day trips, user management, role checks).
3. Event timeline foundation for animal record.
4. Kennel/feed map shared config extraction.
5. Intake module split and diff-first review UX.

