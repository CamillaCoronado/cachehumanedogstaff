import { describe, expect, it } from 'vitest';
import { checklistFor, taggedTaskIds } from './cleaningChecklist';

// 2026-10-26 is a Monday
const day = (d: number) => new Date(2026, 9, d);

describe('checklistFor', () => {
	it('splits every sheet into Staff A and Staff B with unique task ids', () => {
		for (const d of [25, 26, 31]) {
			for (const shift of ['morning', 'evening'] as const) {
				const sheet = checklistFor(day(d), shift);
				expect(sheet.sections.map((s) => s.staff)).toEqual(['A', 'B']);
				const ids = sheet.sections.flatMap((s) => s.tasks.map((t) => t.id));
				expect(new Set(ids).size).toBe(ids.length);
				for (const tag of ['cleaning', 'movement', 'slack'] as const) {
					expect(taggedTaskIds(sheet, tag).length).toBeGreaterThan(0);
				}
			}
		}
	});

	it('uses the Sunday sheets on Sundays', () => {
		expect(checklistFor(day(25), 'morning').title).toBe('Sunday Morning Tasks');
		expect(checklistFor(day(25), 'morning').sections.map((s) => s.side)).toEqual(['East side', 'West Side']);
		expect(checklistFor(day(25), 'evening').title).toBe('Sunday Evening Tasks');
		expect(checklistFor(day(26), 'morning', true).title).toBe('Sunday Morning Tasks');
	});

	it("shows the day's weekly chore under Weekly chores, and drops it on Saturday", () => {
		const tue = checklistFor(day(27), 'evening');
		const chore = (staff: 'A' | 'B') =>
			tue.sections.find((s) => s.staff === staff)!.tasks.find((t) => t.description === 'Weekly chores')?.detail;
		expect(chore('A')).toBe('Sweep, mop, and declutter the meet and greet room');
		expect(chore('B')).toMatch(/^Clean the staff bathroom/);
		const sat = checklistFor(day(31), 'evening');
		expect(sat.sections.flatMap((s) => s.tasks).some((t) => t.description === 'Weekly chores')).toBe(false);
	});
});
