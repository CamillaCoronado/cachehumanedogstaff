import type { Dog } from '$lib/types';
import { isSameCalendarDay } from '$lib/utils/dates';

// Daily movement summary, derived entirely from fields the ASM sync already
// maintains — no extra logging needed:
//  - arrived:  first-time intakes (intakeDate today, not a re-entry)
//  - returned: back at the shelter today — adoption returns (reentryDates) or
//              foster returns / hitting the floor (shelterSince)
//  - toFoster: placed in a foster home today (inFosterSince)
//  - adopted:  archived today with an outcome (includes transfers, flagged so
//              the UI can label them)
export interface DailyMovements {
	arrived: Dog[];
	returned: Dog[];
	toFoster: Dog[];
	adopted: { dog: Dog; transferred: boolean }[];
}

export function getDailyMovements(dogs: Dog[], day: Date): DailyMovements {
	const arrived: Dog[] = [];
	const returned: Dog[] = [];
	const toFoster: Dog[] = [];
	const adopted: { dog: Dog; transferred: boolean }[] = [];

	for (const dog of dogs) {
		const intakeToday = isSameCalendarDay(dog.intakeDate, day);
		const reentryToday = (dog.reentryDates ?? []).some((d) => isSameCalendarDay(d, day));

		if (intakeToday && !reentryToday) arrived.push(dog);
		if (reentryToday || (!intakeToday && isSameCalendarDay(dog.shelterSince ?? null, day))) {
			returned.push(dog);
		}
		if (dog.inFoster && isSameCalendarDay(dog.inFosterSince ?? null, day)) toFoster.push(dog);

		if (dog.status === 'adopted' || dog.status === 'transferred') {
			// leftShelterDate carries the real movement date when ASM provided one;
			// archived-today with no date falls back to updatedAt (set at archive time).
			const leftToday = dog.leftShelterDate
				? isSameCalendarDay(dog.leftShelterDate, day)
				: isSameCalendarDay(dog.updatedAt, day);
			if (leftToday) adopted.push({ dog, transferred: dog.status === 'transferred' });
		}
	}

	const byName = (a: Dog, b: Dog) => a.name.localeCompare(b.name);
	arrived.sort(byName);
	returned.sort(byName);
	toFoster.sort(byName);
	adopted.sort((a, b) => a.dog.name.localeCompare(b.dog.name));
	return { arrived, returned, toFoster, adopted };
}
