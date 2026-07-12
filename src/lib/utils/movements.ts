import type { Dog } from '$lib/types';
import { isSameCalendarDay } from '$lib/utils/dates';

export type DepartureOutcome = 'adopted' | 'transferred' | 'euthanized';

// Daily movement summary, derived entirely from fields the ASM sync already
// maintains — no extra logging needed:
//  - arrived:  first-time intakes (intakeDate today, not a re-entry)
//  - returned: back at the shelter today — adoption returns (reentryDates) or
//              foster returns / hitting the floor (shelterSince)
//  - toFoster: placed in a foster home today (inFosterSince)
//  - departed: archived today, with the outcome (adopted / transferred /
//              euthanized) so the UI can label each appropriately
export interface DailyMovements {
	arrived: Dog[];
	returned: Dog[];
	toFoster: Dog[];
	departed: { dog: Dog; outcome: DepartureOutcome }[];
}

export function getDailyMovements(dogs: Dog[], day: Date): DailyMovements {
	const arrived: Dog[] = [];
	const returned: Dog[] = [];
	const toFoster: Dog[] = [];
	const departed: { dog: Dog; outcome: DepartureOutcome }[] = [];

	for (const dog of dogs) {
		const intakeToday = isSameCalendarDay(dog.intakeDate, day);
		const reentryToday = (dog.reentryDates ?? []).some((d) => isSameCalendarDay(d, day));

		if (intakeToday && !reentryToday) arrived.push(dog);
		if (reentryToday || (!intakeToday && isSameCalendarDay(dog.shelterSince ?? null, day))) {
			returned.push(dog);
		}
		if (dog.inFoster && isSameCalendarDay(dog.inFosterSince ?? null, day)) toFoster.push(dog);

		if (dog.status === 'adopted' || dog.status === 'transferred' || dog.status === 'euthanized') {
			// Departures count strictly by leftShelterDate (the sync always sets it
			// at archive time). No updatedAt fallback: that made any later edit to
			// an archived dog — e.g. correcting its outcome — look like a fresh
			// departure on the day of the edit.
			if (isSameCalendarDay(dog.leftShelterDate ?? null, day)) {
				departed.push({ dog, outcome: dog.status });
			}
		}
	}

	const byName = (a: Dog, b: Dog) => a.name.localeCompare(b.name);
	arrived.sort(byName);
	returned.sort(byName);
	toFoster.sort(byName);
	departed.sort((a, b) => a.dog.name.localeCompare(b.dog.name));
	return { arrived, returned, toFoster, departed };
}
