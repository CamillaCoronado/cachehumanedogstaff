import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { compatibilityLabel, dogCompatLabel, matchesGoodWith, showsAssumedNote } from './labels';

const today = new Date(2026, 8, 23);
const dog = (overrides: Partial<Dog>) =>
	({ goodWithDogs: 'unknown', goodWithCats: 'unknown', goodWithKids: 'unknown', dateOfBirth: new Date(2022, 0, 1), ...overrides }) as Dog;

describe('untested compatibility', () => {
	it('reads "Not tested" for an adult nobody has tested', () => {
		expect(dogCompatLabel(dog({}), 'goodWithDogs', today)).toBe('Not tested');
		expect(showsAssumedNote(dog({}), today)).toBe(false);
		expect(matchesGoodWith(dog({}), 'goodWithCats', today)).toBe(false);
	});

	it('reads "Yes*" only for a puppy', () => {
		const puppy = dog({ dateOfBirth: new Date(2026, 5, 1) });
		expect(dogCompatLabel(puppy, 'goodWithKids', today)).toBe('Yes*');
		expect(showsAssumedNote(puppy, today)).toBe(true);
		expect(matchesGoodWith(puppy, 'goodWithDogs', today)).toBe(true);
	});

	it('treats a dog of unknown age as an adult', () => {
		expect(dogCompatLabel(dog({ dateOfBirth: null }), 'goodWithDogs', today)).toBe('Not tested');
	});

	it('shows tested answers as they are', () => {
		expect(dogCompatLabel(dog({ goodWithDogs: 'yes' }), 'goodWithDogs', today)).toBe('Yes');
		expect(dogCompatLabel(dog({ goodWithDogs: 'no', dateOfBirth: new Date(2026, 5, 1) }), 'goodWithDogs', today)).toBe('No');
		expect(compatibilityLabel('unknown')).toBe('Not tested');
	});
});
