import { getAdminDb } from '$lib/firebase/admin';
import type { SyncChange } from '$lib/data/asm-sync';
import { syncEventDocs } from '$lib/data/syncEvents';

/**
 * Server-side twin of recordSyncEvents(). The grouping and id derivation are shared, so
 * the two paths cannot drift into producing different documents for the same sync.
 */
export async function recordSyncEventsAdmin(changes: SyncChange[]): Promise<void> {
	const docs = syncEventDocs(changes, new Date());
	if (docs.length === 0) return;
	const db = getAdminDb();
	const batch = db.batch();
	for (const { id, data } of docs) {
		batch.set(db.collection('syncEvents').doc(id), data);
	}
	await batch.commit();
}
