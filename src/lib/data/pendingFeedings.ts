import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { PendingFeeding, UserProfile } from '$lib/types';
import { db } from '$lib/firebase/config';
import { feedingLogId } from '$lib/data/feedingImport';
import { addFeedingLog } from '$lib/data/dogs';
import { db as firestore } from '$lib/firebase/config';
import { isSameCalendarDay } from '$lib/utils/dates';

const COLLECTION = 'pendingFeedings';

/**
 * Sorted here rather than by Firestore: pairing a filter with an order needs a composite
 * index, and without it the query throws. The queue is a handful of messages, so sorting
 * in the browser costs nothing and removes the dependency.
 *
 * Errors are thrown, not swallowed. Returning an empty list on failure made a broken
 * query look exactly like an empty queue, which is how three waiting messages showed up
 * as "nothing waiting".
 */
export async function listPendingFeedings(): Promise<PendingFeeding[]> {
	if (!db) return [];
	const snapshot = await getDocs(
		query(collection(db, COLLECTION), where('processed', '==', false))
	);
	return snapshot.docs
		.map((d) => ({ id: d.id, ...(d.data() as Omit<PendingFeeding, 'id'>) }))
		.sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
}

/**
 * Writes the feeding logs this message implies, then marks it done.
 *
 * Each log keeps its provenance: who wrote the message, that it came from Slack, and
 * the message itself, so anything questionable can be traced back and the whole batch
 * can be found later.
 */
/** True when this dog already has a log for that meal, from anyone or anything. */
async function alreadyLogged(dogId: string, date: Date, mealTime: string): Promise<boolean> {
	if (!firestore) return false;
	// The whole subcollection, filtered here: pairing date with mealTime in the query
	// would need a composite index, and a dog's feeding history is small.
	const snapshot = await getDocs(collection(firestore, 'dogs', dogId, 'feedingLogs'));
	return snapshot.docs.some((d) => {
		const data = d.data();
		return data.mealTime === mealTime && isSameCalendarDay(data.date, date);
	});
}

export async function acceptPendingFeeding(
	pending: PendingFeeding,
	profile?: UserProfile | null
): Promise<number> {
	if (!db) return 0;
	const date = new Date(pending.postedAt);
	const notes = `via Slack — ${pending.author}: "${pending.rawText.slice(0, 180)}"`;

	let written = 0;
	for (const entry of pending.entries) {
		// An implied dog is one the message did not mention. If anything already stands
		// for that meal — a staff entry, or an earlier report of the same feed — it knows
		// more than an inference does, so leave it alone.
		if (entry.implied && (await alreadyLogged(entry.dogId, date, entry.mealTime))) continue;

		await addFeedingLog(
			entry.dogId,
			{ date, mealTime: entry.mealTime, amountEaten: entry.amountEaten, notes },
			profile,
			{
				id: feedingLogId(date, entry.dogId, entry.mealTime),
				loggedBy: 'slack-import',
				loggedByName: `${pending.author} (via Slack)`,
				extra: {
					source: 'slack',
					sourceTs: pending.slackTs,
					mealTimeInferred: entry.mealTimeInferred,
					impliedFromExceptions: entry.implied
				}
			}
		);
		written++;
	}

	await setDoc(doc(db, COLLECTION, pending.id), { processed: true }, { merge: true });
	return written;
}

/** Discard a message without writing anything. */
export async function dismissPendingFeeding(id: string): Promise<void> {
	if (!db) return;
	await deleteDoc(doc(db, COLLECTION, id));
}
