import { collection, deleteDoc, doc, getDoc, getDocs } from 'firebase/firestore';
import type { PendingSurgery } from '$lib/types';
import { db } from '$lib/firebase/config';
import { updateDog } from '$lib/data/dogs';

const COLLECTION = 'pendingSurgeries';

/**
 * Surgery lists that have been applied, newest first. They are applied on arrival rather
 * than held for approval — the list lands at 9am and the morning feed follows — so this
 * is a record of what happened, not a queue of work.
 *
 * Sorted here rather than by Firestore, which would need a composite index for a filter
 * plus an order. Errors are thrown, not swallowed: an empty list on failure looks exactly
 * like a quiet morning.
 */
export async function listRecentSurgeryLists(limit = 8): Promise<PendingSurgery[]> {
	if (!db) return [];
	const snapshot = await getDocs(collection(db, COLLECTION));
	return snapshot.docs
		.map((d) => ({ id: d.id, ...(d.data() as Omit<PendingSurgery, 'id'>) }))
		.sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1))
		.slice(0, limit);
}

/**
 * Clears the surgery date this list set. Only touches dogs whose stamp still points at
 * this message, so a date since changed by hand or by a later list is left alone.
 */
export async function undoSurgeryList(pending: PendingSurgery): Promise<number> {
	if (!db) return 0;
	const stamp = `slack:${pending.slackTs}`;
	let cleared = 0;
	for (const dog of pending.dogs) {
		const snap = await getDoc(doc(db, 'dogs', dog.dogId));
		if (!snap.exists() || snap.data()?.surgerySource !== stamp) continue;
		await updateDog(dog.dogId, { surgeryDate: null, surgerySource: null, surgeryNote: null });
		cleared++;
	}
	await deleteDoc(doc(db, COLLECTION, pending.id));
	return cleared;
}
