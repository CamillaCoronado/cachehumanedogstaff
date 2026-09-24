import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { matchDogOnDate } from './dogs';

const dog = (id: string, intake: string, left: string | null, status = 'adopted') =>
	({ id, name: 'Pickles', intakeDate: new Date(intake), leftShelterDate: left ? new Date(left) : null, status }) as unknown as Dog;

describe('matchDogOnDate', () => {
	const march = dog('march', '2026-02-20', '2026-04-10');
	const now = dog('now', '2026-08-01', null, 'active');

	it('picks the dog of that name at the shelter that day', () => {
		expect(matchDogOnDate('Pickles', [now, march], new Date('2026-03-15'))?.id).toBe('march');
		expect(matchDogOnDate('pickles', [march, now], new Date('2026-09-01'))?.id).toBe('now');
	});

	it('falls back to the dog here now, then anyone on record', () => {
		expect(matchDogOnDate('Pickles', [march, now], new Date('2026-06-01'))?.id).toBe('now');
		expect(matchDogOnDate('Pickles', [march], new Date('2026-06-01'))?.id).toBe('march');
	});
});
