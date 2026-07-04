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

## Still pending owner sign-off (ask Camilla before touching)

- `startDayTrip`, `endDayTrip` (`data/dogs.ts`) — orphaned since out/return toggles
  became visual-only (2026-06-12). The visual-only model has been in daily use since;
  delete once confirmed it's staying.
- `markStaleAsmDogsArchived` (`data/asm-sync.ts`) — exported but unreferenced; was it
  meant to be wired into the sync flow?
- One-time migration tooling — delete once confirmed the migrations ran:
  `data/migrate-food-types.ts` (`migrateFoodTypes`, still imported by admin page) and
  `data/dogs.ts` `backfillBathLogsFromDogs`.

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
