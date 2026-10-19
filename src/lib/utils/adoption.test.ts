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
		hasFleas: false,
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

describe('getAdoptionAvailability — red dog', () => {
	it('blocks a red dog even when the profile is volunteer-handled and eligible', () => {
		const result = getAdoptionAvailability(adoptableDog({ manualTripColor: 'red' }));
		expect(result.available).toBe(false);
		expect(result.holdReason).toBe('red');
	});

	it("names the color's reason", () => {
		const result = getAdoptionAvailability(
			adoptableDog({ manualTripColor: 'red', manualTripColorReason: 'behavior' })
		);
		expect(result.holdReason).toBe('red: behavior');
	});

	it('leaves a yellow or green dog available', () => {
		expect(getAdoptionAvailability(adoptableDog({ manualTripColor: 'yellow' })).available).toBe(true);
		expect(getAdoptionAvailability(adoptableDog({ manualTripColor: 'green' })).available).toBe(true);
	});
});
