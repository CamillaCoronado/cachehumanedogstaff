# Unused / Unreferenced Code Inventory

Generated 2026-06-12 by scanning every `export function/const` in `src/lib` for
references outside its defining file (test files excluded). **Nothing here should be
deleted without first re-verifying it is unused** — the scan is text-based and a
function may be kept deliberately (public API surface, planned feature, admin tooling).
Deletions follow the ground rules in `refactor-plan.md`: verify, delete in its own
commit, `npm run check` against baseline.

## Probably safe to delete (no callers anywhere, including own file)

| Export | File | Notes |
|---|---|---|
| `eligiblePuppies` | `utils/playgroupRecommendations.ts` | never called; likely leftover from earlier puppy-group feature |
| `priorityLabel` | `utils/playgroupRecommendations.ts` | never called; all recommendations are `priority: 'high'` |
| `logDayTrip` | `data/dogs.ts` | superseded by `startDayTrip`/`endDayTrip`/`logManualTrip`? verify |
| `hasAnyUserProfiles` | `firebase/firestore.ts` | possibly from old admin-bootstrap flow (see security-hardening-notes.md) |
| `getEffectiveAdoptionDate`, `missingAdoptionMedicalRequirements` | `utils/adoption.ts` | check git history for when they lost their callers |
| `normalizeDay`, `ageInYears` | `utils/dates.ts` | no callers |
| `isPuppyFood`, `isNormalFood` | `utils/feeding.ts` | may relate to migrate-food-types; verify together |
| `dayTripLabel` | `utils/labels.ts` | no callers |
| `roleLabel`, `canHandleDog`, `handlingRequirementLabel` | `utils/permissions.ts` | no callers |
| `markStaleAsmDogsArchived` | `data/asm-sync.ts` | exported but unreferenced; was this meant to be wired into the sync flow? **ask before touching** |

## Dead page-level reactives (found during Phase 2, 2026-06-12)

- `daytrips/+page.svelte`: `yearLogs`, `yearlyStats`, `yearTripTotal`, `yearHourTotal` —
  computed on every change but rendered nowhere (likely superseded by the sheet-based
  StatsTab). Also `adoptionRequirementAction` in `utils/dogCard.ts` has no callers.

## Internal-only (used within their own file; exported unnecessarily or for tests)

Not dead code — just exports that could become module-private. Low priority.

- `utils/dates.ts`: `isMondayOrThursday` (used by `isSurgeryToday`)
- `utils/attention.ts`: `BATH_OVERDUE_DAYS`
- `utils/playgroupRecommendations.ts`: `isPuppyVaccinated`, `intactConflict`,
  `energyRank`, `dogEnergyRank`, `sizeRank`, `sizeCompatible` — engine internals,
  exported for unit tests; keep.

## One-time migration tooling (confirm migrations ran, then delete)

Already tracked in refactor-plan.md Phase 4:

- `data/migrate-food-types.ts` (`migrateFoodTypes`)
- `data/dogs.ts`: `backfillBathLogsFromDogs`

## Re-running the scan

```sh
for f in src/lib/utils/*.ts src/lib/data/*.ts src/lib/firebase/*.ts; do
  [[ "$f" == *.test.ts ]] && continue
  grep -oE "^export (async )?(function|const) [A-Za-z0-9_]+" "$f" | awk '{print $NF}' | while read -r n; do
    refs=$(grep -rE "\b${n}\b" src --include='*.svelte' --include='*.ts' -l | grep -v "$f" | grep -v '\.test\.ts' | wc -l | tr -d ' ')
    [[ "$refs" == "0" ]] && echo "$f: $n"
  done
done
```
