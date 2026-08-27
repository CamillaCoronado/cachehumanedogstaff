import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import {
	adoptabilityLabel,
	analyzeTransferPartners,
	classifyOrigin,
	MIN_SAMPLE_FOR_RATING,
	SURVEY_PARTNERS
} from './transferPartners';

const TODAY = new Date('2026-08-25T12:00:00');

function dog(overrides: Partial<Dog> = {}): Dog {
	return {
		id: `dog-${Math.random().toString(36).slice(2)}`,
		name: 'Rex',
		status: 'active',
		origin: 'Somewhere',
		intakeDate: new Date('2026-06-01T12:00:00'),
		leftShelterDate: null,
		reentryDates: [],
		...overrides
	} as Dog;
}

/** Departed dog that took `days` to be adopted. */
function adoptedAfter(days: number, origin: string): Dog {
	const intake = new Date('2026-01-01T12:00:00');
	const left = new Date(intake.getTime() + days * 86_400_000);
	return dog({ origin, status: 'adopted', intakeDate: intake, leftShelterDate: left });
}

describe('classifyOrigin', () => {
	it('matches the named partners regardless of the county suffix', () => {
		expect(classifyOrigin('Brenham Animal Services, TX')).toBe('Brenham');
		expect(classifyOrigin('Bi-Stone Rescue')).toBe('Bi-Stone');
		expect(classifyOrigin('Bi Stone Rescue, TX')).toBe('Bi-Stone');
		expect(classifyOrigin('Paws for Life K9, CA')).toBe('LA County / Paws for Life');
	});

	it('folds Utah senders together by state token or shelter name', () => {
		expect(classifyOrigin('Emery Animal Control Shelter, UT')).toBe('Utah shelters');
		expect(classifyOrigin('Tremonton Animal Control')).toBe('Utah shelters');
		expect(classifyOrigin('Animal Care of Davis County')).toBe('Utah shelters');
	});

	it('treats surrenders as their own source', () => {
		expect(classifyOrigin('Surrender')).toBe('Owner surrenders');
	});

	it('does not silently swallow an unknown sender', () => {
		expect(classifyOrigin('Merced Municipal Animal Shelter, CA')).toBe('Other / unmatched');
	});

	it('handles a missing origin', () => {
		expect(classifyOrigin('')).toBe('Unrecorded');
		expect(classifyOrigin(null)).toBe('Unrecorded');
	});

	// "UT" must not match inside an unrelated word.
	it('does not treat a substring as the Utah state token', () => {
		expect(classifyOrigin('Southutton County Shelter, TX')).toBe('Other / unmatched');
	});
});

describe('analyzeTransferPartners', () => {
	it('refuses to rate a partner below the sample floor', () => {
		const dogs = [adoptedAfter(5, 'Bi-Stone Rescue')];
		const row = analyzeTransferPartners(dogs, TODAY).rows.find((r) => r.partner === 'Bi-Stone')!;
		expect(row.departed).toBe(1);
		expect(row.rating).toBeNull();
		expect(row.confidence).toBe('low');
	});

	it('rates a partner whose dogs leave fast and always by adoption as high', () => {
		const fast = Array.from({ length: MIN_SAMPLE_FOR_RATING }, () => adoptedAfter(5, 'Brenham Animal Services'));
		const slow = Array.from({ length: MIN_SAMPLE_FOR_RATING }, () => adoptedAfter(100, 'Bi-Stone Rescue'));
		const { rows } = analyzeTransferPartners([...fast, ...slow], TODAY);
		expect(rows.find((r) => r.partner === 'Brenham')!.rating).toBe('high');
		// Slow, but every dog still went home — that's moderate, not low. Low is reserved
		// for dogs that often don't get adopted at all.
		expect(rows.find((r) => r.partner === 'Bi-Stone')!.rating).toBe('moderate');
	});

	it('drops a partner whose dogs take far longer than the shelter median', () => {
		const typical = Array.from({ length: 10 }, () => adoptedAfter(10, 'Brenham Animal Services'));
		const dragging = Array.from({ length: MIN_SAMPLE_FOR_RATING }, () => adoptedAfter(90, 'Bi-Stone Rescue'));
		const { rows } = analyzeTransferPartners([...typical, ...dragging], TODAY);
		expect(rows.find((r) => r.partner === 'Bi-Stone')!.rating).toBe('low');
	});

	it('counts outcomes other than adoption against a partner', () => {
		const dogs = [
			...Array.from({ length: 4 }, () => dog({ origin: 'Brenham Animal Services', status: 'euthanized', leftShelterDate: new Date('2026-03-01') })),
			adoptedAfter(5, 'Brenham Animal Services')
		];
		const row = analyzeTransferPartners(dogs, TODAY).rows.find((r) => r.partner === 'Brenham')!;
		expect(row.euthanized).toBe(4);
		expect(row.adopted).toBe(1);
		expect(row.rating).toBe('low');
	});

	it('keeps current dogs out of the adoption-speed median', () => {
		const dogs = [
			adoptedAfter(10, 'Brenham Animal Services'),
			dog({ origin: 'Brenham Animal Services', status: 'active', intakeDate: new Date('2024-01-01T12:00:00') })
		];
		const row = analyzeTransferPartners(dogs, TODAY).rows.find((r) => r.partner === 'Brenham')!;
		expect(row.medianDaysToAdoption).toBe(10);
		expect(row.current).toBe(1);
		expect(row.longStayNow).toBe(1);
	});

	it('counts the condition dogs arrived in against a partner', () => {
		// Same outcomes on both sides; only the support burden differs.
		const easy = Array.from({ length: MIN_SAMPLE_FOR_RATING }, () => adoptedAfter(10, 'Brenham Animal Services'));
		const hard = Array.from({ length: MIN_SAMPLE_FOR_RATING }, () =>
			dog({
				...adoptedAfter(10, 'Bi-Stone Rescue'),
				handlingLevel: 'manager_only',
				healthProblems: 'heartworm positive'
			})
		);
		const { rows } = analyzeTransferPartners([...easy, ...hard], TODAY);
		const bistone = rows.find((r) => r.partner === 'Bi-Stone')!;
		const brenham = rows.find((r) => r.partner === 'Brenham')!;
		expect(bistone.behaviorSupport).toBe(MIN_SAMPLE_FOR_RATING);
		expect(bistone.medicalSupport).toBe(MIN_SAMPLE_FOR_RATING);
		expect(brenham.needsSupport).toBe(0);
		expect(brenham.rating).toBe('high');
		expect(bistone.rating).toBe('moderate');
	});

	it('does not let a return count against the sending shelter', () => {
		const clean = Array.from({ length: MIN_SAMPLE_FOR_RATING }, () => adoptedAfter(10, 'Brenham Animal Services'));
		const bounced = clean.map((d) => ({ ...d, reentryDates: [new Date('2026-04-01T12:00:00')] }));
		const withReturns = analyzeTransferPartners(bounced, TODAY).rows.find((r) => r.partner === 'Brenham')!;
		const without = analyzeTransferPartners(clean, TODAY).rows.find((r) => r.partner === 'Brenham')!;
		expect(withReturns.returned).toBe(MIN_SAMPLE_FOR_RATING);
		expect(withReturns.rating).toBe(without.rating);
	});

	it('reports unmatched origins rather than hiding them', () => {
		const { unmatchedOrigins } = analyzeTransferPartners(
			[dog({ origin: 'Merced Municipal Animal Shelter, CA' })],
			TODAY
		);
		expect(unmatchedOrigins).toEqual(['Merced Municipal Animal Shelter, CA']);
	});

	it('returns a row for every survey partner even with no dogs on record', () => {
		const { rows } = analyzeTransferPartners([], TODAY);
		expect(rows.map((r) => r.partner)).toEqual([...SURVEY_PARTNERS]);
		for (const row of rows) {
			expect(row.total).toBe(0);
			expect(row.rating).toBeNull();
			expect(adoptabilityLabel(row.rating)).toBe('Unsure');
		}
	});

	it('lists survey partners in the survey\'s order, extras after', () => {
		const dogs = Array.from({ length: 20 }, () => dog({ origin: 'Merced Municipal Animal Shelter, CA' }));
		const { rows } = analyzeTransferPartners(dogs, TODAY);
		expect(rows[0].partner).toBe('Rose/Elvia');
		expect(rows[rows.length - 1].partner).toBe('Other / unmatched');
	});

	it('speaks the survey\'s vocabulary', () => {
		expect(adoptabilityLabel('low')).toBe('Low adoptability');
		expect(adoptabilityLabel('moderate')).toBe('Moderate adoptability');
		expect(adoptabilityLabel('high')).toBe('High adoptability');
		expect(adoptabilityLabel(null)).toBe('Unsure');
	});

	it('gives a partner with no departed dogs no rating at all', () => {
		const dogs = [dog({ origin: 'Rose Rescue', status: 'active' })];
		const row = analyzeTransferPartners(dogs, TODAY).rows.find((r) => r.partner === 'Rose/Elvia')!;
		expect(row.confidence).toBe('none');
		expect(row.rating).toBeNull();
		expect(row.medianDaysToAdoption).toBeNull();
	});
});
