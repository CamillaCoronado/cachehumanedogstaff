import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { fosterRepairCandidates } from './fosterRepair';

const dog = (o: Partial<Dog>) => ({ id: 'd', name: 'Dog', status: 'active', intakeDate: new Date(2026, 1, 1), ...o }) as Dog;

describe('fosterRepairCandidates', () => {
	it('is confident when a sync recorded the dog going to foster first', () => {
		const back = dog({ id: 'b', shelterSince: new Date(2026, 5, 1) });
		const [c] = fosterRepairCandidates([back], [{ dogIds: ['b'], createdAt: new Date(2026, 3, 1) }]);
		expect(c.confident).toBe(true);
		expect(c.returnedAt).toEqual(new Date(2026, 5, 1));
	});

	it('flags a late shelterSince with no foster record as a guess', () => {
		const [c] = fosterRepairCandidates([dog({ shelterSince: new Date(2026, 5, 1) })], []);
		expect(c.confident).toBe(false);
	});

	it('leaves a transfer that reached the floor soon after intake alone', () => {
		expect(fosterRepairCandidates([dog({ shelterSince: new Date(2026, 1, 5) })], [])).toEqual([]);
	});

	it('skips dogs already carrying the new stamp, and archived dogs', () => {
		const stamped = dog({ shelterSince: new Date(2026, 5, 1), fosterReturnedAt: new Date(2026, 5, 1) });
		const gone = dog({ shelterSince: new Date(2026, 5, 1), status: 'adopted' });
		expect(fosterRepairCandidates([stamped, gone], [])).toEqual([]);
	});
});
