import { db } from '$lib/firebase/config';
import { doc, increment, onSnapshot, setDoc } from 'firebase/firestore';
import { readJson, writeJson } from '$lib/utils/storage';

const COLLECTION = 'eventCounters';

/** Tallies shared across devices on the Events tab. Each ID is one Firestore doc. */
export type CounterId = 'visitors' | 'poodles';

/** Shared event tally. `updatedAt` is an ISO timestamp of the last change. */
export interface VisitorCounter {
	count: number;
	updatedAt: string | null;
}

function localKey(counterId: CounterId) {
	// 'visitors' keeps its pre-refactor key so a local-dev tally isn't lost.
	return counterId === 'visitors' ? 'events_visitor_counter' : `events_counter_${counterId}`;
}

function toCounter(data: { count?: number; updatedAt?: string } | undefined): VisitorCounter {
	return {
		count: typeof data?.count === 'number' && data.count > 0 ? data.count : 0,
		updatedAt: data?.updatedAt ?? null
	};
}

/**
 * Live-subscribe to a shared counter so every device shows the same tally as
 * staff count people in. Returns an unsubscribe fn. Local writes echo back
 * instantly (Firestore latency compensation). Without Firebase (local dev),
 * delivers the locally stored count once.
 */
export function subscribeVisitorCounter(
	counterId: CounterId,
	callback: (counter: VisitorCounter) => void
): () => void {
	if (db) {
		return onSnapshot(
			doc(db, COLLECTION, counterId),
			(snap) => callback(toCounter(snap.exists() ? snap.data() : undefined)),
			(error) => console.error(`[events] counter '${counterId}' subscription failed:`, error)
		);
	}
	callback(readJson<VisitorCounter>(localKey(counterId), { count: 0, updatedAt: null }));
	return () => {};
}

/** Bump a shared counter by ±1. Atomic, so simultaneous taps on two devices both land. */
export async function adjustVisitorCounter(counterId: CounterId, delta: number): Promise<void> {
	const now = new Date().toISOString();
	if (db) {
		await setDoc(
			doc(db, COLLECTION, counterId),
			{ count: increment(delta), updatedAt: now },
			{ merge: true }
		);
		return;
	}
	const stored = readJson<VisitorCounter>(localKey(counterId), { count: 0, updatedAt: null });
	writeJson(localKey(counterId), { count: Math.max(0, stored.count + delta), updatedAt: now });
}

/** Reset a shared counter to zero (start of a new event). */
export async function resetVisitorCounter(counterId: CounterId): Promise<void> {
	const now = new Date().toISOString();
	if (db) {
		await setDoc(doc(db, COLLECTION, counterId), { count: 0, updatedAt: now });
		return;
	}
	writeJson(localKey(counterId), { count: 0, updatedAt: now });
}
