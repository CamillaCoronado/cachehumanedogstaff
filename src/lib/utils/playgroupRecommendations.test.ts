import { describe, expect, it } from 'vitest';
import type { Dog, PlaygroupSession } from '$lib/types';
import {
	bucketByPlayStyle,
	buildTestSuggestions,
	checkSelectionWarnings,
	findKnownGoodPairs,
	getReadiness,
	isPuppy,
	isPuppyVaccinated,
	sizeCategory
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
		playStyles: ['gentle_and_dainty'],
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

describe('sizeCategory', () => {
	it('buckets by weight', () => {
		expect(sizeCategory(makeDog({ weightLbs: 10 }))).toBe('tiny');
		expect(sizeCategory(makeDog({ weightLbs: 20 }))).toBe('small');
		expect(sizeCategory(makeDog({ weightLbs: 55 }))).toBe('medium');
		expect(sizeCategory(makeDog({ weightLbs: 56 }))).toBe('large');
		expect(sizeCategory(makeDog({ weightLbs: null }))).toBe('unknown');
	});
});

describe('bucketByPlayStyle', () => {
	it('sorts single-tagged dogs into their own column', () => {
		const rowdy = makeDog({ name: 'Rowdy', playStyles: ['rough_and_rowdy'] });
		const gentle = makeDog({ name: 'Gentle', playStyles: ['gentle_and_dainty'] });
		const buckets = bucketByPlayStyle([rowdy, gentle]);
		expect(buckets.roughOnly.map((d) => d.name)).toEqual(['Rowdy']);
		expect(buckets.gentleOnly.map((d) => d.name)).toEqual(['Gentle']);
		expect(buckets.both).toHaveLength(0);
	});

	it('a dog tagged both styles lands in "both", not in either single column', () => {
		const dual = makeDog({ name: 'Dual', playStyles: ['rough_and_rowdy', 'gentle_and_dainty'] });
		const buckets = bucketByPlayStyle([dual]);
		expect(buckets.both.map((d) => d.name)).toEqual(['Dual']);
		expect(buckets.roughOnly).toHaveLength(0);
		expect(buckets.gentleOnly).toHaveLength(0);
	});

	it('untagged adults land in unassessed', () => {
		const untagged = makeDog({ name: 'Mystery', playStyles: [] });
		const buckets = bucketByPlayStyle([untagged]);
		expect(buckets.unassessed.map((d) => d.name)).toEqual(['Mystery']);
	});

	it('untagged puppies default to rough & rowdy, not unassessed', () => {
		const pup = makeDog({ name: 'Pup', playStyles: [], dateOfBirth: daysAgo(16 * 7) });
		const buckets = bucketByPlayStyle([pup]);
		expect(buckets.roughOnly.map((d) => d.name)).toEqual(['Pup']);
		expect(buckets.unassessed).toHaveLength(0);
	});

	it('solo-tagged dogs are excluded (they belong in the Solo Playtime column)', () => {
		const solo = makeDog({ name: 'Solo', playStyles: ['solo'] });
		const buckets = bucketByPlayStyle([solo]);
		expect(buckets.roughOnly).toHaveLength(0);
		expect(buckets.gentleOnly).toHaveLength(0);
		expect(buckets.both).toHaveLength(0);
		expect(buckets.unassessed).toHaveLength(0);
	});
});

describe('buildTestSuggestions', () => {
	it('returns a caution reason per dog, without any group matching', () => {
		const cautionDog = makeDog({ name: 'Caution', goodWithDogs: 'unknown' });
		const [suggestion] = buildTestSuggestions([cautionDog]);
		expect(suggestion.dog.name).toBe('Caution');
		expect(suggestion.reason).toContain('controlled intro');
	});
});

describe('checkSelectionWarnings', () => {
	it('flags a dog in isolation', () => {
		const dog = makeDog({ name: 'Sick', isolationStatus: 'iso' });
		const warnings = checkSelectionWarnings([dog, makeDog()]);
		expect(warnings.some((w) => w.message.includes('Sick is in isolation'))).toBe(true);
	});

	it('flags a dog on post-surgery rest', () => {
		const dog = makeDog({ name: 'Recovering', surgeryDate: daysAgo(2), surgeryRestDays: 10 });
		const warnings = checkSelectionWarnings([dog, makeDog()]);
		expect(warnings.some((w) => w.message.includes('Recovering is on medical'))).toBe(true);
	});

	it('flags an intact male + intact female together', () => {
		const male = makeDog({ name: 'Buck', isFixed: false, sex: 'male' });
		const female = makeDog({ name: 'Doe', isFixed: false, sex: 'female' });
		const warnings = checkSelectionWarnings([male, female]);
		expect(warnings.some((w) => w.id === 'intact-conflict')).toBe(true);
	});

	it('does not flag two intact males together', () => {
		const a = makeDog({ isFixed: false, sex: 'male' });
		const b = makeDog({ isFixed: false, sex: 'male' });
		expect(checkSelectionWarnings([a, b]).some((w) => w.id === 'intact-conflict')).toBe(false);
	});

	it('flags a wide size spread', () => {
		const tiny = makeDog({ weightLbs: 8 });
		const large = makeDog({ weightLbs: 70 });
		const warnings = checkSelectionWarnings([tiny, large]);
		expect(warnings.some((w) => w.id === 'size-mismatch')).toBe(true);
	});

	it('does not flag a reasonable size spread', () => {
		const a = makeDog({ weightLbs: 30 });
		const b = makeDog({ weightLbs: 45 });
		expect(checkSelectionWarnings([a, b]).some((w) => w.id === 'size-mismatch')).toBe(false);
	});

	it('returns no warnings for a clean selection', () => {
		expect(checkSelectionWarnings([makeDog(), makeDog()])).toEqual([]);
	});
});

describe('findKnownGoodPairs', () => {
	function makeSession(overrides: Partial<PlaygroupSession> = {}): PlaygroupSession {
		return {
			id: 'session-1',
			date: daysAgo(5),
			groupName: 'Group',
			dogIds: [],
			dogNames: [],
			recommendationType: 'manual',
			outcome: 'successful',
			notes: null,
			durationMinutes: null,
			loggedBy: 'u1',
			loggedByName: 'Staff',
			createdAt: daysAgo(5),
			...overrides
		} as PlaygroupSession;
	}

	it('surfaces a pair that played successfully together before', () => {
		const sessions = [makeSession({ dogIds: ['a', 'b', 'c'] })];
		const pairs = findKnownGoodPairs(['a', 'b'], sessions);
		expect(pairs).toHaveLength(1);
		expect(pairs[0].dogIds.sort()).toEqual(['a', 'b']);
		expect(pairs[0].count).toBe(1);
	});

	it('ignores cancelled and incident sessions', () => {
		const sessions = [
			makeSession({ dogIds: ['a', 'b'], outcome: 'cancelled' }),
			makeSession({ dogIds: ['a', 'b'], outcome: 'incident' })
		];
		expect(findKnownGoodPairs(['a', 'b'], sessions)).toEqual([]);
	});

	it('only counts a pair when both dogs are in the current selection', () => {
		const sessions = [makeSession({ dogIds: ['a', 'b'] })];
		expect(findKnownGoodPairs(['a', 'c'], sessions)).toEqual([]);
	});

	it('counts repeat pairings and tracks the most recent date', () => {
		const recent = daysAgo(2);
		const sessions = [
			makeSession({ dogIds: ['a', 'b'], date: daysAgo(20) }),
			makeSession({ dogIds: ['a', 'b'], date: recent })
		];
		const [pair] = findKnownGoodPairs(['a', 'b'], sessions);
		expect(pair.count).toBe(2);
		expect(pair.lastDate.getTime()).toBe(recent.getTime());
	});
});
