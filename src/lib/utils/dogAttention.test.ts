import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { dogAttention, type TripEligibility } from './dogAttention';
import { pendingItems } from './dogCard';

const today = new Date(2026, 5, 12);
const eligible: TripEligibility = { eligible: true, status: 'eligible', reasons: [] } as TripEligibility;

function makeDog(overrides: Partial<Dog> = {}): Dog {
	return {
		id: 'dog-1',
		name: 'Rex',
		status: 'active',
		pottyTrained: 'yes',
		goodWithDogs: 'yes',
		goodWithCats: 'yes',
		goodWithKids: 'yes',
		goodOnLead: 'yes',
		crateTrained: 'yes',
		energyLevel: 'medium',
		handlingLevel: 'volunteer',
		dayTripStatus: 'eligible',
		isolationStatus: 'none',
		isOutOnDayTrip: false,
		inFoster: false,
		awaitingEvaluation: false,
		isFixed: true,
		isVaccinated: true,
		dateOfBirth: new Date(2022, 0, 1),
		intakeDate: new Date(2026, 4, 1),
		lastDayTripDate: new Date(2026, 5, 11),
		lastBathDate: new Date(2026, 5, 10),
		...overrides
	} as Dog;
}

const kinds = (dog: Dog, lastPlaygroupDate: Date | null = new Date(2026, 5, 11)) =>
	dogAttention(dog, { today, lastPlaygroupDate, tripEligibility: eligible }).map((f) => f.kind).sort();

describe('dogAttention', () => {
	it('flags nothing for a dog that is up to date', () => {
		expect(kinds(makeDog())).toEqual([]);
	});

	it('includes transfers still marked Incoming', () => {
		expect(kinds(makeDog({ isIncoming: true, lastBathDate: null }))).toEqual(['bath']);
	});

	it('leaves out foster, isolation and archived dogs entirely', () => {
		const due = { lastBathDate: null, goodWithCats: 'unknown' as const };
		expect(kinds(makeDog({ ...due, inFoster: true }))).toEqual([]);
		expect(kinds(makeDog({ ...due, isolationStatus: 'iso' as Dog['isolationStatus'] }))).toEqual([]);
		expect(kinds(makeDog({ ...due, status: 'adopted' }))).toEqual([]);
	});

	it('applies every rule: enrichment, day trip, dog test (no other evaluations)', () => {
		const dog = makeDog({
			goodWithDogs: 'unknown',
			lastDayTripDate: new Date(2026, 4, 20),
			lastYardDate: null
		});
		// No playgroup ever, trip 23 days ago, unknown with dogs.
		expect(kinds(dog, null)).toEqual(['daytrip', 'dogtest', 'enrichment']);
	});

	it('is exactly what the dog card lists as to-dos', () => {
		const dog = makeDog({ lastBathDate: null, goodWithCats: 'unknown', lastDayTripDate: new Date(2026, 4, 20) });
		const flags = dogAttention(dog, { today, lastPlaygroupDate: null, tripEligibility: eligible });
		const card = pendingItems(dog, eligible, null, today).map((i) => i.label);
		for (const f of flags) expect(card).toContain(f.label);
	});
});
