import { getAdminDb } from '$lib/firebase/admin';
import type { SyncChange } from '$lib/data/asm-sync';

/**
 * Every sync's changes, kept so each person sees what changed since they last looked —
 * not only the changes from a sync their own browser happened to run. Read and written
 * on the server only, so it needs no Firestore rules of its own.
 */
const COLLECTION = 'syncLog';
/** How far back "what you haven't seen" reaches for someone away a long while. */
const LOOKBACK_MS = 14 * 86_400_000;

export interface SyncLogEntry {
	/** When the sync ran, ms since epoch. */
	at: number;
	changes: SyncChange[];
}

export async function recordSyncLog(changes: SyncChange[], at = Date.now()): Promise<void> {
	if (changes.length === 0) return;
	await getAdminDb().collection(COLLECTION).add({ at, changes });
}

/** Syncs after `sinceMs`, oldest first. */
export async function syncLogSince(sinceMs: number): Promise<SyncLogEntry[]> {
	const from = Math.max(sinceMs, Date.now() - LOOKBACK_MS);
	const snap = await getAdminDb()
		.collection(COLLECTION)
		.where('at', '>', from)
		.orderBy('at')
		.limit(100)
		.get();
	return snap.docs.map((d) => ({ at: Number(d.data().at), changes: (d.data().changes ?? []) as SyncChange[] }));
}
