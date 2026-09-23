import { describe, expect, it } from 'vitest';
import { buildDogIndex, feedingDate, feedingLogId, planFeedingsDetailed, shelterDay } from './feedingImport';

const index = buildDogIndex([
	{ id: 'buck', name: 'Buck', status: 'active', intakeDate: '2026-01-01T12:00:00Z' },
	{ id: 'cora', name: 'Cora', status: 'active', intakeDate: '2026-01-01T12:00:00Z' }
]);

describe('feedingDate', () => {
	it("puts a morning report of the second meal on the night before", () => {
		const morning = new Date('2026-09-22T08:30:00-06:00');
		expect(shelterDay(feedingDate(morning, 'second'))).toBe('20260921');
		expect(feedingLogId(feedingDate(morning, 'second'), 'buck', 'second')).toBe('slack-20260921-second-buck');
	});

	it('leaves a second-meal report posted that evening on its own day', () => {
		const evening = new Date('2026-09-22T19:45:00-06:00');
		expect(shelterDay(feedingDate(evening, 'second'))).toBe('20260922');
	});

	it('leaves the morning and afternoon feeds on the day posted', () => {
		const morning = new Date('2026-09-22T08:30:00-06:00');
		expect(shelterDay(feedingDate(morning, 'am'))).toBe('20260922');
		expect(shelterDay(feedingDate(morning, 'pm'))).toBe('20260922');
	});
});

describe('planFeedingsDetailed', () => {
	it('reads a morning second-meal report as last night', () => {
		const morning = new Date('2026-09-22T08:10:00-06:00');
		const plan = planFeedingsDetailed("Second meal: Buck didn't eat, everyone else ate", morning, index);
		expect(plan.entries.map((e) => e.mealTime)).toEqual(['second', 'second']);
		expect(shelterDay(feedingDate(morning, plan.entries[0].mealTime))).toBe('20260921');
	});
});
