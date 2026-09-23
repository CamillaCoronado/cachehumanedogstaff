import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { checkDeparture } from './departureCheck';

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
});
