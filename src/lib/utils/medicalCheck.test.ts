import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { checkMedical, lastDoseDate, type AsmRegimen } from './medicalCheck';

const reg = (o: Partial<AsmRegimen>): AsmRegimen => ({
	regimenId: 10,
	animalId: 500,
	shelterCode: '2026D0042',
	shortCode: '42D',
	animalName: 'Rex',
	treatmentName: 'Doxycycline',
	dosage: '100mg',
	frequency: '2 treatments every 1 days',
	comments: '',
	startDate: '2026-10-01',
	nextDue: '2026-10-09',
	remaining: 6,
	perPeriod: 2,
	unit: 0,
	every: 1,
	openEnded: false,
	...o
});
const dog = (o: Partial<Dog>) => ({ id: 'a', name: 'Rex', status: 'active', asmId: 500, treatments: [], ...o }) as unknown as Dog;
const ids = () => 'tx-1';
const ymd = (d: unknown) => {
	const x = d as Date;
	return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

describe('lastDoseDate', () => {
	it('counts on from the next dose, one period per batch of remaining doses', () => {
		expect(lastDoseDate(reg({}))).toBe('2026-10-11');
		expect(lastDoseDate(reg({ remaining: 3, perPeriod: 1, unit: 1, every: 2 }))).toBe('2026-11-06');
		expect(lastDoseDate(reg({ remaining: 2, perPeriod: 1, unit: 2 }))).toBe('2026-11-09');
	});

	it('ends a one-off on its dose and leaves an open-ended course without an end', () => {
		expect(lastDoseDate(reg({ perPeriod: 0, remaining: 1 }))).toBe('2026-10-09');
		expect(lastDoseDate(reg({ openEnded: true }))).toBeNull();
	});
});

describe('checkMedical', () => {
	it('adds a regimen the dog has no treatment for, with ASM dose and timing as notes', () => {
		const { fixes } = checkMedical([dog({})], [reg({})], ids);
		expect(fixes).toHaveLength(1);
		expect(fixes[0]).toMatchObject({ kind: 'add', openEnded: false });
		expect(fixes[0].treatment).toMatchObject({ name: 'Doxycycline', notes: '100mg · 2 treatments every 1 days', asmRegimenId: 10 });
		expect(ymd(fixes[0].treatment.startDate)).toBe('2026-10-01');
		expect(ymd(fixes[0].treatment.endDate)).toBe('2026-10-11');
	});

	it('matches a dog by shelter code when it has no ASM id', () => {
		const { fixes } = checkMedical([dog({ asmId: null, asmShelterCode: '2026d0042' })], [reg({})], ids);
		expect(fixes).toHaveLength(1);
	});

	it('fills only the blanks of a treatment the app already has by that name', () => {
		const existing = { id: 't1', name: 'doxycycline', condition: 'URI', notes: 'with food', startDate: new Date(2026, 9, 2, 12), endDate: null };
		const { fixes } = checkMedical([dog({ treatments: [existing] })], [reg({})], ids);
		expect(fixes).toHaveLength(1);
		expect(fixes[0].kind).toBe('fill');
		expect(fixes[0].treatment).toMatchObject({ id: 't1', condition: 'URI', notes: 'with food', asmRegimenId: 10 });
		expect(ymd(fixes[0].treatment.startDate)).toBe('2026-10-02');
		expect(ymd(fixes[0].treatment.endDate)).toBe('2026-10-11');
	});

	it('offers nothing for a treatment already filled from ASM', () => {
		const existing = { id: 't1', name: 'Doxy', notes: 'x', startDate: new Date(), endDate: new Date(), asmRegimenId: 10 };
		expect(checkMedical([dog({ treatments: [existing] })], [reg({})], ids).fixes).toEqual([]);
	});

	it('leaves archived dogs and permanent fosters alone and reports their regimens as unmatched', () => {
		const r = checkMedical([dog({ status: 'adopted' }), dog({ id: 'b', asmId: 501, permanentFoster: true })], [reg({}), reg({ regimenId: 11, animalId: 501 })], ids);
		expect(r.fixes).toEqual([]);
		expect(r.unmatched).toHaveLength(2);
	});

	it('marks an open-ended course so it starts unticked', () => {
		const { fixes } = checkMedical([dog({})], [reg({ openEnded: true, treatmentName: 'Simparica' })], ids);
		expect(fixes[0]).toMatchObject({ kind: 'add', openEnded: true });
		expect(fixes[0].treatment.endDate).toBeNull();
	});
});
