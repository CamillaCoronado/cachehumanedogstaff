import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { SyncChange } from '$lib/data/asm-sync';
import type { DateValue } from '$lib/types';
import { db } from '$lib/firebase/config';
import { toDate } from '$lib/utils/dates';

export type SyncEventType = 'adoption' | 'foster' | 'transfer' | 'incoming';

/**
 * The order celebrations play in, so a sync's four events always queue the same way
 * instead of however Firestore happened to return them — they share a timestamp, so
 * without this the sequence is arbitrary.
 */
export const SYNC_EVENT_ORDER: SyncEventType[] = ['adoption', 'foster', 'incoming', 'transfer'];

export interface SyncEvent {
	id: string;
	type: SyncEventType;
	dogIds: string[];
	dogNames: string[];
	createdAt: Date;
}

/**
 * How far back a look can reach. Bounds the unseen-event query as the collection
 * grows, and is also where an account with no stamp starts from.
 */
const LOOKBACK_DAYS = 14;

/** Mirrors the overlay grouping: one event per type per sync, listing every dog in it. */
const TYPE_FILTERS: Record<SyncEventType, (change: SyncChange) => boolean> = {
	adoption: (c) => c.isArchived,
	foster: (c) => c.fields.some((f) => f === 'Foster (yes)'),
	transfer: (c) => c.isTransferredOut,
	incoming: (c) => c.isNew
};

/** djb2 — short, stable, and enough to keep one day's event IDs apart. */
function hash(input: string): string {
	let h = 5381;
	for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

/**
 * Deterministic so two admins syncing at once converge on one document instead of
 * writing the same celebration twice. Bucketed by day because a dog can legitimately
 * leave, return, and leave again — just not twice in the same day.
 */
function eventId(type: SyncEventType, dogIds: string[], when: Date): string {
	const day = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}`;
	return `${type}-${day}-${hash([...dogIds].sort().join(','))}`;
}

function eventsRef() {
	return db ? collection(db, 'syncEvents') : null;
}

/**
 * Records what a sync observed so every user sees it, not just the browser that
 * happened to run the sync. The sync reconciles Firestore with ASM, so the diff
 * exists exactly once — without this it is consumed by whoever loads the app first.
 */
export async function recordSyncEvents(changes: SyncChange[]): Promise<void> {
	const ref = eventsRef();
	if (!ref || changes.length === 0) return;

	const now = new Date();
	const writes: Promise<void>[] = [];

	for (const [type, matches] of Object.entries(TYPE_FILTERS) as [SyncEventType, (c: SyncChange) => boolean][]) {
		const hits = changes.filter(matches);
		if (hits.length === 0) continue;
		const dogIds = hits.map((c) => c.id);
		const id = eventId(type, dogIds, now);
		writes.push(
			setDoc(doc(ref, id), {
				type,
				dogIds,
				dogNames: hits.map((c) => c.name),
				createdAt: now.toISOString()
			})
		);
	}

	await Promise.all(writes);
}

/**
 * Events created after `since`, oldest first so the queue plays in the order things
 * actually happened, and never reaching further back than the lookback window.
 *
 * An account with no stamp starts from the window too, so a first login lands on
 * roughly what the browser would have had locally rather than the whole archive.
 */
export async function listUnseenSyncEvents(since: DateValue | null | undefined): Promise<SyncEvent[]> {
	const ref = eventsRef();
	if (!ref) return [];

	const window = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
	const seenAt = toDate(since ?? null);
	const cutoff = seenAt && seenAt > window ? seenAt : window;

	const snapshot = await getDocs(query(ref, where('createdAt', '>', cutoff.toISOString())));
	return snapshot.docs
		.map((d) => {
			const data = d.data();
			return {
				id: d.id,
				type: data.type as SyncEventType,
				dogIds: (data.dogIds ?? []) as string[],
				dogNames: (data.dogNames ?? []) as string[],
				createdAt: new Date(data.createdAt as string)
			};
		})
		.filter((e) => e.dogIds.length > 0)
		.sort(
			(a, b) =>
				a.createdAt.getTime() - b.createdAt.getTime() ||
				SYNC_EVENT_ORDER.indexOf(a.type) - SYNC_EVENT_ORDER.indexOf(b.type)
		);
}
