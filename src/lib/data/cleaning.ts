import { db } from '$lib/firebase/config';
import { arrayRemove, arrayUnion, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { readJson, writeJson } from '$lib/utils/storage';

const LOCAL_KEY = 'shelter.cleaningCompletions.v1';

export type CleaningShift = 'morning' | 'evening';

function docId(date: string, shift: CleaningShift) {
	return `${date}-${shift}`;
}

/** Load the set of completed task IDs for a given date + shift. */
export async function loadCompletedTasks(date: string, shift: CleaningShift): Promise<Set<string>> {
	if (db) {
		const snap = await getDoc(doc(db, 'cleaningCompletions', docId(date, shift)));
		if (!snap.exists()) return new Set();
		return new Set((snap.data().completedTaskIds ?? []) as string[]);
	}
	const stored = readJson<Record<string, { completedTaskIds?: string[] }>>(LOCAL_KEY, {});
	return new Set(stored[docId(date, shift)]?.completedTaskIds ?? []);
}

/**
 * Live-subscribe to the completed task IDs for a date + shift, so every device
 * sees checkmarks appear as coworkers toggle them. Returns an unsubscribe fn.
 * Local writes echo back instantly (Firestore latency compensation), so the
 * caller can rely on the subscription alone for state. Without Firebase
 * (local dev), delivers the stored set once.
 */
export function subscribeCompletedTasks(
	date: string,
	shift: CleaningShift,
	callback: (completed: Set<string>) => void
): () => void {
	if (db) {
		return onSnapshot(
			doc(db, 'cleaningCompletions', docId(date, shift)),
			(snap) => {
				callback(new Set(snap.exists() ? ((snap.data().completedTaskIds ?? []) as string[]) : []));
			},
			(error) => console.error('[cleaning] completions subscription failed:', error)
		);
	}
	void loadCompletedTasks(date, shift).then(callback);
	return () => {};
}

/** Toggle a single task. Optimistic-update friendly — call fire-and-forget from the UI. */
export async function toggleCleaningTask(
	date: string,
	shift: CleaningShift,
	taskId: string,
	checked: boolean
): Promise<void> {
	if (db) {
		const ref = doc(db, 'cleaningCompletions', docId(date, shift));
		await setDoc(
			ref,
			{
				id: docId(date, shift),
				date,
				shift,
				completedTaskIds: checked ? arrayUnion(taskId) : arrayRemove(taskId),
				lastUpdated: new Date().toISOString()
			},
			{ merge: true }
		);
		return;
	}
	// localStorage fallback (local dev without Firebase)
	const stored = readJson<Record<string, { id: string; date: string; shift: string; completedTaskIds: string[]; lastUpdated: string }>>(LOCAL_KEY, {});
	const key = docId(date, shift);
	const current = stored[key] ?? { id: key, date, shift, completedTaskIds: [], lastUpdated: '' };
	const set = new Set(current.completedTaskIds);
	if (checked) set.add(taskId);
	else set.delete(taskId);
	stored[key] = { ...current, completedTaskIds: Array.from(set), lastUpdated: new Date().toISOString() };
	writeJson(LOCAL_KEY, stored);
}
