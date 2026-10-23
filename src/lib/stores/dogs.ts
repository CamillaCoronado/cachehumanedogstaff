import { writable, get } from 'svelte/store';
import { listDogs, settleDogWrites, subscribeDogs } from '$lib/data/dogs';
import { syncVersion } from '$lib/stores/sync';
import type { Dog } from '$lib/types';

// Shared dog collection (refactor-plan Phase 3). Pages read `$dogs` instead of
// each fetching the full collection on mount; `ensureDogsLoaded()` loads once
// and reuses across navigations.
//
// With Firestore the store is a live listener: the first rows come from the
// on-device cache (so pages draw before the shelter's cell signal answers) and
// every later change, from this device, another, or the server-side ASM sync,
// lands in `$dogs` on its own. Without Firestore it falls back to one-off fetches.

export const dogs = writable<Dog[]>([]);
export const dogsLoading = writable(false);
export const dogsLoaded = writable(false);

// Fetch mode only: serve the cache instantly on navigation, but kick a background
// re-fetch when it is older than this — another device may have written since.
const STALE_MS = 2 * 60 * 1000;

let lastLoaded = 0;
let inflight: Promise<Dog[]> | null = null;

let unsubscribe: (() => void) | null = null;
let firstSnapshot: Promise<Dog[]> | null = null;

/** Start the live listener; resolves once rows are in, with the latest. Null without Firestore. */
function listen(): Promise<Dog[]> | null {
	if (firstSnapshot) return firstSnapshot.then(() => get(dogs));
	let settle!: { resolve: (rows: Dog[]) => void; reject: (error: Error) => void };
	const pending = new Promise<Dog[]>((resolve, reject) => (settle = { resolve, reject }));
	let first = true;
	dogsLoading.set(true);
	const stop = subscribeDogs(
		(rows) => {
			dogs.set(rows);
			dogsLoaded.set(true);
			lastLoaded = Date.now();
			if (first) {
				first = false;
				dogsLoading.set(false);
				settle.resolve(rows);
			}
		},
		(error) => {
			// A dropped listener (signed out, rules changed) is restarted by the next ensure call.
			console.error('[dogs listener]', error);
			unsubscribe?.();
			unsubscribe = null;
			firstSnapshot = null;
			dogsLoading.set(false);
			if (first) settle.reject(error);
		}
	);
	if (!stop) {
		dogsLoading.set(false);
		return null;
	}
	unsubscribe = stop;
	firstSnapshot = pending;
	return pending.then(() => get(dogs));
}

/**
 * Bring the store up to date and return it. With the listener running that only
 * means waiting for this device's own writes to land; otherwise it re-fetches.
 * Concurrent fetches share one request.
 */
export function refreshDogs(): Promise<Dog[]> {
	if (firstSnapshot) return firstSnapshot.then(() => settleDogWrites()).then(() => get(dogs));
	const live = listen();
	if (live) return live;
	if (inflight) return inflight;
	dogsLoading.set(true);
	inflight = listDogs()
		.then((rows) => {
			dogs.set(rows);
			dogsLoaded.set(true);
			lastLoaded = Date.now();
			return rows;
		})
		.finally(() => {
			dogsLoading.set(false);
			inflight = null;
		});
	return inflight;
}

/**
 * Returns the cached collection, loading it first only if it has never loaded.
 * In fetch mode a stale cache is returned immediately and refreshed in the background.
 */
export async function ensureDogsLoaded(): Promise<Dog[]> {
	const live = listen();
	if (live) return live;
	if (!get(dogsLoaded)) return refreshDogs();
	if (Date.now() - lastLoaded > STALE_MS) void refreshDogs().catch(() => {});
	return get(dogs);
}

/**
 * Apply a local mutation to the cached list without a re-fetch — call after a
 * successful updateDog so every page sees the change immediately.
 */
export function patchDogInStore(id: string, updates: Partial<Dog>): void {
	dogs.update((rows) => rows.map((d) => (d.id === id ? { ...d, ...updates } : d)));
}

// Fetch mode: re-fetch when an ASM sync lands. The listener needs nothing here,
// since the sync's writes reach it directly.
// Module-level subscription is intentional: the store outlives any page.
syncVersion.subscribe((version) => {
	if (version > 0 && get(dogsLoaded) && !unsubscribe) void refreshDogs().catch(() => {});
});
