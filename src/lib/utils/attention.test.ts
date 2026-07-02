import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { getOverdueDayTripDogs } from './attention';

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
		dayTripManagerOnly: false,
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

describe('getOverdueDayTripDogs', () => {
	it('does not flag puppies that are blocked by the day-trip puppy gate', () => {
		const today = new Date(2026, 3, 10);
		const dog = makeDog({
			intakeDate: new Date(2026, 2, 25),
			dateOfBirth: new Date(2026, 0, 15),
			lastDayTripDate: null
		});

		expect(getOverdueDayTripDogs([dog], today)).toEqual([]);
	});
});
