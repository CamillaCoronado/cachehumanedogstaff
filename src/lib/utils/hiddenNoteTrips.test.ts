import { describe, expect, it } from 'vitest';
import { hasHiddenTripNotes, importedTripId, planHiddenNoteTrips } from './hiddenNoteTrips';

const year = new Date().getFullYear();
const notes = 'Day Trip Notes 1/5: great with kids, friendly with dogs';

describe('planHiddenNoteTrips', () => {
	it('creates a trip for a noted day with none', () => {
		const plan = planHiddenNoteTrips([{ id: 'd1', status: 'active', hiddenComments: notes }], []);
		expect(plan.creates).toHaveLength(1);
		expect(plan.creates[0].dogId).toBe('d1');
		expect(plan.creates[0].trip.date.getDate()).toBe(5);
		expect(plan.patches).toHaveLength(0);
	});

	it('patches that day’s trip only while it has no notes or ratings', () => {
		const startedAt = new Date(year, 0, 5, 10);
		const dog = { id: 'd1', status: 'active', hiddenComments: notes };
		const blank = { id: 't1', dogId: 'd1', startedAt, tripNotes: null } as never;
		const filled = { id: 't1', dogId: 'd1', startedAt, tripNotes: 'already' } as never;
		const plan = planHiddenNoteTrips([dog], [blank]);
		expect(plan.creates).toHaveLength(0);
		expect(plan.patches).toEqual([expect.objectContaining({ dogId: 'd1', tripId: 't1' })]);
		expect(planHiddenNoteTrips([dog], [filled])).toEqual({ creates: [], patches: [] });
	});

	it('skips dogs not in the shelter and undated mentions', () => {
		expect(hasHiddenTripNotes({ id: 'a', status: 'adopted', hiddenComments: notes })).toBe(false);
		expect(hasHiddenTripNotes({ id: 'a', status: 'active', inFoster: true, hiddenComments: notes })).toBe(false);
		expect(hasHiddenTripNotes({ id: 'a', status: 'active', hiddenComments: 'day trip notes soon' })).toBe(false);
	});
});

describe('importedTripId', () => {
	it('keys on the calendar day', () => {
		expect(importedTripId(new Date(Date.UTC(2026, 0, 5, 12)))).toBe('imp-2026-01-05');
	});
});
