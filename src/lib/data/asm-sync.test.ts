import { describe, expect, it } from 'vitest';
import { syncAnimalsFromASM, type AsmAnimal, type SyncEnvironment } from './asm-sync';

function fakeEnv(
	docs: Record<string, Record<string, unknown>>,
	opts: { animals?: Partial<AsmAnimal>[]; deaths?: { shelterCode: string; deceasedAt: string }[]; transfers?: { shelterCode: string; movedAt: string }[] } = {}
) {
	const store = new Map(Object.entries(docs).map(([id, d]) => [id, { ...d }]));
	const state = new Map<string, unknown>();
	const env: SyncEnvironment = {
		async listDogs() {
			return new Map([...store].map(([id, d]) => [id, { ...d }]));
		},
		async commit(writes) {
			for (const { id, data } of writes) store.set(id, { ...(store.get(id) ?? {}), ...data });
		},
		async fetchAnimals() {
			return (opts.animals ?? []) as AsmAnimal[];
		},
		async fetchRecentAdoptions() {
			return [];
		},
		async fetchRecentDeaths() {
			return opts.deaths ?? [];
		},
		async fetchRecentTransfers() {
			return opts.transfers ?? [];
		},
		async readState<T>(key: string, fallback: T) {
			return (state.get(key) as T) ?? fallback;
		},
		async writeState(key, value) {
			state.set(key, value);
		}
	};
	return { env, store };
}

// One dog still on the shelter list, so the sync never sees an empty shelter.
const stayer = { ID: 1, ANIMALNAME: 'Stayer', SPECIESNAME: 'Dog', SHELTERCODE: 'A1' };

describe('deaths from ASM', () => {
	it('archives a dog that died as euthanized, not adopted', async () => {
		const { env, store } = fakeEnv(
			{ '5': { name: 'Old Soul', status: 'active', asmId: 5, asmShelterCode: 'A5' } },
			{ animals: [stayer], deaths: [{ shelterCode: 'A5', deceasedAt: '2026-09-20 00:00:00' }] }
		);
		const { changes } = await syncAnimalsFromASM(env);
		expect(store.get('5')?.status).toBe('euthanized');
		expect(store.get('5')?.leftShelterDate).toBe('2026-09-20');
		expect(changes.find((c) => c.id === '5')).toMatchObject({ isEuthanized: true, isArchived: false });
	});

	it('still archives a dog with no death record as adopted', async () => {
		const { env, store } = fakeEnv(
			{ '6': { name: 'Lucky', status: 'active', asmId: 6, asmShelterCode: 'A6' } },
			{ animals: [stayer] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('6')?.status).toBe('adopted');
	});

	it('corrects a death that was archived as an adoption', async () => {
		const { env, store } = fakeEnv(
			{ '7': { name: 'Misfiled', status: 'adopted', asmId: 7, asmShelterCode: 'A7', leftShelterDate: '2026-09-20T18:00:00.000Z' } },
			{ animals: [stayer], deaths: [{ shelterCode: 'A7', deceasedAt: '2026-09-20' }] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('7')?.status).toBe('euthanized');
	});

	it('leaves a real adoption alone when the dog died long after', async () => {
		const { env, store } = fakeEnv(
			{ '8': { name: 'Homed', status: 'adopted', asmId: 8, asmShelterCode: 'A8', leftShelterDate: '2026-03-01T18:00:00.000Z' } },
			{ animals: [stayer], deaths: [{ shelterCode: 'A8', deceasedAt: '2026-09-20' }] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('8')?.status).toBe('adopted');
	});
});

describe('transfers from ASM', () => {
	it('archives a transferred dog as transferred, with the movement date', async () => {
		const { env, store } = fakeEnv(
			{ '9': { name: 'Bus Rider', status: 'active', asmId: 9, asmShelterCode: 'A9' } },
			{ animals: [stayer], transfers: [{ shelterCode: 'A9', movedAt: '2026-09-21 00:00:00' }] }
		);
		const { changes } = await syncAnimalsFromASM(env);
		expect(store.get('9')?.status).toBe('transferred');
		expect(store.get('9')?.leftShelterDate).toBe('2026-09-21');
		expect(changes.find((c) => c.id === '9')).toMatchObject({ isTransferredOut: true, isArchived: false });
	});

	it('a death still wins over a transfer', async () => {
		const { env, store } = fakeEnv(
			{ '10': { name: 'Both', status: 'active', asmId: 10, asmShelterCode: 'A10' } },
			{
				animals: [stayer],
				transfers: [{ shelterCode: 'A10', movedAt: '2026-09-21' }],
				deaths: [{ shelterCode: 'A10', deceasedAt: '2026-09-22' }]
			}
		);
		await syncAnimalsFromASM(env);
		expect(store.get('10')?.status).toBe('euthanized');
	});

	it('corrects a transfer that was archived as an adoption', async () => {
		const { env, store } = fakeEnv(
			{ '11': { name: 'Misfiled', status: 'adopted', asmId: 11, asmShelterCode: 'A11', leftShelterDate: '2026-09-21T18:00:00.000Z' } },
			{ animals: [stayer], transfers: [{ shelterCode: 'A11', movedAt: '2026-09-21' }] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('11')?.status).toBe('transferred');
	});
});

describe('stamps on arrival and foster return', () => {
	it('stamps fosterReturnedAt, not shelterSince, when a dog comes back from foster', async () => {
		const { env, store } = fakeEnv(
			{ '2': { name: 'Back', status: 'active', asmId: 2, asmShelterCode: 'A2', inFoster: true, shelterSince: '2026-03-01T12:00:00.000Z' } },
			{ animals: [stayer, { ID: 2, ANIMALNAME: 'Back', SPECIESNAME: 'Dog', SHELTERCODE: 'A2' }] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('2')?.fosterReturnedAt).toBeTruthy();
		expect(store.get('2')?.shelterSince).toBe('2026-03-01T12:00:00.000Z');
	});

	it('stamps shelterSince when a transfer moves off Incoming', async () => {
		const { env, store } = fakeEnv(
			{ '3': { name: 'Transfer', status: 'active', asmId: 3, asmShelterCode: 'A3', isIncoming: true } },
			{ animals: [stayer, { ID: 3, ANIMALNAME: 'Transfer', SPECIESNAME: 'Dog', SHELTERCODE: 'A3', DISPLAYLOCATIONNAME: 'Kennel 4' }] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('3')?.shelterSince).toBeTruthy();
		expect(store.get('3')?.fosterReturnedAt).toBeUndefined();
	});

	it("times an ASM isolation stay so the enrichment clock skips it", async () => {
		const { env, store } = fakeEnv(
			{
				'4': { name: 'Sniffles', status: 'active', asmId: 4, asmShelterCode: 'A4', isolationStatus: 'none' },
				'5': { name: 'Better', status: 'active', asmId: 5, asmShelterCode: 'A5', isolationStatus: 'iso', enrichmentHoldStart: '2026-03-01T12:00:00.000Z' }
			},
			{
				animals: [
					stayer,
					{ ID: 4, ANIMALNAME: 'Sniffles', SPECIESNAME: 'Dog', SHELTERCODE: 'A4', DISPLAYLOCATIONNAME: 'Iso 1' },
					{ ID: 5, ANIMALNAME: 'Better', SPECIESNAME: 'Dog', SHELTERCODE: 'A5', DISPLAYLOCATIONNAME: 'Kennel 2' }
				]
			}
		);
		await syncAnimalsFromASM(env);
		expect(store.get('4')?.enrichmentHoldStart).toBeTruthy();
		expect(store.get('4')?.enrichmentResetDate).toBeUndefined();
		expect(store.get('5')?.enrichmentHoldStart).toBe('2026-03-01T12:00:00.000Z');
		expect(store.get('5')?.enrichmentResetDate).toBeTruthy();
	});
});

describe('permanent foster', () => {
	it('keeps a permanent foster active, not adopted, and undoes an old archive', async () => {
		const { env, store } = fakeEnv(
			{ '4': { name: 'Arcanine', status: 'adopted', asmId: 4, asmShelterCode: 'A4', leftShelterDate: '2026-05-01T12:00:00.000Z', permanentFoster: true } },
			{ animals: [stayer, { ID: 4, ANIMALNAME: 'Arcanine', SPECIESNAME: 'Dog', SHELTERCODE: 'A4', ACTIVEMOVEMENTTYPE: 2, HASPERMANENTFOSTER: 1 }] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('4')?.status).toBe('active');
		expect(store.get('4')?.permanentFoster).toBe(true);
		expect(store.get('4')?.leftShelterDate).toBeNull();
	});
});

describe('selective with dogs', () => {
	it("reads ASM's Selective (3) as selective", async () => {
		const { env, store } = fakeEnv(
			{},
			{ animals: [stayer, { ID: 4, ANIMALNAME: 'Picky', SPECIESNAME: 'Dog', SHELTERCODE: 'A4', ISGOODWITHDOGS: 3 }] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('4')?.goodWithDogs).toBe('selective');
	});

	it('an ASM unknown keeps a selective set in the app, but a yes/no from ASM wins', async () => {
		const { env, store } = fakeEnv(
			{
				'5': { name: 'Kept', status: 'active', asmId: 5, asmShelterCode: 'A5', goodWithDogs: 'selective' },
				'6': { name: 'Over', status: 'active', asmId: 6, asmShelterCode: 'A6', goodWithDogs: 'selective' }
			},
			{
				animals: [
					stayer,
					{ ID: 5, ANIMALNAME: 'Kept', SPECIESNAME: 'Dog', SHELTERCODE: 'A5', ISGOODWITHDOGS: 2 },
					{ ID: 6, ANIMALNAME: 'Over', SPECIESNAME: 'Dog', SHELTERCODE: 'A6', ISGOODWITHDOGS: 1 }
				]
			}
		);
		await syncAnimalsFromASM(env);
		expect(store.get('5')?.goodWithDogs).toBe('selective');
		expect(store.get('6')?.goodWithDogs).toBe('no');
	});
});

describe('adoption holds', () => {
	it('copies ASM holds and clears ones ASM dropped or that have run out', async () => {
		const { env, store } = fakeEnv(
			{ '6': { name: 'Was', status: 'active', asmId: 6, asmShelterCode: 'A6', asmHold: true, asmHoldUntil: '2026-01-01' } },
			{
				animals: [
					stayer,
					{ ID: 6, ANIMALNAME: 'Was', SPECIESNAME: 'Dog', SHELTERCODE: 'A6', ISHOLD: 0 },
					{ ID: 7, ANIMALNAME: 'Held', SPECIESNAME: 'Dog', SHELTERCODE: 'A7', ISHOLD: 1, HOLDUNTILDATE: '2999-10-30T00:00:00' },
					{ ID: 8, ANIMALNAME: 'Open', SPECIESNAME: 'Dog', SHELTERCODE: 'A8', ISHOLD: 1, HOLDUNTILDATE: null },
					{ ID: 9, ANIMALNAME: 'Lapsed', SPECIESNAME: 'Dog', SHELTERCODE: 'A9', ISHOLD: 1, HOLDUNTILDATE: '2020-01-01T00:00:00' }
				]
			}
		);
		await syncAnimalsFromASM(env);
		expect(store.get('6')).toMatchObject({ asmHold: false, asmHoldUntil: null });
		expect(store.get('7')).toMatchObject({ asmHold: true, asmHoldUntil: '2999-10-30' });
		expect(store.get('8')).toMatchObject({ asmHold: true, asmHoldUntil: null });
		expect(store.get('9')).toMatchObject({ asmHold: false, asmHoldUntil: null });
	});
});

describe('re-entries from ASM', () => {
	const back = { ID: 6, ANIMALNAME: 'Boomerang', SPECIESNAME: 'Dog', SHELTERCODE: 'A6', DATEBROUGHTIN: '2026-02-01T00:00:00', MOSTRECENTENTRYDATE: '2026-10-20T00:00:00' };

	it("records ASM's latest entry as a re-entry on a dog the app already has", async () => {
		const { env, store } = fakeEnv(
			{ '6': { name: 'Boomerang', status: 'active', asmId: 6, asmShelterCode: 'A6', reentryDates: [] } },
			{ animals: [stayer, back] }
		);
		const { changes } = await syncAnimalsFromASM(env);
		expect(store.get('6')?.reentryDates).toEqual(['2026-10-20']);
		expect(changes.find((c) => c.id === '6')?.fields).toContain('Re-entries');
	});

	it('records it on a dog that has only ever come in once as none', async () => {
		const { env, store } = fakeEnv({}, { animals: [stayer, { ...back, MOSTRECENTENTRYDATE: back.DATEBROUGHTIN }] });
		await syncAnimalsFromASM(env);
		expect(store.get('6')?.reentryDates).toEqual([]);
	});

	it('keeps earlier returns, replaces an app-stamped one, and drops dates outside the stays', async () => {
		const { env, store } = fakeEnv(
			{
				'6': {
					name: 'Boomerang', status: 'active', asmId: 6, asmShelterCode: 'A6',
					reentryDates: ['2026-05-03T16:00:00.000Z', '2026-10-21T01:30:00.000Z', '2026-01-15T12:00:00.000Z', '2026-11-30T12:00:00.000Z']
				}
			},
			{ animals: [stayer, back] }
		);
		await syncAnimalsFromASM(env);
		expect(store.get('6')?.reentryDates).toEqual(['2026-05-03', '2026-10-20']);
	});

	it("doesn't count the dog as changed once its re-entries match", async () => {
		const { env } = fakeEnv(
			{ '6': { name: 'Boomerang', status: 'active', asmId: 6, asmShelterCode: 'A6', reentryDates: ['2026-10-20T06:00:00.000Z'] } },
			{ animals: [stayer, back] }
		);
		const { changes } = await syncAnimalsFromASM(env);
		expect(changes.find((c) => c.id === '6')?.fields ?? []).not.toContain('Re-entries');
	});
});
