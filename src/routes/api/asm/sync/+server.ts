import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin';
import { syncAnimalsFromASM } from '$lib/data/asm-sync';
import { createAdminSyncEnvironment } from '$lib/server/asmSyncEnv';
import { recordSyncEventsAdmin } from '$lib/server/syncEventsAdmin';

/**
 * Twenty people opening the app at 8am should not each reconcile the whole roster
 * against ASM. The first one through the door does the work; the rest are told it is
 * already fresh and just read the events it recorded.
 */
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const LOCK_DOC = 'syncState/lastAsmSync';

export async function POST({ request }: RequestEvent) {
	// Any signed-in, approved user may trigger a sync. The writes happen here with admin
	// credentials, so this does not require — and does not grant — dog-edit permission.
	const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	if (!token) throw error(401, 'Missing auth token');

	let uid: string;
	try {
		uid = (await getAdminAuth().verifyIdToken(token)).uid;
	} catch {
		throw error(401, 'Invalid auth token');
	}

	const db = getAdminDb();
	const profile = await db.collection('users').doc(uid).get();
	if (!profile.exists) throw error(403, 'No profile');
	if (profile.data()?.approved === false) throw error(403, 'Account not approved');

	const lockRef = db.doc(LOCK_DOC);

	// Claim the slot in a transaction so two simultaneous logins cannot both decide they
	// are the one to run it.
	const claimed = await db.runTransaction(async (tx) => {
		const snap = await tx.get(lockRef);
		const last = snap.exists ? Number(snap.data()?.at ?? 0) : 0;
		if (Date.now() - last < MIN_INTERVAL_MS) return false;
		tx.set(lockRef, { at: Date.now(), by: uid });
		return true;
	});

	if (!claimed) return json({ synced: false, reason: 'recent', changes: [] });

	const result = await syncAnimalsFromASM(createAdminSyncEnvironment());
	if (result.changes.length > 0) await recordSyncEventsAdmin(result.changes);

	// Return the changes themselves, not just a count — the sync log panel lists them.
	return json({ synced: true, changes: result.changes });
}
