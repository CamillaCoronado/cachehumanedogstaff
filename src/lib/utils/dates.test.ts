import { describe, expect, it } from 'vitest';
import {
	bathEligible,
	daysSince,
	formatAge,
	formatDate,
	isPuppyAge,
	isSameCalendarDay,
	isSurgeryToday,
	toDate
} from './dates';

describe('toDate', () => {
	it('returns null for null/undefined/empty', () => {
		expect(toDate(null)).toBeNull();
		expect(toDate(undefined)).toBeNull();
		expect(toDate('')).toBeNull();
	});

	it('parses YYYY-MM-DD as local midnight (no timezone shift)', () => {
		const d = toDate('2026-06-12')!;
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(5);
		expect(d.getDate()).toBe(12);
		expect(d.getHours()).toBe(0);
	});

	it('parses UTC-midnight ISO strings as local date-only values', () => {
		const d = toDate('2026-06-12T00:00:00.000Z')!;
		expect(d.getDate()).toBe(12);
		expect(d.getHours()).toBe(0);
	});

	it('passes Date instances through', () => {
		const now = new Date();
		expect(toDate(now)).toBe(now);
	});

	it('unwraps Firestore Timestamp-like objects', () => {
		const inner = new Date(2025, 0, 15);
		const fakeTimestamp = { toDate: () => inner } as unknown as Parameters<typeof toDate>[0];
		expect(toDate(fakeTimestamp)).toBe(inner);
	});
});

describe('daysSince', () => {
	const now = new Date(2026, 5, 12);

	it('counts whole days ignoring time of day', () => {
		expect(daysSince(new Date(2026, 5, 10, 23, 59), now)).toBe(2);
	});

	it('clamps future dates to 0', () => {
		expect(daysSince(new Date(2026, 5, 20), now)).toBe(0);
	});

	it('returns null for missing dates', () => {
		expect(daysSince(null, now)).toBeNull();
	});
});

describe('formatAge', () => {
	const now = new Date(2026, 5, 12);

	it('formats under a year as months', () => {
		expect(formatAge(new Date(2026, 0, 12), now)).toBe('5 mos');
	});

	it('formats a year or more as years', () => {
		expect(formatAge(new Date(2023, 5, 1), now)).toBe('3 yrs');
	});

	it('falls back to em dash for missing dates', () => {
		expect(formatAge(null, now)).toBe('—');
	});
});

describe('formatDate', () => {
	it('formats and falls back', () => {
		expect(formatDate('2026-06-12')).toBe('Jun 12, 2026');
		expect(formatDate(null)).toBe('—');
		expect(formatDate(null, 'n/a')).toBe('n/a');
	});
});

describe('isSameCalendarDay', () => {
	it('matches same day at different times', () => {
		expect(isSameCalendarDay(new Date(2026, 5, 12, 8), new Date(2026, 5, 12, 20))).toBe(true);
	});

	it('rejects different days and missing values', () => {
		expect(isSameCalendarDay(new Date(2026, 5, 12), new Date(2026, 5, 13))).toBe(false);
		expect(isSameCalendarDay(null, new Date())).toBe(false);
	});
});

describe('isSurgeryToday', () => {
	it('is true only when surgery date is today and today is Mon or Thu', () => {
		const thursday = new Date(2026, 5, 11);
		const friday = new Date(2026, 5, 12);
		expect(isSurgeryToday(thursday, thursday)).toBe(true);
		// A bonus surgery day is still a surgery day: the date decides, not the weekday.
		expect(isSurgeryToday(friday, friday)).toBe(true);
		expect(isSurgeryToday(thursday, friday)).toBe(false);
		expect(isSurgeryToday(null, thursday)).toBe(false);
	});
});

describe('isPuppyAge', () => {
	const today = new Date(2026, 6, 17);

	it('under 6 months is a puppy', () => {
		expect(isPuppyAge(new Date(2026, 4, 1), today)).toBe(true);
	});

	it('6 months or older is not', () => {
		expect(isPuppyAge(new Date(2026, 0, 1), today)).toBe(false);
		expect(isPuppyAge(new Date(2024, 0, 1), today)).toBe(false);
	});

	it('unknown date of birth is treated as adult', () => {
		expect(isPuppyAge(null, today)).toBe(false);
		expect(isPuppyAge(undefined, today)).toBe(false);
	});
});

describe('bathEligible', () => {
	const today = new Date(2026, 5, 12);

	it('requires 10 days after surgery', () => {
		expect(bathEligible(new Date(2026, 5, 5), today)).toBe(false);
		expect(bathEligible(new Date(2026, 5, 2), today)).toBe(true);
	});

	it('is eligible with no surgery date or a future one', () => {
		expect(bathEligible(null, today)).toBe(true);
		expect(bathEligible(new Date(2026, 5, 20), today)).toBe(true);
	});
});
