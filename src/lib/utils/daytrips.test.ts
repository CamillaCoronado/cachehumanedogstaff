import { describe, expect, it } from 'vitest';
import type { DayTripLog } from '$lib/types';
import { durationHours, formatDuration, formatShortDate, formatTime } from './daytrips';

const trip = (overrides: Partial<DayTripLog>): DayTripLog => ({ ...overrides }) as DayTripLog;

describe('durationHours', () => {
	it('computes hours between start and end', () => {
		const log = trip({ startedAt: new Date(2026, 5, 12, 9, 0), endedAt: new Date(2026, 5, 12, 12, 30) });
		expect(durationHours(log)).toBeCloseTo(3.5);
	});

	it('uses now for open trips and 0 for missing/inverted starts', () => {
		const open = trip({ startedAt: new Date(Date.now() - 3_600_000), endedAt: null });
		expect(durationHours(open)).toBeCloseTo(1, 1);
		expect(durationHours(trip({ startedAt: null as unknown as DayTripLog['startedAt'], endedAt: null }))).toBe(0);
		const inverted = trip({ startedAt: new Date(2026, 5, 12, 12), endedAt: new Date(2026, 5, 12, 9) });
		expect(durationHours(inverted)).toBe(0);
	});
});

describe('formatDuration', () => {
	it('formats minutes, hours, and combinations', () => {
		expect(formatDuration(0)).toBe('—');
		expect(formatDuration(0.5)).toBe('30m');
		expect(formatDuration(2)).toBe('2h');
		expect(formatDuration(2.25)).toBe('2h 15m');
	});
});

describe('formatTime / formatShortDate', () => {
	it('formats times, treating exact midnight as unknown', () => {
		expect(formatTime(new Date(2026, 5, 12, 14, 5))).toBe('2:05 PM');
		expect(formatTime(new Date(2026, 5, 12, 0, 0))).toBe('—');
		expect(formatTime(null)).toBe('—');
	});

	it('formats short dates', () => {
		expect(formatShortDate(new Date(2026, 5, 12))).toBe('6/12');
		expect(formatShortDate(null)).toBe('—');
	});
});
