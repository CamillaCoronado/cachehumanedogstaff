import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Dog } from '$lib/types';

// Mock the data layer so importing the store never touches Firebase.
const listDogs = vi.fn<() => Promise<Dog[]>>();
// Null = no Firestore, so the store runs in fetch mode unless a test opts in.
type Listener = { onRows: (rows: Dog[]) => void; onError: (error: Error) => void };
const subscribeDogs = vi.fn<(onRows: Listener['onRows'], onError: Listener['onError']) => (() => void) | null>();
vi.mock('$lib/data/dogs', () => ({
	listDogs: () => listDogs(),
	subscribeDogs: (onRows: Listener['onRows'], onError: Listener['onError']) => subscribeDogs(onRows, onError),
	settleDogWrites: () => Promise.resolve()
}));

/** Opt a test into listener mode; returns a handle to push snapshots. */
function fakeListener() {
	const handle = { current: null as Listener | null, stop: vi.fn() };
	subscribeDogs.mockImplementation((onRows, onError) => {
		handle.current = { onRows, onError };
		return handle.stop;
	});
	return handle;
}

function makeDog(id: string, overrides: Partial<Dog> = {}): Dog {
	return { id, name: `Dog ${id}`, status: 'active', ...overrides } as Dog;
}

// The store keeps module-level state (cache age, inflight request, syncVersion
// subscription), so every test gets a freshly imported copy.
async function freshStore() {
	vi.resetModules();
	const sync = await import('$lib/stores/sync');
	sync.syncVersion.set(0);
	const store = await import('./dogs');
	return { ...store, syncVersion: sync.syncVersion };
}

beforeEach(() => {
	listDogs.mockReset();
	subscribeDogs.mockReset();
	subscribeDogs.mockReturnValue(null);
	vi.useRealTimers();
});

describe('ensureDogsLoaded', () => {
	it('fetches once and serves the cache on later calls', async () => {
		const { ensureDogsLoaded, dogs } = await freshStore();
		listDogs.mockResolvedValue([makeDog('a'), makeDog('b')]);

		const first = await ensureDogsLoaded();
		const second = await ensureDogsLoaded();

		expect(listDogs).toHaveBeenCalledTimes(1);
		expect(first).toHaveLength(2);
		expect(second).toBe(first);
		expect(get(dogs)).toHaveLength(2);
	});

	it('returns the stale cache immediately and re-fetches in the background', async () => {
		vi.useFakeTimers();
		const { ensureDogsLoaded, dogs } = await freshStore();
		listDogs.mockResolvedValue([makeDog('a')]);
		await ensureDogsLoaded();

		// Move past the 2-minute stale window; the next ensure call should serve
		// the old list synchronously but kick off a fresh fetch.
		vi.advanceTimersByTime(3 * 60 * 1000);
		listDogs.mockResolvedValue([makeDog('a'), makeDog('new')]);

		const served = await ensureDogsLoaded();
		expect(served).toHaveLength(1);
		expect(listDogs).toHaveBeenCalledTimes(2);

		await vi.runAllTimersAsync();
		expect(get(dogs)).toHaveLength(2);
	});
});

describe('refreshDogs', () => {
	it('shares one request across concurrent callers', async () => {
		const { refreshDogs } = await freshStore();
		let resolve!: (rows: Dog[]) => void;
		listDogs.mockReturnValue(new Promise<Dog[]>((r) => (resolve = r)));

		const p1 = refreshDogs();
		const p2 = refreshDogs();
		resolve([makeDog('a')]);

		expect(await p1).toEqual(await p2);
		expect(listDogs).toHaveBeenCalledTimes(1);
	});

	it('tracks loading state and always re-fetches', async () => {
		const { refreshDogs, dogsLoading } = await freshStore();
		listDogs.mockResolvedValue([makeDog('a')]);

		const pending = refreshDogs();
		expect(get(dogsLoading)).toBe(true);
		await pending;
		expect(get(dogsLoading)).toBe(false);

		await refreshDogs();
		expect(listDogs).toHaveBeenCalledTimes(2);
	});
});

describe('patchDogInStore', () => {
	it('applies a partial update to the matching dog only', async () => {
		const { ensureDogsLoaded, patchDogInStore, dogs } = await freshStore();
		listDogs.mockResolvedValue([makeDog('a'), makeDog('b')]);
		await ensureDogsLoaded();

		patchDogInStore('a', { isolationStatus: 'iso' });

		const rows = get(dogs);
		expect(rows.find((d) => d.id === 'a')?.isolationStatus).toBe('iso');
		expect(rows.find((d) => d.id === 'b')?.isolationStatus).toBeUndefined();
	});
});

describe('syncVersion subscription', () => {
	it('re-fetches on a sync bump, but only after the first load', async () => {
		const { ensureDogsLoaded, dogs, syncVersion } = await freshStore();

		// A bump before anything loaded must not fetch (matches the old pages'
		// `if ($syncVersion > 0)` guard).
		syncVersion.set(1);
		expect(listDogs).not.toHaveBeenCalled();

		listDogs.mockResolvedValue([makeDog('a')]);
		await ensureDogsLoaded();
		expect(listDogs).toHaveBeenCalledTimes(1);

		listDogs.mockResolvedValue([makeDog('a'), makeDog('b')]);
		syncVersion.set(2);
		await vi.waitFor(() => expect(get(dogs)).toHaveLength(2));
		expect(listDogs).toHaveBeenCalledTimes(2);
	});
});

describe('live listener', () => {
	it('resolves on the first snapshot and keeps the store current after it', async () => {
		const listener = fakeListener();
		const { ensureDogsLoaded, refreshDogs, dogs, dogsLoaded } = await freshStore();

		const first = ensureDogsLoaded();
		expect(get(dogsLoaded)).toBe(false);
		listener.current!.onRows([makeDog('a')]);
		expect(await first).toHaveLength(1);

		// A later change (another device, the ASM sync) lands without a fetch.
		listener.current!.onRows([makeDog('a'), makeDog('b')]);
		expect(get(dogs)).toHaveLength(2);
		expect(await refreshDogs()).toHaveLength(2);
		expect(await ensureDogsLoaded()).toHaveLength(2);
		expect(subscribeDogs).toHaveBeenCalledTimes(1);
		expect(listDogs).not.toHaveBeenCalled();
	});

	it('does not re-fetch on a sync bump', async () => {
		const listener = fakeListener();
		const { ensureDogsLoaded, syncVersion } = await freshStore();
		const first = ensureDogsLoaded();
		listener.current!.onRows([makeDog('a')]);
		await first;

		syncVersion.set(1);
		expect(listDogs).not.toHaveBeenCalled();
		expect(subscribeDogs).toHaveBeenCalledTimes(1);
	});

	it('restarts after the listener errors', async () => {
		const listener = fakeListener();
		const { ensureDogsLoaded } = await freshStore();

		const first = ensureDogsLoaded();
		listener.current!.onError(new Error('permission-denied'));
		await expect(first).rejects.toThrow('permission-denied');

		const second = ensureDogsLoaded();
		listener.current!.onRows([makeDog('a')]);
		expect(await second).toHaveLength(1);
		expect(subscribeDogs).toHaveBeenCalledTimes(2);
	});
});
