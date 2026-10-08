import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { adoptionStays, summarize, turnaroundByMonth, turnaroundWindows } from './adoptionTurnaround';

const now = new Date(2026, 9, 8, 14, 0); // Oct 8, 2 pm

let nextId = 1;
function adopted(intake: Date, left: Date | null, overrides: Partial<Dog> = {}): Dog {
	return {
		id: `dog-${nextId++}`,
		name: `Dog ${nextId}`,
		intakeDate: intake,
		leftShelterDate: left,
		reentryDates: [],
		inFoster: false,
		status: 'adopted',
		updatedAt: left ?? intake,
		...overrides
	} as Dog;
}

describe('adoptionStays', () => {
	it('counts calendar days from intake to adoption, ignoring the time of day', () => {
		const [stay] = adoptionStays([adopted(new Date(2026, 9, 1, 23, 0), new Date(2026, 9, 5, 8, 0))]);
		expect(stay.days).toBe(4);
	});

	it('leaves out dogs that are not adopted, have no departure, or left before this intake', () => {
		const stays = adoptionStays([
			adopted(new Date(2026, 8, 1), new Date(2026, 8, 10), { status: 'transferred' }),
			adopted(new Date(2026, 8, 1), new Date(2026, 8, 10), { status: 'active' }),
			adopted(new Date(2026, 8, 1), null),
			adopted(new Date(2026, 8, 20), new Date(2026, 8, 10))
		]);
		expect(stays).toEqual([]);
	});

	it('takes a dog adopted the day it came in as zero days', () => {
		expect(adoptionStays([adopted(new Date(2026, 9, 2), new Date(2026, 9, 2))])[0].days).toBe(0);
	});
});

describe('summarize', () => {
	it('gives the median and average', () => {
		const stays = adoptionStays([
			adopted(new Date(2026, 8, 1), new Date(2026, 8, 3)), // 2
			adopted(new Date(2026, 8, 1), new Date(2026, 8, 11)), // 10
			adopted(new Date(2026, 8, 1), new Date(2026, 8, 31)), // 30
			adopted(new Date(2026, 8, 1), new Date(2026, 8, 5)) // 4
		]);
		expect(summarize(stays)).toEqual({ count: 4, medianDays: 7, averageDays: 11.5 });
	});

	it('is empty with no adoptions', () => {
		expect(summarize([])).toEqual({ count: 0, medianDays: null, averageDays: null });
	});
});

describe('turnaroundWindows', () => {
	it('buckets by adoption date, not intake date', () => {
		const stays = adoptionStays([
			adopted(new Date(2026, 0, 1), new Date(2026, 9, 1)), // adopted 7 days ago after a long stay
			adopted(new Date(2026, 5, 1), new Date(2026, 5, 11)), // ~4 months ago
			adopted(new Date(2024, 0, 1), new Date(2024, 0, 3)) // years ago
		]);
		const [d30, d90, y1, all] = turnaroundWindows(stays, now);
		expect(d30.count).toBe(1);
		expect(d90.count).toBe(1);
		expect(y1.count).toBe(2);
		expect(all.count).toBe(3);
	});
});

describe('turnaroundByMonth', () => {
	it('lists the last months newest first, empty months included', () => {
		const stays = adoptionStays([
			adopted(new Date(2026, 8, 1), new Date(2026, 8, 6)),
			adopted(new Date(2026, 8, 1), new Date(2026, 8, 16)),
			adopted(new Date(2026, 6, 1), new Date(2026, 6, 4))
		]);
		const rows = turnaroundByMonth(stays, now, 4);
		expect(rows.map((r) => [r.month.getMonth(), r.count, r.medianDays])).toEqual([
			[9, 0, null],
			[8, 2, 10],
			[7, 0, null],
			[6, 1, 3]
		]);
	});
});
