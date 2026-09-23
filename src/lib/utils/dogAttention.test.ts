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

describe('bath for transfers', () => {
	it('flags a transfer that moved off Incoming without a bath', () => {
		// shelterSince is stamped when a dog leaves Incoming; it is not a bath.
		const dior = makeDog({ intakeDate: new Date(2026, 5, 5), shelterSince: new Date(2026, 5, 8), lastBathDate: null });
		const bath = dogAttention(dior, { today, lastPlaygroupDate: new Date(2026, 5, 11), tripEligibility: eligible }).find((f) => f.kind === 'bath');
		expect(bath?.short).toContain('new intake');
	});

	it('counts a bath given while the dog was still in Incoming', () => {
		const bathed = makeDog({ intakeDate: new Date(2026, 5, 5), lastBathDate: new Date(2026, 5, 6), shelterSince: new Date(2026, 5, 8) });
		expect(kinds(bathed)).not.toContain('bath');
	});

	it('counts a return from foster as a bath — fosters bathe the dogs', () => {
		const back = makeDog({ intakeDate: new Date(2026, 1, 1), fosterReturnedAt: new Date(2026, 5, 1), lastBathDate: null });
		expect(kinds(back)).not.toContain('bath');
	});

	it('restarts the enrichment clocks on a foster return, but not the length of stay', () => {
		// Day trip well before foster; back from foster 3 days ago (today is 12 June).
		const back = makeDog({
			intakeDate: new Date(2026, 1, 1),
			lastDayTripDate: new Date(2026, 2, 1),
			lastYardDate: null,
			fosterReturnedAt: new Date(2026, 5, 9)
		});
		const flags = dogAttention(back, { today, lastPlaygroupDate: new Date(2026, 5, 11), tripEligibility: eligible });
		// Fresh clocks: 3 days since return is not overdue, and the pre-foster trip no
		// longer counts, so it reads "no day trip yet" rather than months overdue.
		expect(flags.map((f) => f.kind)).not.toContain('enrichment');
		expect(flags.find((f) => f.kind === 'daytrip')?.short).toBe('no day trip yet');
	});

	it('uses the later of a real bath and a foster return', () => {
		const back = makeDog({ intakeDate: new Date(2026, 1, 1), lastBathDate: new Date(2026, 1, 2), fosterReturnedAt: new Date(2026, 5, 1) });
		expect(kinds(back)).not.toContain('bath');
		const longAgo = makeDog({ intakeDate: new Date(2026, 1, 1), lastBathDate: new Date(2026, 1, 2), fosterReturnedAt: new Date(2026, 3, 1) });
		expect(kinds(longAgo)).toContain('bath');
	});

	it('flags a bath 30+ days after the last one this stay', () => {
		const due = makeDog({ intakeDate: new Date(2026, 3, 1), lastBathDate: new Date(2026, 4, 1) });
		expect(kinds(due)).toContain('bath');
	});
});
