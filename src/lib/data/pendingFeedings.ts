import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { PendingFeeding, UserProfile } from '$lib/types';
import { db } from '$lib/firebase/config';
import { buildDogIndex, feedingLogId, planFeedings } from '$lib/data/feedingImport';
import { addFeedingLog, listDogs } from '$lib/data/dogs';
import { listDogGroups } from '$lib/data/dogGroups';
import { db as firestore } from '$lib/firebase/config';
import { isSameCalendarDay, toDate } from '$lib/utils/dates';

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

/**
 * Accepts a held report, re-reading the message rather than trusting what was stored.
 *
 * Entries are worked out when a message is queued, so anything that changes afterwards —
 * a rule, a nickname, a dog arriving — never reaches an item already sitting in the
 * queue. One approved after the fill-in was added wrote a single dog, because the
 * reading frozen into it predated the rule.
 */
export async function acceptPendingFeeding(
	pending: PendingFeeding,
	profile?: UserProfile | null
): Promise<number> {
	if (!db) return 0;
	const date = new Date(pending.postedAt);
	const notes = `via Slack — ${pending.author}: "${pending.rawText.slice(0, 180)}"`;

	const [dogs, groups] = await Promise.all([listDogs(), listDogGroups()]);
	const index = buildDogIndex(
		dogs.map((d) => ({
			id: d.id,
			name: d.name,
			intakeDate: toIso(d.intakeDate),
			leftShelterDate: toIso(d.leftShelterDate),
			status: d.status,
			asmShelterCode: d.asmShelterCode ?? null,
			inFoster: d.inFoster,
			permanentFoster: d.permanentFoster,
			inFosterSince: toIso(d.inFosterSince),
			shelterSince: toIso(d.shelterSince),
			isolationStatus: d.isolationStatus,
			isIncoming: d.isIncoming,
			nicknames: d.nicknames
		})),
		groups.map((g) => ({ name: g.name, dogIds: g.dogIds }))
	);
	const entries = planFeedings(pending.rawText, date, index);

	let written = 0;
	for (const entry of entries) {
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

/** feedingImport works in ISO strings; the app's dogs carry Date or Timestamp. */
function toIso(value: unknown): string | null {
	const date = toDate(value as never);
	return date ? date.toISOString() : null;
}

/** Discard a message without writing anything. */
export async function dismissPendingFeeding(id: string): Promise<void> {
	if (!db) return;
	await deleteDoc(doc(db, COLLECTION, id));
}
