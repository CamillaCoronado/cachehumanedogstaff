import { describe, expect, it } from 'vitest';
import type { Dog, FeedingLog, StoolLog } from '$lib/types';
import {
	appetiteRiskLabel,
	estimateFoodAmountPerMeal,
	feedingFlags,
	foodAmountLabel,
	getAbnormalCount,
	getFedMap,
	getFeedingHistoryEntries,
	isFastingMeal,
	isSpecialFeeding,
	secondMealAmountLabel,
	specialFeedingReasons
} from './feeding';

function makeDog(overrides: Partial<Dog> = {}): Dog {
	return {
		id: overrides.id ?? 'dog-1',
		name: overrides.name ?? 'Rex',
		foodType: 'Normal',
		foodAmount: '',
		dietaryNotes: '',
		...overrides
	} as Dog;
}

// Expectations verified against the shelter's "Serving Sizes" wall chart
// (photo provided 2026-06-12; docs/user-reported-issues.md #1).
describe('estimateFoodAmountPerMeal (per shelter wall chart)', () => {
	it('reads adults off the weight chart', () => {
		expect(estimateFoodAmountPerMeal({ weightLbs: 8 })).toBe('1/2 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 30 })).toBe('1 1/4 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 65 })).toBe('2 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 100 })).toBe('2 3/4 c');
	});

	it('extends past 100 lbs by 1/4 cup per 10 lbs', () => {
		expect(estimateFoodAmountPerMeal({ weightLbs: 110 })).toBe('3 c');
	});

	it('uses puppy bands by age', () => {
		const now = new Date(2026, 5, 12);
		const dobMonthsAgo = (m: number) => new Date(2026, 5 - m, 12);
		expect(estimateFoodAmountPerMeal({ weightLbs: 10, dateOfBirth: dobMonthsAgo(2), now })).toBe('1 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 10, dateOfBirth: dobMonthsAgo(6), now })).toBe('3/4 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 10, dateOfBirth: dobMonthsAgo(11), now })).toBe('1/2 c');
	});

	it('matches the wall chart 10-12 month column (regression: rows were shifted)', () => {
		const now = new Date(2026, 5, 12);
		const dob = new Date(2025, 6, 12); // 11 months old
		expect(estimateFoodAmountPerMeal({ weightLbs: 20, dateOfBirth: dob, now })).toBe('1 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 25, dateOfBirth: dob, now })).toBe('1 1/4 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 30, dateOfBirth: dob, now })).toBe('1 1/2 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 35, dateOfBirth: dob, now })).toBe('1 3/4 c');
		expect(estimateFoodAmountPerMeal({ weightLbs: 40, dateOfBirth: dob, now })).toBe('1 3/4 c');
	});

	it('falls back to mid puppy band when age unknown but puppy food selected', () => {
		expect(estimateFoodAmountPerMeal({ weightLbs: 10, foodType: 'Puppy' })).toBe('3/4 c');
	});

	it('returns empty for missing or invalid weight', () => {
		expect(estimateFoodAmountPerMeal({ weightLbs: null })).toBe('');
		expect(estimateFoodAmountPerMeal({ weightLbs: 0 })).toBe('');
	});
});

describe('foodAmountLabel / secondMealAmountLabel', () => {
	it('prefers the explicit amount, then the estimate, then em dash', () => {
		expect(foodAmountLabel(makeDog({ foodAmount: '2 scoops' }))).toBe('2 scoops');
		expect(foodAmountLabel(makeDog({ weightLbs: 30 }))).toBe('1 1/4 c');
		expect(foodAmountLabel(makeDog({ weightLbs: null }))).toBe('—');
	});

	it('second meal falls back to the regular amount', () => {
		expect(secondMealAmountLabel(makeDog({ secondMealAmount: '1 c', foodAmount: '2 c' }))).toBe('1 c');
		expect(secondMealAmountLabel(makeDog({ foodAmount: '2 c' }))).toBe('2 c');
	});
});

describe('specialFeedingReasons / feedingFlags', () => {
	it('collects allergy, own food, and supplement reasons', () => {
		const dog = makeDog({ allergyTypes: ['chicken'], hasOwnFood: true, hasSupplements: true });
		const reasons = specialFeedingReasons(dog);
		expect(reasons).toContain('Allergy: chicken');
		expect(reasons).toContain('Own Food');
		expect(reasons).toContain('Supplements');
		expect(feedingFlags(dog)).toEqual(['Allergy', 'Supplements']);
		expect(isSpecialFeeding(dog)).toBe(true);
		expect(isSpecialFeeding(makeDog())).toBe(false);
	});

	it('scopes FortiFlora to its meal and never the second meal', () => {
		const dog = makeDog({ fortifloraDate: new Date(), fortifloraTime: 'am' });
		expect(specialFeedingReasons(dog, 'am')).toContain('FortiFlora (AM)');
		expect(specialFeedingReasons(dog, 'pm')).toHaveLength(0);
		expect(specialFeedingReasons(dog, 'second')).toHaveLength(0);
	});
});

describe('log aggregation', () => {
	const day = new Date(2026, 5, 12, 9);
	const dog = makeDog({ id: 'd1', name: 'Rex' });
	const log = (overrides: Partial<FeedingLog>): FeedingLog =>
		({ id: 'l1', date: day, mealTime: 'am', amountEaten: 'all', notes: null, loggedByName: 'Cam', createdAt: day, ...overrides }) as FeedingLog;

	it('getFedMap matches meal and calendar day', () => {
		const logs = { d1: [log({ mealTime: 'am' })] };
		expect(getFedMap([dog], logs, day, 'am')?.d1).not.toBeNull();
		expect(getFedMap([dog], logs, day, 'pm')?.d1).toBeNull();
		expect(getFedMap([dog], logs, new Date(2026, 5, 13), 'am')?.d1).toBeNull();
	});

	it('getFeedingHistoryEntries sorts newest first', () => {
		const logs = {
			d1: [
				log({ id: 'old', createdAt: new Date(2026, 5, 10) }),
				log({ id: 'new', createdAt: new Date(2026, 5, 12) })
			]
		};
		expect(getFeedingHistoryEntries([dog], logs).map((e) => e.id)).toEqual(['new', 'old']);
	});

	it('getAbnormalCount counts only abnormal stool types from that day', () => {
		const stool = (stoolType: number, when: Date): StoolLog =>
			({ id: `s${stoolType}`, timestamp: when, stoolType, notes: null, loggedBy: '', loggedByName: '' }) as StoolLog;
		const logs = { d1: [stool(4, day), stool(6, day), stool(7, new Date(2026, 5, 1))] };
		expect(getAbnormalCount([dog], logs, day)).toBe(1);
	});

	it('appetiteRiskLabel flags only the most recent meal', () => {
		expect(appetiteRiskLabel([])).toBeNull();
		expect(appetiteRiskLabel([log({ amountEaten: 'all' })])).toBeNull();
		expect(appetiteRiskLabel([log({ amountEaten: 'none' })])).toBe("Didn't eat last meal");
		expect(appetiteRiskLabel([log({ amountEaten: 'little' })])).toBe('Ate little last meal');
		// An older refusal is superseded by a newer full meal (same day, later createdAt)…
		expect(
			appetiteRiskLabel([
				log({ id: 'refused', amountEaten: 'none', createdAt: new Date(2026, 5, 12, 8) }),
				log({ id: 'ate', amountEaten: 'all', createdAt: new Date(2026, 5, 12, 17) })
			])
		).toBeNull();
		// …and a newer-date refusal wins over an older full meal.
		expect(
			appetiteRiskLabel([
				log({ id: 'ate', amountEaten: 'all', date: new Date(2026, 5, 11) }),
				log({ id: 'refused', amountEaten: 'none', date: new Date(2026, 5, 12) })
			])
		).toBe("Didn't eat last meal");
	});

	it('appetiteRiskLabel ignores the current shift\'s own log', () => {
		// A refusal logged for the meal being worked right now should not flag
		// until the next shift.
		const refusedNow = log({ id: 'now', amountEaten: 'none', mealTime: 'am' });
		expect(appetiteRiskLabel([refusedNow], { day, mealTime: 'am' })).toBeNull();
		// The same log DOES flag on a later shift…
		expect(appetiteRiskLabel([refusedNow], { day, mealTime: 'pm' })).toBe("Didn't eat last meal");
		// …and on the next day.
		expect(appetiteRiskLabel([refusedNow], { day: new Date(2026, 5, 13), mealTime: 'am' })).toBe(
			"Didn't eat last meal"
		);
		// With the current meal excluded, the previous meal still governs.
		expect(
			appetiteRiskLabel(
				[
					log({ id: 'prev', amountEaten: 'none', mealTime: 'am', createdAt: new Date(2026, 5, 12, 8) }),
					log({ id: 'now', amountEaten: 'all', mealTime: 'pm', createdAt: new Date(2026, 5, 12, 17) })
				],
				{ day, mealTime: 'pm' }
			)
		).toBe("Didn't eat last meal");
	});
});

describe('isFastingMeal', () => {
	// "Fast tonight and tomorrow morning" → until tomorrow, through AM.
	const tomorrow = new Date(2026, 6, 9);
	const fasting = makeDog({ fastUntilDate: tomorrow, fastUntilMeal: 'am' });
	const today = new Date(2026, 6, 8);

	it('is off without a fast date', () => {
		expect(isFastingMeal(makeDog(), today, 'am')).toBe(false);
	});

	it('blocks every meal on days before the until-date', () => {
		expect(isFastingMeal(fasting, today, 'am')).toBe(true);
		expect(isFastingMeal(fasting, today, 'pm')).toBe(true);
		expect(isFastingMeal(fasting, today, 'second')).toBe(true);
	});

	it('blocks through the until-meal on the final day, then releases', () => {
		expect(isFastingMeal(fasting, tomorrow, 'am')).toBe(true);
		expect(isFastingMeal(fasting, tomorrow, 'pm')).toBe(false);
		expect(isFastingMeal(fasting, tomorrow, 'second')).toBe(false);
	});

	it('is over on later days', () => {
		expect(isFastingMeal(fasting, new Date(2026, 6, 10), 'am')).toBe(false);
	});

	it('treats a missing until-meal as the whole final day', () => {
		const wholeDay = makeDog({ fastUntilDate: tomorrow });
		expect(isFastingMeal(wholeDay, tomorrow, 'second')).toBe(true);
	});
});
