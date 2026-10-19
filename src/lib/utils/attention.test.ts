import { describe, expect, it } from 'vitest';
import type { Dog, PlaygroupSession } from '$lib/types';
import { getCautionDogs, getOverdueEnrichmentDogs } from './attention';

function makeDog(overrides: Partial<Dog> = {}): Dog {
	return {
		id: 'dog-1',
		name: 'Pip',
		breed: 'mixed',
		sex: 'unknown',
		intakeDate: new Date(2026, 2, 1),
		originalIntakeDate: new Date(2026, 2, 1),
		reentryDates: [],
		dateOfBirth: new Date(2026, 0, 15),
		weightLbs: 10,
		foodType: 'kibble',
		foodAmount: '1 cup',
		dietaryNotes: '',
		origin: 'intake',
		pottyTrained: 'unknown',
		goodWithDogs: 'yes',
		goodWithCats: 'unknown',
		goodWithKids: 'unknown',
		idealHome: '',
		energyLevel: 'medium',
		outdoorKennelAssignment: 'A1',
		lastBathDate: null,
		lastDayTripDate: null,
		isOutOnDayTrip: false,
		currentDayTripStartedAt: null,
		surgeryDate: null,
		surgeryRestDays: null,
		lastSurgeryDate: null,
		fortifloraDate: null,
		fortifloraDays: null,
		fortifloraTime: null,
		isMicrochipped: false,
		isFixed: true,
		fixedDate: null,
		isVaccinated: true,
		vaccineCount: 0,
		vaccinesOutstanding: 0,
		vaccinatedDate: null,
		dayTripStatus: 'eligible',
		dayTripIneligibleReason: null,
		dayTripManagerOnlyReason: null,
		dayTripNotes: null,
		handlingLevel: 'volunteer',
		inFoster: false,
		isolationStatus: 'none',
		isolationReason: null,
		isolationUntilDate: null,
		status: 'active',
		createdAt: new Date(2026, 2, 1),
		updatedAt: new Date(2026, 2, 1),
		...overrides
	} as Dog;
}

function makeSession(dogId: string, date: Date): PlaygroupSession {
	return {
		id: 'pg-1',
		date,
		groupName: 'Group A',
		dogIds: [dogId],
		dogNames: ['Pip'],
		recommendationType: 'manual',
		outcome: 'successful',
		notes: null
	} as PlaygroupSession;
}

describe('getCautionDogs', () => {
	const today = new Date(2026, 6, 16);

	it('flags an adult with unknown dog compatibility and no playgroup history', () => {
		const adult = makeDog({ goodWithDogs: 'unknown', dateOfBirth: new Date(2024, 0, 1) });
		expect(getCautionDogs([adult], [], today)).toEqual([adult]);
	});

	it('exempts puppies — presumed good with dogs/cats/kids, no test needed', () => {
		const puppy = makeDog({ goodWithDogs: 'unknown', dateOfBirth: new Date(2026, 3, 1) });
		expect(getCautionDogs([puppy], [], today)).toEqual([]);
	});

	it('still flags a dog of unknown age', () => {
		const unknownAge = makeDog({ goodWithDogs: 'unknown', dateOfBirth: null });
		expect(getCautionDogs([unknownAge], [], today)).toEqual([unknownAge]);
	});

	it('a dog past the puppy cutoff is no longer exempt', () => {
		const grownUp = makeDog({ goodWithDogs: 'unknown', dateOfBirth: new Date(2025, 6, 1) });
		expect(getCautionDogs([grownUp], [], today)).toEqual([grownUp]);
	});
});

describe('getOverdueEnrichmentDogs', () => {
	const today = new Date(2026, 3, 10);

	it('flags a dog with no day trip, playgroup, or yard time in 7+ days', () => {
		const dog = makeDog({ intakeDate: new Date(2026, 2, 25) });
		const items = getOverdueEnrichmentDogs([dog], [], today);
		expect(items).toHaveLength(1);
		expect(items[0].days).toBe(16);
	});

	it('any one activity inside the window resets the clock', () => {
		const recent = new Date(2026, 3, 6);
		expect(getOverdueEnrichmentDogs([makeDog({ lastDayTripDate: recent })], [], today)).toEqual([]);
		expect(getOverdueEnrichmentDogs([makeDog({ lastYardDate: recent })], [], today)).toEqual([]);
		expect(getOverdueEnrichmentDogs([makeDog()], [makeSession('dog-1', recent)], today)).toEqual([]);
	});

	it('ignores activity from before the dog (re)arrived at the shelter', () => {
		const dog = makeDog({
			shelterSince: new Date(2026, 2, 25),
			lastYardDate: new Date(2026, 2, 20)
		});
		const items = getOverdueEnrichmentDogs([dog], [], today);
		expect(items).toHaveLength(1);
		expect(items[0].days).toBe(16);
	});

	it('excludes foster dogs but includes incoming ones (transfers)', () => {
		expect(getOverdueEnrichmentDogs([makeDog({ inFoster: true })], [], today)).toEqual([]);
		expect(getOverdueEnrichmentDogs([makeDog({ isIncoming: true })], [], today)).toHaveLength(1);
	});

	it('hides dogs on medical rest or manager-only handling while the clock keeps running', () => {
		const resting = makeDog({ surgeryDate: new Date(2026, 3, 8), surgeryRestDays: 7 });
		expect(getOverdueEnrichmentDogs([resting], [], today)).toEqual([]);

		const managerOnly = makeDog({ handlingLevel: 'manager_only' });
		expect(getOverdueEnrichmentDogs([managerOnly], [], today)).toEqual([]);

		// Once the restriction lifts, the accumulated gap shows immediately.
		const lifted = makeDog({ handlingLevel: 'staff_only' });
		expect(getOverdueEnrichmentDogs([lifted], [], today)).toHaveLength(1);
	});

	it('pauses the enrichment clock for isolation and sick-hold dogs', () => {
		const overdueIntake = new Date(2026, 2, 25); // would be 16 days overdue
		expect(
			getOverdueEnrichmentDogs([makeDog({ intakeDate: overdueIntake, isolationStatus: 'iso' })], [], today)
		).toEqual([]);
		expect(
			getOverdueEnrichmentDogs([makeDog({ intakeDate: overdueIntake, sickHold: true })], [], today)
		).toEqual([]);
	});

	it("doesn't count a hold's days once it lifts, but counts the days before it", () => {
		// Arrived Mar 25, sick Apr 1 → Apr 8: 7 days before the hold + 2 since → 9.
		const dog = makeDog({
			intakeDate: new Date(2026, 2, 25),
			enrichmentHoldStart: new Date(2026, 3, 1),
			enrichmentResetDate: new Date(2026, 3, 8)
		});
		const items = getOverdueEnrichmentDogs([dog], [], today);
		expect(items).toHaveLength(1);
		expect(items[0].days).toBe(9);

		// Enrichment during the hold's run-up only counts the days after it.
		const recent = makeDog({
			intakeDate: new Date(2026, 2, 25),
			lastYardDate: new Date(2026, 2, 31),
			enrichmentHoldStart: new Date(2026, 3, 1),
			enrichmentResetDate: new Date(2026, 3, 8)
		});
		expect(getOverdueEnrichmentDogs([recent], [], today)).toEqual([]);
	});

	it('ignores a hold end stamped before hold starts were recorded', () => {
		const dog = makeDog({
			intakeDate: new Date(2026, 2, 25),
			enrichmentResetDate: new Date(2026, 3, 8)
		});
		const items = getOverdueEnrichmentDogs([dog], [], today);
		expect(items).toHaveLength(1);
		expect(items[0].days).toBe(16);
	});
});
