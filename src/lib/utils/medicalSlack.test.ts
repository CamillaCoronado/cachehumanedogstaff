import { describe, expect, it } from 'vitest';
import { describeAction, dogsNamed, drugName, planSlackMedical, resolveMedicalActions, type MedicalAction, type RawMedicalAction } from './medicalSlack';
import { planDogMedical, type AsmRegimen } from './medicalSync';

const roster = [
	{ id: '1', name: 'Bruiser' },
	{ id: '2', name: 'Loki' },
	{ id: '3', name: 'Luno' },
	{ id: '4', name: 'Pickles', nicknames: ['Pick'] },
	{ id: '5', name: 'Dot' },
	{ id: '6', name: 'Dottie' },
	{ id: '7', name: 'Pup A' },
	{ id: '8', name: 'Pup B' }
];
const groups = [{ name: 'Van trap puppies', dogIds: ['7', '8'] }];

const raw = (o: Partial<RawMedicalAction>): RawMedicalAction => ({ type: 'treatment', dogName: 'Bruiser', drug: null, condition: null, days: null, note: null, ...o });
const act = (o: Partial<MedicalAction>): MedicalAction => ({ ...raw(o), dogId: '1', dogName: 'Bruiser', ...o });
const DAY = '2026-10-08';
const AT = '2026-10-08T19:27:00.000Z';
const plan = (doc: Record<string, unknown>, actions: MedicalAction[]) => planSlackMedical(doc, actions, DAY, AT, () => 'new-id');

describe('dogsNamed', () => {
	it('matches a dog by name, nickname, or name plus surname', () => {
		expect(dogsNamed('Bruiser Woods', roster).map((d) => d.id)).toEqual(['1']);
		expect(dogsNamed('pick', roster).map((d) => d.id)).toEqual(['4']);
		expect(dogsNamed('DOT', roster).map((d) => d.id)).toEqual(['5']);
	});

	it('expands a group name to its dogs', () => {
		expect(dogsNamed('van trap puppies', roster, groups).map((d) => d.id)).toEqual(['7', '8']);
	});

	it('matches nothing rather than guess', () => {
		expect(dogsNamed('Zane', roster)).toEqual([]);
		expect(dogsNamed('Van trap puppies', roster)).toEqual([]);
	});
});

describe('resolveMedicalActions', () => {
	it('resolves known dogs and lists the names it could not', () => {
		const r = resolveMedicalActions(
			[raw({ type: 'monitor', dogName: 'Loki', condition: 'diarrhea' }), raw({ type: 'monitor', dogName: 'Luno' }), raw({ dogName: 'Zane', drug: 'metro' })],
			roster
		);
		expect(r.actions.map((a) => a.dogId)).toEqual(['2', '3']);
		expect(r.unmatched).toEqual(['Zane']);
	});
});

describe('drugName', () => {
	it('spells out the shorthand staff use', () => {
		expect(drugName('doxy')).toBe('Doxycycline');
		expect(drugName('metro')).toBe('Metronidazole');
		expect(drugName('cough tabs')).toBe('Cough tabs');
	});
});

describe('planSlackMedical', () => {
	it('adds a treatment with what it is for, from the day of the post', () => {
		const { patch } = plan({ treatments: [] }, [act({ drug: 'doxy', condition: 'URI' }), act({ drug: 'cough tabs', condition: 'URI' })]);
		expect(patch?.treatments).toEqual([
			{ id: 'new-id', name: 'Doxycycline', condition: 'URI', notes: null, startDate: '2026-10-08T18:00:00.000Z', endDate: null },
			{ id: 'new-id', name: 'Cough tabs', condition: 'URI', notes: null, startDate: '2026-10-08T18:00:00.000Z', endDate: null }
		]);
	});

	it('leaves a drug the dog is already on, only filling in the condition', () => {
		const t = { id: 'a', name: 'Doxycycline 100mg', condition: null, asmRegimenId: 10 };
		expect(plan({ treatments: [t] }, [act({ drug: 'doxy', condition: 'URI' })]).patch?.treatments).toEqual([{ ...t, condition: 'URI' }]);
		expect(plan({ treatments: [{ ...t, condition: 'kennel cough' }] }, [act({ drug: 'doxy', condition: 'URI' })]).patch).toBeNull();
	});

	it('starts FortiFlora unless a course is already running', () => {
		expect(plan({}, [act({ type: 'fortiflora', days: null })]).patch).toEqual({
			fortifloraDate: '2026-10-08T18:00:00.000Z',
			fortifloraDays: 7,
			fortifloraTime: 'both'
		});
		expect(plan({ fortifloraDate: '2026-10-05T18:00:00.000Z', fortifloraDays: 14 }, [act({ type: 'fortiflora' })]).patch).toBeNull();
		expect(plan({ fortifloraAsmRegimenId: 3 }, [act({ type: 'fortiflora' })]).patch).toBeNull();
	});

	it('sets monitor, iso and fleas without undoing anything', () => {
		expect(plan({}, [act({ type: 'monitor', condition: 'diarrhea' })]).patch).toEqual({ sickMonitor: true, sickMonitorReason: 'diarrhea', sickMonitorSince: AT });
		expect(plan({ sickHold: true }, [act({ type: 'monitor' })]).patch).toBeNull();
		expect(plan({ isolationStatus: 'none' }, [act({ type: 'isolation', condition: 'giardia' })]).patch).toEqual({ isolationStatus: 'iso', isolationReason: 'sick' });
		expect(plan({ isolationStatus: 'iso', isolationReason: 'bite_quarantine' }, [act({ type: 'isolation' })]).patch).toBeNull();
		expect(plan({}, [act({ type: 'fleas' })]).patch).toEqual({ hasFleas: true });
	});

	it('sends one-offs to notes', () => {
		const r = plan({}, [act({ type: 'note', note: 'Given triple dewormer for tapeworms' })]);
		expect(r).toEqual({ patch: null, notes: ['Given triple dewormer for tapeworms'] });
	});
});

describe('slack treatment, then asm', () => {
	it("is replaced by ASM's regimen for the same drug, keeping the condition", () => {
		const { patch } = plan({ treatments: [] }, [act({ drug: 'doxy', condition: 'URI' })]);
		const regimen: AsmRegimen = {
			regimenId: 10, animalId: 1, shelterCode: '', shortCode: '', treatmentName: 'Doxycycline', dosage: '100mg', frequency: '', comments: '',
			startDate: '2026-10-08', nextDue: '2026-10-09', nextDueHour: null, remaining: 6, perPeriod: 2, unit: 0, every: 1, totalPeriods: 7, openEnded: false
		};
		const after = planDogMedical({ status: 'active', ...patch }, [regimen], [], '2026-10-09', () => 'asm-id');
		const list = after?.treatments as { id: string; name: string; condition: string; asmRegimenId: number }[];
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ id: 'new-id', name: 'Doxycycline', condition: 'URI', asmRegimenId: 10 });
	});
});

describe('describeAction', () => {
	it('reads an action back in a line', () => {
		expect(describeAction(raw({ drug: 'doxy', condition: 'URI' }))).toBe('Bruiser: Doxycycline for URI');
		expect(describeAction(raw({ type: 'isolation', dogName: 'Zane', condition: 'giardia' }))).toBe('Zane: into ISO for giardia');
	});
});
