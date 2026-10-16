import { describe, expect, it } from 'vitest';
import { describeAction, dogsNamed, planSlackMedical, resolveMedicalActions, type MedicalAction, type RawMedicalAction } from './medicalSlack';

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

const raw = (o: Partial<RawMedicalAction>): RawMedicalAction => ({ type: 'monitor', dogName: 'Bruiser', condition: null, ...o });
const act = (o: Partial<MedicalAction>): MedicalAction => ({ ...raw(o), dogId: '1', dogName: 'Bruiser', ...o });
const AT = '2026-10-08T19:27:00.000Z';

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
		const r = resolveMedicalActions([raw({ dogName: 'Loki', condition: 'diarrhea' }), raw({ dogName: 'Luno' }), raw({ dogName: 'Zane' })], roster);
		expect(r.actions.map((a) => a.dogId)).toEqual(['2', '3']);
		expect(r.unmatched).toEqual(['Zane']);
	});
});

describe('planSlackMedical', () => {
	it('puts the dog on monitor with the reason, from when it was posted', () => {
		expect(planSlackMedical({}, [act({ condition: 'diarrhea' })], AT)).toEqual({ sickMonitor: true, sickMonitorReason: 'diarrhea', sickMonitorSince: AT });
	});

	it('leaves a dog already on monitor or flagged sick alone', () => {
		expect(planSlackMedical({ sickMonitor: true, sickMonitorReason: 'cough' }, [act({ condition: 'diarrhea' })], AT)).toBeNull();
		expect(planSlackMedical({ sickHold: true }, [act({})], AT)).toBeNull();
		expect(planSlackMedical({}, [], AT)).toBeNull();
	});
});

describe('describeAction', () => {
	it('reads an action back in a line', () => {
		expect(describeAction(raw({ dogName: 'Loki', condition: 'diarrhea' }))).toBe('Loki: monitor for diarrhea');
		expect(describeAction(raw({}))).toBe('Bruiser: monitor');
	});
});
