# Shelter App v2 Information Architecture

## Goals

1. Keep daily operations fast for staff on shift.
2. Keep one canonical record per animal with a full care timeline.
3. Make shared shift progress visible in real time across devices.
4. Support reporting, exports, and integrations without page-specific hacks.

## Route Map

- `/` Shift Ops Board
  - Today status, handoff notes, blockers, quick actions
  - AM/PM split with assignees and completion timestamps
- `/animals`
  - Search, filters, saved views, intake queue, foster queue
- `/animals/[id]`
  - Tabs: Summary, Medical, Behavior, Daily Care, Housing, Enrichment, Outcome, Documents
- `/operations/feeding`
  - Route order, care exceptions, stool/food intake logging
- `/operations/cleaning`
  - Shared checklist per shift with assigned owners and audit history
- `/operations/housing`
  - Kennel map, occupancy constraints, drag/drop assignment, conflict warnings
- `/operations/enrichment`
  - Day trips, playgroups, walk plans, due/overdue queues
- `/intake`
  - AI/manual parse, duplicate resolution, review/apply queue
- `/admin/users`
  - Roles, account status, invite flow
- `/reports`
  - Shift completion, care compliance, LOS, enrichment cadence, outcomes

## Domain Model

Use an event-first model so every operation appends a timeline record and updates a read model.

- `animals/{animalId}`
  - static and current fields only (status, housing, current care flags)
- `animals/{animalId}/events/{eventId}`
  - immutable timeline events: intake, feeding, stool, behavior note, move, day trip start/end, playgroup, med admin, foster move, outcome
- `operations/{dateShiftId}`
  - shared shift board state (task definitions, completion, assignees, notes)
- `housingAssignments/{assignmentId}`
  - normalized occupancy records for conflict checks and reporting
- `playgroupSessions/{sessionId}`
  - keep, but linked back to `animal.events`
- `users/{userId}`
  - profile and role only

## Data Access Pattern

Replace per-animal fanout reads with index-friendly queries.

- Shift board: query `operations/{dateShiftId}` once, then targeted event summaries.
- Feeding page: query today feeding/stool events once, group in memory by animal.
- Day trips: query open trips and month range from event collection or dedicated read model.
- Animal detail: query `animals/{id}` + paged `events` by type/date.

## Permissions Model

Role policy should be explicit and shared between UI and Firestore rules.

- `staff`
  - read all operational records
  - create care events (feeding/stool/notes/playgroups/day trip logs)
  - complete assigned shift tasks
- `manager`
  - everything staff can do
  - edit animal records and housing assignments
  - override operational constraints
- `admin`
  - everything manager can do
  - manage users/roles/system configuration

## Frontend Module Boundaries

Break the largest route files into feature modules.

- `src/lib/features/animals/*`
- `src/lib/features/operations/feeding/*`
- `src/lib/features/operations/cleaning/*`
- `src/lib/features/operations/housing/*`
- `src/lib/features/intake/*`
- `src/lib/features/reports/*`

Each feature should have:

- `data.ts` (queries/writes)
- `domain.ts` (business rules)
- `ui/` (components)
- `store.ts` (view state)

## Migration Plan

1. Introduce shared `operations/{dateShiftId}` for cleaning and dashboard progress.
2. Add event write-through for new logs while preserving current collections.
3. Move feeding/day-trip pages to event queries to remove fanout reads.
4. Split giant intake and dog detail pages into feature modules.
5. Add reports page backed by read models.

