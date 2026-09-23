import { describe, expect, it } from 'vitest';
import { buildDogIndex, feedingDate, feedingLogId, planEditedFeedings, planFeedingsDetailed, planYardTime, shelterDay } from './feedingImport';

const index = buildDogIndex([
	{ id: 'buck', name: 'Buck', status: 'active', intakeDate: '2026-01-01T12:00:00Z', hasSecondMeal: true },
	{ id: 'cora', name: 'Cora', status: 'active', intakeDate: '2026-01-01T12:00:00Z', hasSecondMeal: true }
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

describe('who "everyone else" covers', () => {
	const morning = new Date('2026-09-22T08:30:00-06:00');
	const report = "Buck didn't eat, everyone else ate";
	const base = { status: 'active', intakeDate: '2026-01-01T12:00:00Z' };
	const filledIn = (dogs: Parameters<typeof buildDogIndex>[0], text = report, at = morning) =>
		planFeedingsDetailed(text, at, buildDogIndex(dogs)).entries.filter((e) => e.implied).map((e) => e.dogId).sort();

	it('leaves out a dog that left with no departure date on record', () => {
		expect(
			filledIn([
				{ id: 'buck', name: 'Buck', ...base },
				{ id: 'here', name: 'Here', ...base },
				{ id: 'gone', name: 'Gone', ...base, status: 'adopted', leftShelterDate: null }
			])
		).toEqual(['here']);
	});

	it('still counts a dog that left after the day of the report', () => {
		expect(
			filledIn([
				{ id: 'buck', name: 'Buck', ...base },
				{ id: 'later', name: 'Later', ...base, status: 'adopted', leftShelterDate: '2026-09-25T18:00:00Z' }
			])
		).toEqual(['later']);
	});

	it('leaves out a dog in foster with no start date', () => {
		expect(
			filledIn([
				{ id: 'buck', name: 'Buck', ...base },
				{ id: 'foster', name: 'Foster', ...base, inFoster: true, inFosterSince: null }
			])
		).toEqual([]);
	});

	it('counts an incoming dog once its intake day has come', () => {
		const incoming = (intakeDate: string | null) => [
			{ id: 'buck', name: 'Buck', ...base },
			{ id: 'new', name: 'Newbie', ...base, isIncoming: true, intakeDate }
		];
		// Arrived today, or a transfer that arrived earlier and is still marked Incoming.
		expect(filledIn(incoming('2026-09-22T15:00:00Z'))).toEqual(['new']);
		expect(filledIn(incoming('2026-09-10T15:00:00Z'))).toEqual(['new']);
		// Booked for tomorrow, or no date at all: not here.
		expect(filledIn(incoming('2026-09-23T15:00:00Z'))).toEqual([]);
		expect(filledIn(incoming(null))).toEqual([]);
	});

	it('fills in the second meal only for dogs that get one', () => {
		const evening = new Date('2026-09-22T19:30:00-06:00');
		expect(
			filledIn(
				[
					{ id: 'buck', name: 'Buck', ...base, hasSecondMeal: true },
					{ id: 'two', name: 'Two', ...base, hasSecondMeal: true },
					{ id: 'one', name: 'One', ...base }
				],
				"Second meal: Buck didn't eat, everyone else ate",
				evening
			)
		).toEqual(['two']);
	});
});

describe('planEditedFeedings', () => {
	const at = new Date('2026-09-22T08:30:00-06:00');
	const base = { status: 'active', intakeDate: '2026-01-01T12:00:00Z' };
	const idx = buildDogIndex([
		{ id: 'buck', name: 'Buck', ...base },
		{ id: 'cora', name: 'Cora', ...base, hasSecondMeal: true },
		{ id: 'dot', name: 'Dot', ...base }
	]);

	it('takes the named dogs as given and fills in the rest', () => {
		const out = planEditedFeedings("Buck didn't eat", at, idx, {
			mealTime: 'am',
			named: [{ dogId: 'cora', dogName: 'Cora', amountEaten: 'half' }],
			fillIn: true
		});
		expect(out.filter((e) => !e.implied)).toEqual([
			expect.objectContaining({ dogId: 'cora', amountEaten: 'half', mealTime: 'am' })
		]);
		expect(out.filter((e) => e.implied).map((e) => e.dogId).sort()).toEqual(['buck', 'dot']);
	});

	it('fills in nothing when everyone-else is off', () => {
		const out = planEditedFeedings('x', at, idx, {
			mealTime: 'am',
			named: [{ dogId: 'buck', dogName: 'Buck', amountEaten: 'none' }],
			fillIn: false
		});
		expect(out).toHaveLength(1);
	});

	it('follows a meal changed to the second meal', () => {
		const out = planEditedFeedings('x', at, idx, { mealTime: 'second', named: [], fillIn: true });
		expect(out.map((e) => e.dogId)).toEqual(['cora']);
	});
});

describe('planYardTime — all dogs', () => {
	const base = { status: 'active', intakeDate: '2026-01-01T12:00:00Z' };
	const idx = buildDogIndex([
		{ id: 'rex', name: 'Rex', ...base },
		{ id: 'dot', name: 'Dot', ...base },
		{ id: 'dior', name: 'Dior', ...base, isIncoming: true, intakeDate: '2026-09-10T12:00:00Z' },
		{ id: 'later', name: 'Later', ...base, isIncoming: true, intakeDate: '2026-09-30T12:00:00Z' },
		{ id: 'iso', name: 'Iso', ...base, isolationStatus: 'iso' },
		{ id: 'fos', name: 'Fos', ...base, inFoster: true, inFosterSince: '2026-08-01T12:00:00Z' }
	]);
	const at = new Date('2026-09-22T15:00:00-06:00');
	const logged = (t: string) => planYardTime(t, at, idx).map((d) => d.dogId).sort();

	it('logs every dog at the shelter that day, transfers included', () => {
		expect(logged('All dogs got yard time')).toEqual(['dior', 'dot', 'rex']);
		expect(logged('Yard time for all dogs')).toEqual(['dior', 'dot', 'rex']);
	});

	it('honours the carve-out', () => {
		expect(logged('all dogs went out except for Rex')).toEqual(['dior', 'dot']);
	});
});
