import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import {
	buildRecommendations,
	buildTestSuggestions,
	getReadiness,
	intactConflict,
	isPuppy,
	isPuppyVaccinated,
	sizeCategory,
	sizeCompatible
} from './playgroupRecommendations';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

let nextId = 1;
function makeDog(overrides: Partial<Dog> = {}): Dog {
	return {
		id: `dog-${nextId++}`,
		name: overrides.name ?? `Dog ${nextId}`,
		sex: 'male',
		isFixed: true,
		isVaccinated: true,
		vaccineCount: 3,
		vaccinatedDate: daysAgo(60),
		dateOfBirth: daysAgo(3 * 365),
		weightLbs: 40,
		energyLevel: 'medium',
		goodWithDogs: 'yes',
		isolationStatus: 'none',
		isolationReason: null,
		surgeryDate: null,
		surgeryRestDays: null,
		dayTripStatus: 'eligible',
		status: 'active',
		...overrides
	} as Dog;
}

describe('isPuppy / isPuppyVaccinated', () => {
	it('treats under 26 weeks as puppy', () => {
		expect(isPuppy(makeDog({ dateOfBirth: daysAgo(10 * 7) }))).toBe(true);
		expect(isPuppy(makeDog({ dateOfBirth: daysAgo(30 * 7) }))).toBe(false);
		expect(isPuppy(makeDog({ dateOfBirth: null as unknown as Dog['dateOfBirth'] }))).toBe(false);
	});

	it('requires 2+ rounds and 14+ days since last shot', () => {
		expect(isPuppyVaccinated(makeDog({ vaccineCount: 1 }))).toBe(false);
		expect(isPuppyVaccinated(makeDog({ vaccineCount: 2, vaccinatedDate: daysAgo(5) }))).toBe(false);
		expect(isPuppyVaccinated(makeDog({ vaccineCount: 2, vaccinatedDate: daysAgo(15) }))).toBe(true);
		expect(isPuppyVaccinated(makeDog({ vaccineCount: 2, vaccinatedDate: null }))).toBe(false);
	});
});

describe('intactConflict', () => {
	it('flags intact male + intact female together', () => {
		const intactMale = makeDog({ isFixed: false, sex: 'male' });
		const intactFemale = makeDog({ isFixed: false, sex: 'female' });
		const fixedFemale = makeDog({ isFixed: true, sex: 'female' });
		expect(intactConflict([intactMale, intactFemale])).toBe(true);
		expect(intactConflict([intactMale, fixedFemale])).toBe(false);
		expect(intactConflict([intactMale])).toBe(false);
	});
});

describe('getReadiness', () => {
	it('holds isolated, not-dog-social, and post-surgery dogs', () => {
		expect(getReadiness(makeDog({ isolationStatus: 'iso' }))).toBe('hold');
		expect(getReadiness(makeDog({ goodWithDogs: 'no' }))).toBe('hold');
		expect(getReadiness(makeDog({ surgeryDate: daysAgo(2), surgeryRestDays: 7 }))).toBe('hold');
	});

	it('holds too-young or under-vaccinated puppies', () => {
		expect(getReadiness(makeDog({ dateOfBirth: daysAgo(10 * 7) }))).toBe('hold');
		expect(getReadiness(makeDog({ dateOfBirth: daysAgo(16 * 7), vaccineCount: 1 }))).toBe('hold');
	});

	it('marks vaccinated 12+ week puppies and dog-social adults ready', () => {
		expect(getReadiness(makeDog({ dateOfBirth: daysAgo(16 * 7) }))).toBe('ready');
		expect(getReadiness(makeDog())).toBe('ready');
	});

	it('marks unknown compatibility as caution', () => {
		expect(getReadiness(makeDog({ goodWithDogs: 'unknown' }))).toBe('caution');
	});
});

describe('sizeCategory / sizeCompatible', () => {
	it('buckets by weight', () => {
		expect(sizeCategory(makeDog({ weightLbs: 10 }))).toBe('tiny');
		expect(sizeCategory(makeDog({ weightLbs: 20 }))).toBe('small');
		expect(sizeCategory(makeDog({ weightLbs: 55 }))).toBe('medium');
		expect(sizeCategory(makeDog({ weightLbs: 56 }))).toBe('large');
		expect(sizeCategory(makeDog({ weightLbs: null }))).toBe('unknown');
	});

	it('rejects tiny with non-tiny and >2x weight spread', () => {
		expect(sizeCompatible([makeDog({ weightLbs: 10 }), makeDog({ weightLbs: 40 })])).toBe(false);
		expect(sizeCompatible([makeDog({ weightLbs: 20 }), makeDog({ weightLbs: 45 })])).toBe(false);
		expect(sizeCompatible([makeDog({ weightLbs: 30 }), makeDog({ weightLbs: 55 })])).toBe(true);
		expect(sizeCompatible([makeDog({ weightLbs: null }), makeDog({ weightLbs: null })])).toBe(true);
	});
});

describe('buildRecommendations', () => {
	it('groups 2-4 size-compatible dogs and lists leftovers as swap-ins', () => {
		const dogs = [
			makeDog({ name: 'A', weightLbs: 30 }),
			makeDog({ name: 'B', weightLbs: 35 }),
			makeDog({ name: 'C', weightLbs: 40 }),
			makeDog({ name: 'D', weightLbs: 45 }),
			// 100 lbs can't pair with anyone ≤50: ends up a swap-in candidate
			makeDog({ name: 'Solo', weightLbs: 100 })
		];
		const { groups, swapIns } = buildRecommendations(dogs);
		expect(groups).toHaveLength(1);
		expect(groups[0].dogs.map((d) => d.name)).toEqual(['A', 'B', 'C', 'D']);
		expect(groups[0].recommendationType).toBe('ready_group');
		expect(swapIns.map((s) => s.dog.name)).toEqual(['Solo']);
		expect(swapIns[0].compatibleGroups).toHaveLength(0);
	});

	it('skips groups with an intact male/female conflict', () => {
		const dogs = [
			makeDog({ name: 'M', weightLbs: 30, isFixed: false, sex: 'male' }),
			makeDog({ name: 'F', weightLbs: 32, isFixed: false, sex: 'female' })
		];
		const { groups } = buildRecommendations(dogs);
		expect(groups).toHaveLength(0);
	});

	it('ignores dogs with unknown weight', () => {
		const { groups, swapIns } = buildRecommendations([
			makeDog({ weightLbs: null }),
			makeDog({ weightLbs: null })
		]);
		expect(groups).toHaveLength(0);
		expect(swapIns).toHaveLength(0);
	});
});

describe('buildTestSuggestions', () => {
	it('suggests the energy-closest compatible ready group', () => {
		const calmGroup = {
			id: 'g1',
			title: 'Ready Group 1',
			dogs: [makeDog({ weightLbs: 40, energyLevel: 'low' }), makeDog({ weightLbs: 42, energyLevel: 'low' })],
			dogIds: [],
			reason: '',
			recommendationType: 'ready_group' as const,
			priority: 'high' as const
		};
		const wildGroup = {
			...calmGroup,
			id: 'g2',
			title: 'Ready Group 2',
			dogs: [makeDog({ weightLbs: 40, energyLevel: 'very_high' }), makeDog({ weightLbs: 42, energyLevel: 'very_high' })]
		};
		const cautionDog = makeDog({ goodWithDogs: 'unknown', weightLbs: 41, energyLevel: 'very_high' });
		const [suggestion] = buildTestSuggestions([cautionDog], [calmGroup, wildGroup]);
		expect(suggestion.suggestedGroup?.id).toBe('g2');
		expect(suggestion.reason).toContain('controlled intro');
	});

	it('returns null group when nothing is size-compatible', () => {
		const group = {
			id: 'g1',
			title: 'Ready Group 1',
			dogs: [makeDog({ weightLbs: 100 }), makeDog({ weightLbs: 90 })],
			dogIds: [],
			reason: '',
			recommendationType: 'ready_group' as const,
			priority: 'high' as const
		};
		const tinyDog = makeDog({ goodWithDogs: 'unknown', weightLbs: 10 });
		const [suggestion] = buildTestSuggestions([tinyDog], [group]);
		expect(suggestion.suggestedGroup).toBeNull();
	});
});
