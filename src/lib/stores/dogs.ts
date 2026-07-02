import { writable, get } from 'svelte/store';
import { listDogs } from '$lib/data/dogs';
import { syncVersion } from '$lib/stores/sync';
import type { Dog } from '$lib/types';

// Shared dog collection (refactor-plan Phase 3). Pages read `$dogs` instead of
// each fetching the full collection on mount; `ensureDogsLoaded()` fetches once
// and reuses across navigations. An ASM sync (syncVersion bump) or an explicit
// `refreshDogs()` re-fetches for everyone.

export const dogs = writable<Dog[]>([]);
export const dogsLoading = writable(false);
export const dogsLoaded = writable(false);

// Serve the cache instantly on navigation, but kick a background re-fetch when
// it is older than this — another device may have written since we loaded.
const STALE_MS = 2 * 60 * 1000;

let lastLoaded = 0;
let inflight: Promise<Dog[]> | null = null;

/** Force-fetch the collection and update the store. Concurrent calls share one request. */
export function refreshDogs(): Promise<Dog[]> {
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
 * Returns the cached collection, fetching it first only if it has never loaded.
 * A stale cache is returned immediately and refreshed in the background.
 */
export async function ensureDogsLoaded(): Promise<Dog[]> {
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

// Re-fetch when an ASM sync lands (the existing cross-page refresh mechanism).
// Module-level subscription is intentional: the store outlives any page.
syncVersion.subscribe((version) => {
	if (version > 0 && get(dogsLoaded)) void refreshDogs().catch(() => {});
});
