import { db } from '$lib/firebase/config';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { readJson, writeJson } from '$lib/utils/storage';
import type { CleaningShift } from '$lib/data/cleaning';

const LOCAL_KEY = 'shelter.shiftHandoffs.v1';

/** A note one shift leaves for the next (blockers, unfinished work, FYIs). */
export interface ShiftHandoff {
	note: string;
	updatedBy: string | null;
	updatedAt: string;
}

function docId(date: string, shift: CleaningShift) {
	return `${date}-${shift}`;
}

function toHandoff(data: Partial<ShiftHandoff> | undefined): ShiftHandoff | null {
	if (!data || !data.note?.trim()) return null;
	return { note: data.note, updatedBy: data.updatedBy ?? null, updatedAt: data.updatedAt ?? '' };
}

/**
 * Live-subscribe to the handoff note written by a given date + shift.
 * Returns an unsubscribe fn. Without Firebase (local dev), delivers the
 * stored note once.
 */
export function subscribeHandoff(
	date: string,
	shift: CleaningShift,
	callback: (handoff: ShiftHandoff | null) => void
): () => void {
	if (db) {
		return onSnapshot(
			doc(db, 'shiftHandoffs', docId(date, shift)),
			(snap) => callback(toHandoff(snap.exists() ? (snap.data() as Partial<ShiftHandoff>) : undefined)),
			(error) => console.error('[handoff] subscription failed:', error)
		);
	}
	const stored = readJson<Record<string, ShiftHandoff>>(LOCAL_KEY, {});
	callback(toHandoff(stored[docId(date, shift)]));
	return () => {};
}

/** Save the handoff note for a date + shift (empty string clears it). */
export async function saveHandoff(
	date: string,
	shift: CleaningShift,
	note: string,
	byName: string | null
): Promise<void> {
	const record: ShiftHandoff = { note: note.trim(), updatedBy: byName, updatedAt: new Date().toISOString() };
	if (db) {
		await setDoc(doc(db, 'shiftHandoffs', docId(date, shift)), { id: docId(date, shift), date, shift, ...record }, { merge: true });
		return;
	}
	const stored = readJson<Record<string, ShiftHandoff>>(LOCAL_KEY, {});
	stored[docId(date, shift)] = record;
	writeJson(LOCAL_KEY, stored);
}
