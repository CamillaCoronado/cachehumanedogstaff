import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { getDailyMovements } from './movements';

const today = new Date(2026, 6, 11, 14, 0); // July 11, 2 pm
const todayMorning = new Date(2026, 6, 11, 8, 0);
const lastWeek = new Date(2026, 6, 4);

let nextId = 1;
function makeDog(overrides: Partial<Dog> = {}): Dog {
	return {
		id: `dog-${nextId++}`,
		name: overrides.name ?? `Dog ${nextId}`,
		intakeDate: lastWeek,
		reentryDates: [],
		inFoster: false,
		status: 'active',
		updatedAt: lastWeek,
		...overrides
	} as Dog;
}

describe('getDailyMovements', () => {
	it('counts a first-time intake today as arrived, not returned', () => {
		const pup = makeDog({ name: 'Newbie', intakeDate: todayMorning });
		const m = getDailyMovements([pup], today);
		expect(m.arrived.map((d) => d.name)).toEqual(['Newbie']);
		expect(m.returned).toEqual([]);
	});

	it('counts an adoption return (reentry today) as returned, not arrived', () => {
		const dog = makeDog({ name: 'Boomerang', intakeDate: todayMorning, reentryDates: [todayMorning] });
		const m = getDailyMovements([dog], today);
		expect(m.returned.map((d) => d.name)).toEqual(['Boomerang']);
		expect(m.arrived).toEqual([]);
	});

	it('counts a foster return (shelterSince today) as returned', () => {
		const dog = makeDog({ name: 'HomeAgain', shelterSince: todayMorning });
		const m = getDailyMovements([dog], today);
		expect(m.returned.map((d) => d.name)).toEqual(['HomeAgain']);
	});

	it('counts a dog placed in foster today', () => {
		const dog = makeDog({ name: 'Fosterling', inFoster: true, inFosterSince: todayMorning });
		const m = getDailyMovements([dog], today);
		expect(m.toFoster.map((d) => d.name)).toEqual(['Fosterling']);
	});

	it('counts adoptions and transfers archived today, flagged apart', () => {
		const adopted = makeDog({ name: 'Lucky', status: 'adopted', leftShelterDate: todayMorning });
		const transferred = makeDog({ name: 'Mover', status: 'transferred', leftShelterDate: todayMorning });
		// Archived today but ASM gave no movement date — falls back to updatedAt.
		const noDate = makeDog({ name: 'Quiet', status: 'adopted', leftShelterDate: null, updatedAt: todayMorning });
		const m = getDailyMovements([adopted, transferred, noDate], today);
		expect(m.adopted.map((a) => a.dog.name)).toEqual(['Lucky', 'Mover', 'Quiet']);
		expect(m.adopted.find((a) => a.dog.name === 'Mover')?.transferred).toBe(true);
		expect(m.adopted.find((a) => a.dog.name === 'Lucky')?.transferred).toBe(false);
	});

	it('ignores dogs with no movement today', () => {
		const dog = makeDog({ name: 'Steady' });
		const oldAdoption = makeDog({ name: 'LongGone', status: 'adopted', leftShelterDate: lastWeek });
		const m = getDailyMovements([dog, oldAdoption], today);
		expect(m.arrived).toEqual([]);
		expect(m.returned).toEqual([]);
		expect(m.toFoster).toEqual([]);
		expect(m.adopted).toEqual([]);
	});
});
