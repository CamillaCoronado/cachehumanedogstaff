# Duplicate dog records, and why they never depart

Known issue, not yet fixed. Written up 2026-09-01.

## What is happening

`createDog()` generates a random document id. It is called from the day-trips
Import tab (`src/lib/components/daytrips/ImportTab.svelte`) when a trip names a
dog missing from the roster, and from the manual "add dog" on the Dogs page.

The ASM sync keys its records by the ASM animal number instead. It cannot tell
that the app already made a record for the same animal — different id, and the
app-created record carries no `asmId` or `asmShelterCode` at all — so it creates
a second one.

The sync then never touches the first record again. It therefore never receives
a departure date and never leaves `status: 'active'`.

## Why it matters

A record that never departs looks present forever. The feeding fill-in, the
roster and anything else reading "who is here today" keeps counting it:

    Bubbles [50838]      ASM-keyed, adopted      27 imported feeding logs
    Bubbles [08d697df…]  app-created, "active"  177 imported feeding logs

The second record has been fed daily since the real dog left.

## This is not about archiving

Departed dogs are already handled properly: `markStaleAsmDogsArchived` marks them
adopted, transferred or euthanized when they stop appearing in ASM, and 245 of the
267 ASM-keyed records are archived that way. Those stay — they are the shelter's
history.

The duplicates are a different thing. Archiving one would leave two records for
the same dog, one archived and one live. They need merging into the ASM-keyed
record so its logs move across, and then removing, so a dog has one record and
one history.

## Scale as of 2026-09-01

- 341 dog records: 267 ASM-keyed, 74 app-created
- of the ASM-keyed, 22 active and 245 correctly archived
- 49 of the 74 app-created have no departure date, so they read as present
- 43 have a matching ASM record; 31 do not, though some of those are renames
  (ASM holds "Nova (Newsie)" where the app record says "Nova")
- ~8,900 of the 16,519 imported feeding logs sit on app-created records

## Fix

1. **Sync**: before creating a record for an ASM animal, look for an existing
   app-created record with that name and no `asmId`, and adopt it — write the
   ASM fields onto it, or merge it into the numbered record. This closes the
   hole; everything else is cleanup.
2. **Merge and remove**: `mergeDogs(keepId, deleteId)` already moves every subcollection
   and fills profile gaps, and the Admin page has a UI for it. Merge the 43
   matched pairs. Review the 31 unmatched by hand — some are renames, some may
   be dogs genuinely never in ASM.
3. **Re-run the backfill** afterwards, so the imported logs land on the
   surviving records.

Do the sync change first: merging before it is fixed only clears a backlog that
starts refilling.
