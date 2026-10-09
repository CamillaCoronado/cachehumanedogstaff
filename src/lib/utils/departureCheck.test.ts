import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { checkDeparture, findByCode, matchFromFeed, type AsmFeedAnimal } from './departureCheck';

const dog = (o: Partial<Dog>) => ({ id: '1', name: 'Rex', status: 'adopted', leftShelterDate: new Date(2026, 8, 20, 18), ...o }) as Dog;
const asm = (o: object) => ({ found: true, movementType: 1, movementDate: '2026-09-20', deceasedDate: null, ...o });

describe('checkDeparture', () => {
	it('leaves a dog alone when ASM agrees', () => {
		expect(checkDeparture(dog({}), asm({}))).toEqual({ kind: 'ok' });
	});

	it('fixes a departure dated the day the sync noticed, not the day it happened', () => {
		const r = checkDeparture(dog({}), asm({ movementDate: '2026-09-14' }));
		expect(r).toMatchObject({ kind: 'fix', status: 'adopted', date: '2026-09-14' });
	});

	it('fixes the outcome — a transfer or a death filed as an adoption', () => {
		expect(checkDeparture(dog({}), asm({ movementType: 3 }))).toMatchObject({ kind: 'fix', status: 'transferred' });
		expect(checkDeparture(dog({}), asm({ deceasedDate: '2026-09-18' }))).toMatchObject({ kind: 'fix', status: 'euthanized', date: '2026-09-18' });
	});

	it('flags a dog ASM still has on the shelter, without proposing a change', () => {
		expect(checkDeparture(dog({}), asm({ movementType: null, movementDate: null }))).toMatchObject({ kind: 'still-here' });
	});

	it('fills a missing date and keeps the status for outcomes the app has no word for', () => {
		const r = checkDeparture(dog({ leftShelterDate: null }), asm({ movementType: 5, movementDate: '2026-08-01' }));
		expect(r).toMatchObject({ kind: 'fix', status: 'adopted', date: '2026-08-01' });
	});

	it('passes on why a dog was not found', () => {
		expect(checkDeparture(dog({}), { ...asm({}), found: false, missReason: 'lookup failed: ASM returned 503' })).toEqual({
			kind: 'not-found',
			reason: 'lookup failed: ASM returned 503'
		});
	});

	it('flags a fix found by name only', () => {
		const r = checkDeparture(dog({}), asm({ deceasedDate: '2026-09-18', matchedByName: 'D2025-14' }));
		expect(r).toMatchObject({ kind: 'fix', status: 'euthanized', byName: true });
		if (r.kind === 'fix') expect(r.reason).toContain('D2025-14');
	});
});

describe('matchFromFeed', () => {
	const row = (o: Partial<AsmFeedAnimal>): AsmFeedAnimal => ({
		id: 900,
		shelterCode: 'D2026-1',
		shortCode: '14D',
		name: 'Dragon',
		movementType: null,
		movementDate: null,
		deceasedDate: '2026-08-02',
		...o
	});
	const dragon = (o: Partial<Dog> = {}) => dog({ id: 'abc', name: 'Dragon', intakeDate: new Date(2026, 5, 1), ...o });

	it('matches by ASM id or shelter code first', () => {
		expect(matchFromFeed(dragon({ asmId: 900, name: 'Other' }), [row({})])).toMatchObject({ found: true, matchedByName: null });
		expect(matchFromFeed(dragon({ asmShelterCode: 'd2026-1', name: 'Other' }), [row({})])).toMatchObject({ matchedByName: null });
	});

	it('falls back to a single exact name, flagged', () => {
		expect(matchFromFeed(dragon(), [row({}), row({ id: 901, name: 'Rex' })])).toMatchObject({
			deceasedDate: '2026-08-02',
			matchedByName: 'D2026-1'
		});
	});

	it('will not guess between two dogs of the same name', () => {
		expect(matchFromFeed(dragon(), [row({}), row({ id: 901, shelterCode: 'D2026-9' })])).toBeNull();
	});

	it('skips a same-name dog that left before this one came in', () => {
		expect(matchFromFeed(dragon(), [row({ deceasedDate: '2026-02-01' })])).toBeNull();
	});

	it('finds a typed code by shelter code or short code', () => {
		expect(findByCode(' d2026-1 ', [row({})])).toMatchObject({ found: true, deceasedDate: '2026-08-02' });
		expect(findByCode('14d', [row({})])).toMatchObject({ found: true });
		expect(findByCode('nope', [row({})])).toBeNull();
	});
});
