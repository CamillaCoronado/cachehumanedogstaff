import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, where } from 'firebase/firestore';
import type { PendingFeeding, UserProfile } from '$lib/types';
import { db } from '$lib/firebase/config';
import { feedingLogId } from '$lib/data/feedingImport';
import { addFeedingLog } from '$lib/data/dogs';

const COLLECTION = 'pendingFeedings';

export async function listPendingFeedings(): Promise<PendingFeeding[]> {
	if (!db) return [];
	try {
		const snapshot = await getDocs(
			query(collection(db, COLLECTION), where('processed', '==', false), orderBy('postedAt', 'desc'))
		);
		return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PendingFeeding, 'id'>) }));
	} catch {
		// Missing index or rules — an empty queue is better than a broken Admin page.
		return [];
	}
}

/**
 * Writes the feeding logs this message implies, then marks it done.
 *
 * Each log keeps its provenance: who wrote the message, that it came from Slack, and
 * the message itself, so anything questionable can be traced back and the whole batch
 * can be found later.
 */
export async function acceptPendingFeeding(
	pending: PendingFeeding,
	profile?: UserProfile | null
): Promise<number> {
	if (!db) return 0;
	const date = new Date(pending.postedAt);

	for (const entry of pending.entries) {
		await addFeedingLog(
			entry.dogId,
			{
				date,
				mealTime: entry.mealTime,
				amountEaten: entry.amountEaten,
				notes: `via Slack — ${pending.author}: "${pending.rawText.slice(0, 180)}"`
			},
			profile,
			{
				id: feedingLogId(pending.slackTs, entry.dogId, entry.mealTime),
				loggedBy: 'slack-import',
				loggedByName: `${pending.author} (via Slack)`,
				extra: { source: 'slack', sourceTs: pending.slackTs, mealTimeInferred: entry.mealTimeInferred }
			}
		);
	}

	await setDoc(doc(db, COLLECTION, pending.id), { processed: true }, { merge: true });
	return pending.entries.length;
}

/** Discard a message without writing anything. */
export async function dismissPendingFeeding(id: string): Promise<void> {
	if (!db) return;
	await deleteDoc(doc(db, COLLECTION, id));
}
