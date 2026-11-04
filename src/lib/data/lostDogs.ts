import { db } from '$lib/firebase/config';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';

/**
 * A lost-dog search (/lost). Everything here is in Firestore, never in the repo: it holds
 * a foster's home address, landowners' addresses and quotes from staff Slack, and the
 * repo is public. Positions are on the Cache County road grid ("2175 S 2000 W" → w 2000,
 * s 2175) because that is how every ping and sighting gets reported.
 */
export interface LostDogEvent {
	/** Display date, e.g. "10/31". */
	d: string;
	/** Display time, e.g. "~12:01 pm". */
	t: string;
	/** Hour of day in Mountain time, for the activity chart. Leave out when unknown. */
	h?: number;
	k: 'ping' | 'seen' | 'land';
	w: number;
	s: number;
	who: string;
	q: string;
	/** exact | approx | ok | nogo | area | context */
	c: string;
	/** Slack permalink. */
	link?: string;
	channel?: string;
	addr?: string;
	/** He had moved since the previous report. */
	mv?: boolean;
	/** Draw a "heading north" arrow. */
	arrow?: boolean;
	/** A searcher's position, not a sighting. */
	search?: boolean;
	/** Listed in the log but not drawn on the map. */
	hide?: boolean;
	/** [w1, s1, w2, s2] rectangle on the grid. */
	zone?: [number, number, number, number];
	/** zone style: 'area' (first search area) or 'field' (seen in this field). */
	zoneKind?: 'area' | 'field';
}

export interface LostDog {
	id: string;
	name: string;
	status: 'missing' | 'found';
	home?: { w: number; s: number; label: string; address: string };
	hotspot?: { w: number; s: number; rw: number; rs: number };
	summary?: { lastKnown?: string; hotspot?: string; mostActive?: string };
	/** Busiest window for the hour chart, [from, to] in hours. */
	activeWindow?: [number, number];
	events: LostDogEvent[];
	/** Undated saved pins from someone's map app, [w, s]. */
	pins?: [number, number][];
	updatedAt?: string;
}

const COLLECTION = 'lostDogs';

export function subscribeLostDogs(cb: (dogs: LostDog[]) => void, onError?: (e: Error) => void) {
	if (!db) {
		cb([]);
		return () => {};
	}
	return onSnapshot(
		collection(db, COLLECTION),
		(snap) => {
			const dogs = snap.docs.map((d) => ({ ...(d.data() as Omit<LostDog, 'id'>), id: d.id }));
			// Missing first, then most recently updated.
			dogs.sort(
				(a, b) =>
					Number(a.status !== 'missing') - Number(b.status !== 'missing') ||
					(b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
			);
			cb(dogs);
		},
		(e) => onError?.(e)
	);
}

/** Replace a search's whole record, e.g. from a pasted JSON export. */
export async function saveLostDog(dog: LostDog) {
	if (!db) throw new Error('Database not available');
	const { id, ...rest } = dog;
	// Firestore rejects undefined values; JSON round-trip drops them.
	const clean = JSON.parse(JSON.stringify(rest));
	await setDoc(doc(db, COLLECTION, id), { ...clean, updatedAt: new Date().toISOString() });
}

export async function setLostDogStatus(dog: LostDog, status: LostDog['status']) {
	await saveLostDog({ ...dog, status });
}

/** Validates pasted JSON into a LostDog, or throws with a message a person can act on. */
export function parseLostDogJson(text: string): LostDog {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error('That is not valid JSON.');
	}
	const d = raw as Partial<LostDog>;
	if (!d || typeof d !== 'object') throw new Error('Expected a JSON object.');
	if (!d.id || !/^[a-z0-9-]+$/.test(d.id)) throw new Error('Needs an "id" of lowercase letters, digits or dashes.');
	if (!d.name) throw new Error('Needs a "name".');
	if (!Array.isArray(d.events)) throw new Error('Needs an "events" list.');
	for (const [i, e] of d.events.entries()) {
		if (typeof e?.w !== 'number' || typeof e?.s !== 'number') throw new Error(`Event ${i + 1} needs numeric "w" and "s".`);
		if (!['ping', 'seen', 'land'].includes(e.k)) throw new Error(`Event ${i + 1} has an unknown kind "${e.k}".`);
	}
	return { status: 'missing', ...d } as LostDog;
}
