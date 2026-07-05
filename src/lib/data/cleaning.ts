import { db } from '$lib/firebase/config';
import { arrayRemove, arrayUnion, deleteField, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { readJson, writeJson } from '$lib/utils/storage';

const LOCAL_KEY = 'shelter.cleaningCompletions.v1';

export type CleaningShift = 'morning' | 'evening';

/** Who checked a task, and when (ISO timestamp). */
export interface TaskCompletionMeta {
	by: string | null;
	at: string;
}

export interface CleaningCompletions {
	ids: Set<string>;
	meta: Record<string, TaskCompletionMeta>;
}

interface StoredCompletions {
	id: string;
	date: string;
	shift: string;
	completedTaskIds: string[];
	taskMeta?: Record<string, TaskCompletionMeta>;
	lastUpdated: string;
}

function docId(date: string, shift: CleaningShift) {
	return `${date}-${shift}`;
}

function toCompletions(data: { completedTaskIds?: string[]; taskMeta?: Record<string, TaskCompletionMeta> } | undefined): CleaningCompletions {
	return {
		ids: new Set(data?.completedTaskIds ?? []),
		meta: data?.taskMeta ?? {}
	};
}

/** Load the completions (IDs + who/when) for a given date + shift. */
export async function loadCompletedTasks(date: string, shift: CleaningShift): Promise<CleaningCompletions> {
	if (db) {
		const snap = await getDoc(doc(db, 'cleaningCompletions', docId(date, shift)));
		return toCompletions(snap.exists() ? snap.data() : undefined);
	}
	const stored = readJson<Record<string, StoredCompletions>>(LOCAL_KEY, {});
	return toCompletions(stored[docId(date, shift)]);
}

/**
 * Live-subscribe to the completions for a date + shift, so every device sees
 * checkmarks (and who made them) as coworkers toggle tasks. Returns an
 * unsubscribe fn. Local writes echo back instantly (Firestore latency
 * compensation), so the caller can rely on the subscription alone for state.
 * Without Firebase (local dev), delivers the stored state once.
 */
export function subscribeCompletedTasks(
	date: string,
	shift: CleaningShift,
	callback: (completions: CleaningCompletions) => void
): () => void {
	if (db) {
		return onSnapshot(
			doc(db, 'cleaningCompletions', docId(date, shift)),
			(snap) => callback(toCompletions(snap.exists() ? snap.data() : undefined)),
			(error) => console.error('[cleaning] completions subscription failed:', error)
		);
	}
	void loadCompletedTasks(date, shift).then(callback);
	return () => {};
}

/** Toggle a single task, recording who did it. Optimistic-update friendly — call fire-and-forget from the UI. */
export async function toggleCleaningTask(
	date: string,
	shift: CleaningShift,
	taskId: string,
	checked: boolean,
	byName: string | null = null
): Promise<void> {
	const now = new Date().toISOString();
	if (db) {
		const ref = doc(db, 'cleaningCompletions', docId(date, shift));
		await setDoc(
			ref,
			{
				id: docId(date, shift),
				date,
				shift,
				completedTaskIds: checked ? arrayUnion(taskId) : arrayRemove(taskId),
				taskMeta: { [taskId]: checked ? { by: byName, at: now } : deleteField() },
				lastUpdated: now
			},
			{ merge: true }
		);
		return;
	}
	// localStorage fallback (local dev without Firebase)
	const stored = readJson<Record<string, StoredCompletions>>(LOCAL_KEY, {});
	const key = docId(date, shift);
	const current = stored[key] ?? { id: key, date, shift, completedTaskIds: [], taskMeta: {}, lastUpdated: '' };
	const set = new Set(current.completedTaskIds);
	const meta = { ...(current.taskMeta ?? {}) };
	if (checked) {
		set.add(taskId);
		meta[taskId] = { by: byName, at: now };
	} else {
		set.delete(taskId);
		delete meta[taskId];
	}
	stored[key] = { ...current, completedTaskIds: Array.from(set), taskMeta: meta, lastUpdated: now };
	writeJson(LOCAL_KEY, stored);
}
