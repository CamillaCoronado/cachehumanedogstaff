import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { PendingSurgery } from '$lib/types';
import { db } from '$lib/firebase/config';
import { updateDog } from '$lib/data/dogs';

const COLLECTION = 'pendingSurgeries';

/**
 * Sorted here rather than by Firestore: pairing a filter with an order needs a composite
 * index, and the queue is a handful of messages. Errors are thrown, not swallowed — an
 * empty list on failure is indistinguishable from an empty queue.
 */
export async function listPendingSurgeries(): Promise<PendingSurgery[]> {
	if (!db) return [];
	const snapshot = await getDocs(query(collection(db, COLLECTION), where('processed', '==', false)));
	return snapshot.docs
		.map((d) => ({ id: d.id, ...(d.data() as Omit<PendingSurgery, 'id'>) }))
		.sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
}

/**
 * Stamps surgeryDate on each dog, which is what keeps them off the morning feed list.
 * Dated to the day the list was posted, since that is the day they fast.
 */
export async function acceptPendingSurgery(pending: PendingSurgery): Promise<number> {
	if (!db) return 0;
	const date = new Date(pending.postedAt);

	for (const dog of pending.dogs) {
		await updateDog(dog.dogId, { surgeryDate: date });
	}

	await setDoc(doc(db, COLLECTION, pending.id), { processed: true }, { merge: true });
	return pending.dogs.length;
}

/** Discard the list without marking any dog for surgery. */
export async function dismissPendingSurgery(id: string): Promise<void> {
	if (!db) return;
	await deleteDoc(doc(db, COLLECTION, id));
}
