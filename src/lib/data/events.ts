import { db } from '$lib/firebase/config';
import {
	addDoc,
	collection,
	doc,
	getDoc,
	increment,
	limit,
	onSnapshot,
	orderBy,
	query,
	setDoc
} from 'firebase/firestore';
import { readJson, writeJson, createId } from '$lib/utils/storage';

const COLLECTION = 'eventCounters';
const HISTORY_COLLECTION = 'eventHistory';
const META_ID = 'meta';
const LOCAL_META_KEY = 'events_meta';
const LOCAL_HISTORY_KEY = 'events_history';

/** Tallies shared across devices on the Events tab. Each ID is one Firestore doc. */
export type CounterId = 'visitors' | 'poodles';

/** Every tally that gets archived when an event is marked over. */
export const COUNTER_IDS: CounterId[] = ['visitors', 'poodles'];

/** The event currently being counted (doc `eventCounters/meta`). */
export interface EventMeta {
	name: string;
	startedAt: string | null;
}

/** A finished event archived in `eventHistory`. */
export interface PastEvent {
	id: string;
	name: string;
	startedAt: string | null;
	endedAt: string;
	counts: Record<CounterId, number>;
}

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

function toMeta(data: { name?: string; startedAt?: string } | undefined): EventMeta {
	return {
		name: typeof data?.name === 'string' ? data.name : '',
		startedAt: data?.startedAt ?? null
	};
}

function defaultEventName(endedAtIso: string): string {
	const date = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date(endedAtIso));
	return `Event — ${date}`;
}

/** Live-subscribe to the current event's name/start time. Returns an unsubscribe fn. */
export function subscribeEventMeta(callback: (meta: EventMeta) => void): () => void {
	if (db) {
		return onSnapshot(
			doc(db, COLLECTION, META_ID),
			(snap) => callback(toMeta(snap.exists() ? snap.data() : undefined)),
			(error) => console.error('[events] event meta subscription failed:', error)
		);
	}
	callback(readJson<EventMeta>(LOCAL_META_KEY, { name: '', startedAt: null }));
	return () => {};
}

/** Name (or rename) the current event. Stamps startedAt the first time a name is set. */
export async function setEventName(name: string): Promise<void> {
	const trimmed = name.trim();
	const now = new Date().toISOString();
	if (db) {
		const ref = doc(db, COLLECTION, META_ID);
		const snap = await getDoc(ref);
		const existing = toMeta(snap.exists() ? snap.data() : undefined);
		await setDoc(ref, { name: trimmed, startedAt: existing.startedAt ?? now }, { merge: true });
		return;
	}
	const existing = readJson<EventMeta>(LOCAL_META_KEY, { name: '', startedAt: null });
	writeJson(LOCAL_META_KEY, { name: trimmed, startedAt: existing.startedAt ?? now });
}

/**
 * Mark the current event over: archive its name and final tallies to the
 * history, then zero the counters and clear the name, ready for the next
 * event. Returns the archived record.
 */
export async function endCurrentEvent(): Promise<PastEvent> {
	const now = new Date().toISOString();
	if (db) {
		const database = db;
		const [metaSnap, ...counterSnaps] = await Promise.all([
			getDoc(doc(database, COLLECTION, META_ID)),
			...COUNTER_IDS.map((id) => getDoc(doc(database, COLLECTION, id)))
		]);
		const meta = toMeta(metaSnap.exists() ? metaSnap.data() : undefined);
		const counts = {} as Record<CounterId, number>;
		COUNTER_IDS.forEach((id, i) => {
			const snap = counterSnaps[i];
			counts[id] = toCounter(snap.exists() ? snap.data() : undefined).count;
		});
		const record = {
			name: meta.name || defaultEventName(now),
			startedAt: meta.startedAt,
			endedAt: now,
			counts
		};
		const created = await addDoc(collection(database, HISTORY_COLLECTION), record);
		await Promise.all([
			setDoc(doc(database, COLLECTION, META_ID), { name: '', startedAt: null }),
			...COUNTER_IDS.map((id) => setDoc(doc(database, COLLECTION, id), { count: 0, updatedAt: now }))
		]);
		return { id: created.id, ...record };
	}
	const meta = readJson<EventMeta>(LOCAL_META_KEY, { name: '', startedAt: null });
	const counts = {} as Record<CounterId, number>;
	for (const id of COUNTER_IDS) {
		counts[id] = readJson<VisitorCounter>(localKey(id), { count: 0, updatedAt: null }).count;
	}
	const archived: PastEvent = {
		id: createId('event'),
		name: meta.name || defaultEventName(now),
		startedAt: meta.startedAt,
		endedAt: now,
		counts
	};
	const history = readJson<PastEvent[]>(LOCAL_HISTORY_KEY, []);
	writeJson(LOCAL_HISTORY_KEY, [archived, ...history]);
	writeJson(LOCAL_META_KEY, { name: '', startedAt: null });
	for (const id of COUNTER_IDS) {
		writeJson(localKey(id), { count: 0, updatedAt: now });
	}
	return archived;
}

/** Live-subscribe to past events, newest first. Returns an unsubscribe fn. */
export function subscribeEventHistory(callback: (events: PastEvent[]) => void): () => void {
	if (db) {
		const historyQuery = query(
			collection(db, HISTORY_COLLECTION),
			orderBy('endedAt', 'desc'),
			limit(50)
		);
		return onSnapshot(
			historyQuery,
			(snap) =>
				callback(
					snap.docs.map((d) => {
						const data = d.data();
						const counts = {} as Record<CounterId, number>;
						for (const id of COUNTER_IDS) {
							const value = (data.counts as Record<string, unknown> | undefined)?.[id];
							counts[id] = typeof value === 'number' ? value : 0;
						}
						return {
							id: d.id,
							name: typeof data.name === 'string' ? data.name : defaultEventName(data.endedAt ?? ''),
							startedAt: data.startedAt ?? null,
							endedAt: data.endedAt ?? '',
							counts
						};
					})
				),
			(error) => console.error('[events] history subscription failed:', error)
		);
	}
	callback(readJson<PastEvent[]>(LOCAL_HISTORY_KEY, []));
	return () => {};
}
