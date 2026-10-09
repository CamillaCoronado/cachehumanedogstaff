import { describe, expect, it } from 'vitest';
import { lastDoseDate, planDogMedical, planMedicalSync, regimenKind, storedDay, type AsmGivenDose, type AsmRegimen } from './medicalSync';

const reg = (o: Partial<AsmRegimen>): AsmRegimen => ({
	regimenId: 10,
	animalId: 500,
	shelterCode: '2026D0042',
	shortCode: '42D',
	treatmentName: 'Doxycycline',
	dosage: '100mg',
	frequency: '2 treatments every 1 days',
	comments: '',
	startDate: '2026-10-01',
	nextDue: '2026-10-09',
	nextDueHour: null,
	remaining: 6,
	perPeriod: 2,
	unit: 0,
	every: 1,
	totalPeriods: 7,
	openEnded: false,
	...o
});
const dose = (o: Partial<AsmGivenDose>): AsmGivenDose => ({ regimenId: 20, animalId: 500, treatmentName: 'Spay', given: '2026-10-09', openEnded: false, ...o });
const TODAY = '2026-10-09';
const plan = (doc: Record<string, unknown>, regimens: AsmRegimen[] = [], given: AsmGivenDose[] = [], today = TODAY) =>
	planDogMedical({ status: 'active', ...doc }, regimens, given, today, () => 'new-id');

describe('regimenKind', () => {
	it('sorts regimens onto the card they belong on', () => {
		expect(regimenKind('Spay', false)).toBe('surgery');
		expect(regimenKind('Neuter surgery', false)).toBe('surgery');
		expect(regimenKind('FortiFlora', false)).toBe('fortiflora');
		expect(regimenKind('Capstar', false)).toBe('fleas');
		expect(regimenKind('Flea treatment', false)).toBe('fleas');
		expect(regimenKind('Simparica flea prevention', true)).toBe('treatment');
		expect(regimenKind('Doxycycline', false)).toBe('treatment');
	});
});

describe('lastDoseDate', () => {
	it('counts on from the next dose, one period per batch of remaining doses', () => {
		expect(lastDoseDate(reg({}))).toBe('2026-10-11');
		expect(lastDoseDate(reg({ remaining: 3, perPeriod: 1, unit: 1, every: 2 }))).toBe('2026-11-06');
		expect(lastDoseDate(reg({ perPeriod: 0, remaining: 1 }))).toBe('2026-10-09');
		expect(lastDoseDate(reg({ openEnded: true }))).toBeNull();
	});
});

describe('storedDay', () => {
	it('reads date-only values as they are and timestamps on the shelter clock', () => {
		expect(storedDay('2026-10-09')).toBe('2026-10-09');
		expect(storedDay('2026-10-09T00:00:00')).toBe('2026-10-09');
		// 3am UTC on the 10th is still the 9th in Utah.
		expect(storedDay('2026-10-10T03:00:00.000Z')).toBe('2026-10-09');
	});
});

describe('treatments', () => {
	it('adds an ASM regimen as a treatment with its dates and dosing', () => {
		const p = plan({}, [reg({})]);
		expect(p?.treatments).toEqual([
			{ id: 'new-id', name: 'Doxycycline', condition: null, notes: '100mg · 2 treatments every 1 days', startDate: '2026-10-01T18:00:00.000Z', endDate: '2026-10-11T18:00:00.000Z', asmRegimenId: 10 }
		]);
	});

	it('lets ASM win over a same-name app entry, keeping its id and condition', () => {
		const p = plan({ treatments: [{ id: 't1', name: 'doxy', condition: 'URI', notes: 'with food', startDate: null, endDate: null }] }, [reg({ treatmentName: 'Doxy' })]);
		expect(p?.treatments).toMatchObject([{ id: 't1', name: 'Doxy', condition: 'URI', notes: '100mg · 2 treatments every 1 days', asmRegimenId: 10 }]);
	});

	it('drops treatments ASM has finished and keeps the app-only ones', () => {
		const p = plan({ treatments: [{ id: 't1', name: 'Doxy', asmRegimenId: 9 }, { id: 't2', name: 'ear flush' }] });
		expect(p?.treatments).toEqual([{ id: 't2', name: 'ear flush' }]);
	});

	it('writes nothing when the app already matches ASM', () => {
		const first = plan({}, [reg({})])!;
		expect(plan({ treatments: first.treatments }, [reg({})])).toBeNull();
	});

	it('keeps surgery, FortiFlora and flea regimens off the treatment list', () => {
		const p = plan({}, [reg({ treatmentName: 'Spay', nextDue: '2026-10-12', regimenId: 1 }), reg({ treatmentName: 'FortiFlora', regimenId: 2 }), reg({ treatmentName: 'Capstar', regimenId: 3 })]);
		expect(p?.treatments).toBeUndefined();
	});
});

describe('fortiflora', () => {
	it('puts an ASM FortiFlora course on the card, and takes it off when ASM is done', () => {
		const on = plan({}, [reg({ treatmentName: 'FortiFlora', perPeriod: 1, totalPeriods: 5, nextDueHour: 17, regimenId: 7 })]);
		expect(on).toMatchObject({ fortifloraDate: '2026-10-01T18:00:00.000Z', fortifloraDays: 5, fortifloraTime: 'pm', fortifloraAsmRegimenId: 7 });
		expect(plan({ fortifloraDate: 'x', fortifloraAsmRegimenId: 7 })).toMatchObject({ fortifloraDate: null, fortifloraAsmRegimenId: null });
	});

	it('leaves a FortiFlora course staff entered alone', () => {
		expect(plan({ fortifloraDate: '2026-10-01T18:00:00.000Z', fortifloraDays: 5 })).toBeNull();
	});
});

describe('fleas', () => {
	it('marks fleas while a flea treatment is on or was given since yesterday', () => {
		expect(plan({}, [reg({ treatmentName: 'Capstar', regimenId: 3 })])).toMatchObject({ hasFleas: true, fleaAsmRegimenId: 3 });
		expect(plan({}, [], [dose({ treatmentName: 'Capstar', regimenId: 4, given: '2026-10-08' })])).toMatchObject({ hasFleas: true, fleaAsmRegimenId: 4 });
		expect(plan({}, [], [dose({ treatmentName: 'Capstar', given: '2026-10-05' })])).toBeNull();
	});

	it('clears ASM fleas once ASM is done and restores the handling level the hold forced', () => {
		expect(plan({ hasFleas: true, fleaAsmRegimenId: 3, handlingLevel: 'staff_only', handlingLevelBeforeHold: 'volunteer' })).toEqual({
			hasFleas: false,
			fleaAsmRegimenId: null,
			handlingLevel: 'volunteer',
			handlingLevelBeforeHold: null
		});
		expect(plan({ hasFleas: true })).toBeNull();
	});
});

describe('surgery', () => {
	it('puts a surgery ASM has booked on the list on its day', () => {
		expect(plan({}, [reg({ treatmentName: 'Spay', regimenId: 20, nextDue: '2026-10-12', perPeriod: 0 })])).toMatchObject({ surgeryDate: '2026-10-12T18:00:00.000Z', surgeryAsmRegimenId: 20 });
	});

	it('keeps a surgery ASM shows done, by a dose given or a neuter date', () => {
		expect(plan({ surgeryDate: '2026-10-08T18:00:00.000Z' }, [], [dose({ given: '2026-10-08' })])).toBeNull();
		expect(plan({ surgeryDate: '2026-10-08T18:00:00.000Z', fixedDate: '2026-10-08' })).toBeNull();
	});

	it('drops a surgery whose day is over without ASM showing it done', () => {
		expect(plan({ surgeryDate: '2026-10-08T18:00:00.000Z', surgeryRestDays: 3 })).toEqual({ surgeryDate: null, surgeryRestDays: null, surgeryAsmRegimenId: null });
		// An ASM booking left undone is dropped the same way, and not put back.
		expect(plan({ surgeryDate: '2026-10-08T18:00:00.000Z', surgeryAsmRegimenId: 20 }, [reg({ treatmentName: 'Spay', regimenId: 20, nextDue: '2026-10-08', perPeriod: 0 })])).toMatchObject({ surgeryDate: null });
	});

	it('leaves today’s surgery on the list until the day is over', () => {
		expect(plan({ surgeryDate: '2026-10-09T18:00:00.000Z' })).toBeNull();
	});

	it('adds a surgery ASM records as done today, unless staff already cleared it', () => {
		expect(plan({}, [], [dose({})])).toMatchObject({ surgeryDate: '2026-10-09T18:00:00.000Z' });
		expect(plan({ lastSurgeryDate: '2026-10-09T18:00:00.000Z' }, [], [dose({})])).toBeNull();
	});
});

describe('planMedicalSync', () => {
	it('matches dogs by ASM id or shelter code and skips archived dogs and permanent fosters', () => {
		const docs = new Map<string, Record<string, unknown>>([
			['500', { status: 'active' }],
			['app1', { status: 'active', asmShelterCode: '2026d0099' }],
			['501', { status: 'adopted' }],
			['502', { status: 'active', permanentFoster: true }]
		]);
		const regimens = [reg({}), reg({ regimenId: 11, animalId: 999, shelterCode: '2026D0099' }), reg({ regimenId: 12, animalId: 501 }), reg({ regimenId: 13, animalId: 502 })];
		const writes = planMedicalSync(docs, { regimens, given: [] }, TODAY, () => 'x');
		expect(writes.map((w) => w.id)).toEqual(['500', 'app1']);
	});
});
