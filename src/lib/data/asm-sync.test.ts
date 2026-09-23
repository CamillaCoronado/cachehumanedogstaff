import { describe, expect, it } from 'vitest';
import { syncAnimalsFromASM, type AsmAnimal, type SyncEnvironment } from './asm-sync';

function fakeEnv(
	docs: Record<string, Record<string, unknown>>,
	opts: { animals?: Partial<AsmAnimal>[]; deaths?: { shelterCode: string; deceasedAt: string }[] } = {}
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
});
