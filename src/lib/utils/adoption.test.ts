import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { getAdoptionAvailability } from './adoption';

// Minimal dog that is otherwise fully adoptable, so each test isolates one hold.
function adoptableDog(overrides: Partial<Dog> = {}): Dog {
	return {
		id: 'dog-1',
		name: 'Rex',
		status: 'active',
		isMicrochipped: true,
		isVaccinated: true,
		isFixed: true,
		isolationStatus: 'none',
		isolationReason: null,
		dayTripStatus: 'eligible',
		dayTripIneligibleReason: null,
		dayTripManagerOnlyReason: null,
		dayTripNotes: null,
		handlingLevel: 'volunteer',
		notAdoptable: false,
		notAdoptableReason: null,
		sickHold: false,
		sickHoldReason: null,
		...overrides
	} as Dog;
}

describe('getAdoptionAvailability — sick hold', () => {
	it('is available when nothing is wrong', () => {
		expect(getAdoptionAvailability(adoptableDog()).state).toBe('available');
	});

	it('blocks adoption with a sick_hold state when sickHold is set', () => {
		const result = getAdoptionAvailability(adoptableDog({ sickHold: true }));
		expect(result.available).toBe(false);
		expect(result.state).toBe('sick_hold');
		expect(result.holdReason).toBe('sick — outbreak hold');
	});

	it('includes the reason in the hold text when provided', () => {
		const result = getAdoptionAvailability(
			adoptableDog({ sickHold: true, sickHoldReason: 'Coccidia — Merced' })
		);
		expect(result.holdReason).toBe('sick — Coccidia — Merced');
	});

	it('lets isolation take precedence over sick hold', () => {
		const result = getAdoptionAvailability(
			adoptableDog({ sickHold: true, isolationStatus: 'iso', isolationReason: 'sick' })
		);
		expect(result.state).toBe('isolation_hold');
	});

	it('clears the hold when sickHold is removed (reversible)', () => {
		expect(getAdoptionAvailability(adoptableDog({ sickHold: false })).state).toBe('available');
	});
});
