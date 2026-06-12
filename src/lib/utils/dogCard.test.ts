import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import {
	adoptionLabel,
	missingEvaluations,
	pendingItems,
	toSearchText,
	tripLabel,
	type TripEligibility
} from './dogCard';

const today = new Date(2026, 5, 12);

function makeDog(overrides: Partial<Dog> = {}): Dog {
	return {
		id: 'dog-1',
		name: 'Rex',
		breed: 'Lab',
		sex: 'male',
		origin: '',
		idealHome: '',
		pottyTrained: 'yes',
		goodWithDogs: 'no',
		goodWithCats: 'yes',
		goodWithKids: 'yes',
		goodOnLead: 'yes',
		crateTrained: 'yes',
		energyLevel: 'medium',
		handlingLevel: 'volunteer',
		dayTripManagerOnly: false,
		dayTripStatus: 'eligible',
		isolationStatus: 'none',
		isOutOnDayTrip: false,
		inFoster: false,
		awaitingEvaluation: false,
		isFixed: true,
		isVaccinated: true,
		isMicrochipped: true,
		intakeDate: new Date(2026, 4, 1),
		lastDayTripDate: new Date(2026, 5, 11),
		lastBathDate: new Date(2026, 5, 10),
		...overrides
	} as Dog;
}

const eligible: TripEligibility = { eligible: true, status: 'eligible', reasons: [] };

describe('tripLabel', () => {
	it('labels each status with manager-only and notes variants', () => {
		expect(tripLabel('eligible', null, false)).toBe('Day Trip: Eligible');
		expect(tripLabel('eligible', null, true)).toBe('Day Trip: Manager only');
		expect(tripLabel('difficult', 'pulls hard', false)).toBe('Day Trip: Adults only - pulls hard');
		expect(tripLabel('ineligible', null, false)).toBe('Day Trip: Ineligible');
	});
});

describe('missingEvaluations', () => {
	it('lists unknown evaluation fields', () => {
		expect(missingEvaluations(makeDog())).toEqual([]);
		expect(missingEvaluations(makeDog({ goodWithDogs: 'unknown', energyLevel: 'unknown' }))).toEqual([
			'dogs',
			'energy'
		]);
	});
});

describe('pendingItems', () => {
	it('puts the out-on-trip notice first', () => {
		const items = pendingItems(makeDog({ isOutOnDayTrip: true }), eligible, false, null, today);
		expect(items[0].label).toContain('Currently out on day trip');
		expect(items[0].tone).toBe('info');
	});

	it('flags bath due as an actionable ready item', () => {
		const items = pendingItems(makeDog(), eligible, true, null, today);
		const bath = items.find((i) => i.action === 'log_bath');
		expect(bath?.tone).toBe('ready');
	});

	it('sorts by priority descending (evaluation above bath)', () => {
		const dog = makeDog({ goodWithDogs: 'unknown' });
		const items = pendingItems(dog, eligible, true, null, today);
		const evalIdx = items.findIndex((i) => i.label.startsWith('Needs evaluation'));
		const bathIdx = items.findIndex((i) => i.action === 'log_bath');
		expect(evalIdx).toBeGreaterThanOrEqual(0);
		expect(evalIdx).toBeLessThan(bathIdx);
	});

	it('treats manager-only reasons as info when otherwise eligible', () => {
		const elig: TripEligibility = { eligible: true, status: 'eligible', reasons: ['Manager only: senior staff'] };
		const items = pendingItems(makeDog(), elig, false, null, today);
		expect(items.find((i) => i.label.includes('Manager only'))?.tone).toBe('info');
	});
});

describe('adoptionLabel / toSearchText', () => {
	it('labels an available dog and searches by labels', () => {
		const dog = makeDog();
		expect(adoptionLabel(dog)).toBe('Adoption: Available');
		expect(toSearchText(dog)).toContain('rex');
		expect(toSearchText(dog)).toContain('lab');
	});
});
