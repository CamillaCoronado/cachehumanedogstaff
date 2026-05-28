import type { PlaygroupOutcome, PlaygroupSession, UserProfile } from '$lib/types';
import { readJson, writeJson, createId } from '$lib/utils/storage';
import { toDate, toDateString } from '$lib/utils/dates';
import { db } from '$lib/firebase/config';
import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';

const PLAYGROUP_SESSIONS_KEY = 'shelter.playgroupSessions';

export interface PendingPlaygroup {
	id: string;
	rawText: string;
	dogNames: string[];
	suggestedNotes: string | null;
	suggestedOutcome: PlaygroupOutcome;
	receivedAt: string; // ISO string
	processed: boolean;
}

interface StoredPlaygroupSession {
	id: string;
	date: string;
	groupName: string;
	dogIds: string[];
	dogNames: string[];
	recommendationType: PlaygroupSession['recommendationType'];
	outcome: PlaygroupSession['outcome'];
	notes: string | null;
	durationMinutes: number | null;
	loggedBy: string;
	loggedByName: string;
	createdAt: string;
}

function serializeSession(session: PlaygroupSession): StoredPlaygroupSession {
	return {
		id: session.id,
		date: toDateString(session.date) ?? new Date().toISOString(),
		groupName: session.groupName,
		dogIds: session.dogIds,
		dogNames: session.dogNames,
		recommendationType: session.recommendationType,
		outcome: session.outcome,
		notes: session.notes,
		durationMinutes: session.durationMinutes,
		loggedBy: session.loggedBy,
		loggedByName: session.loggedByName,
		createdAt: toDateString(session.createdAt) ?? new Date().toISOString()
	};
}

function deserializeSession(session: StoredPlaygroupSession): PlaygroupSession {
	return {
		id: session.id,
		date: toDate(session.date) ?? new Date(),
		groupName: session.groupName,
		dogIds: session.dogIds ?? [],
		dogNames: session.dogNames ?? [],
		recommendationType: session.recommendationType ?? 'manual',
		outcome: session.outcome ?? 'mixed',
		notes: session.notes ?? null,
		durationMinutes: typeof session.durationMinutes === 'number' ? session.durationMinutes : null,
		loggedBy: session.loggedBy,
		loggedByName: session.loggedByName,
		createdAt: toDate(session.createdAt) ?? new Date()
	};
}

function getUserIdentity(profile?: UserProfile | null) {
	return {
		uid: profile?.uid ?? 'local-user',
		name: profile?.displayName ?? profile?.email ?? 'Local User'
	};
}

export async function listPlaygroupSessions() {
	if (db) {
		const snapshot = await getDocs(collection(db, 'playgroupSessions'));
		return snapshot.docs
			.map((docSnap) =>
				deserializeSession({ id: docSnap.id, ...(docSnap.data() as StoredPlaygroupSession) })
			)
			.sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0));
	}

	const stored = readJson<StoredPlaygroupSession[]>(PLAYGROUP_SESSIONS_KEY, []);
	return stored
		.map(deserializeSession)
		.sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0));
}

export async function listPendingPlaygroups(): Promise<PendingPlaygroup[]> {
	if (!db) return [];
	try {
		const q = query(
			collection(db, 'pendingPlaygroups'),
			where('processed', '==', false),
			orderBy('receivedAt', 'desc')
		);
		const snapshot = await getDocs(q);
		return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PendingPlaygroup, 'id'>) }));
	} catch {
		return [];
	}
}

export async function markPendingProcessed(id: string): Promise<void> {
	if (!db) return;
	await setDoc(doc(db, 'pendingPlaygroups', id), { processed: true }, { merge: true });
}

export async function addPlaygroupSession(
	session: Omit<PlaygroupSession, 'id' | 'loggedBy' | 'loggedByName' | 'createdAt'>,
	profile?: UserProfile | null
) {
	const identity = getUserIdentity(profile);
	const next: PlaygroupSession = {
		...session,
		id: createId('playgroup'),
		loggedBy: identity.uid,
		loggedByName: identity.name,
		createdAt: new Date()
	};

	if (db) {
		await setDoc(doc(collection(db, 'playgroupSessions'), next.id), serializeSession(next));
		return next;
	}

	const stored = readJson<StoredPlaygroupSession[]>(PLAYGROUP_SESSIONS_KEY, []);
	stored.unshift(serializeSession(next));
	writeJson(PLAYGROUP_SESSIONS_KEY, stored);
	return next;
}

export async function deletePlaygroupSession(id: string): Promise<void> {
	if (db) {
		await deleteDoc(doc(db, 'playgroupSessions', id));
		return;
	}

	const stored = readJson<StoredPlaygroupSession[]>(PLAYGROUP_SESSIONS_KEY, []);
	writeJson(PLAYGROUP_SESSIONS_KEY, stored.filter((s) => s.id !== id));
}

export async function updatePlaygroupSession(
	id: string,
	updates: Partial<Pick<PlaygroupSession, 'date' | 'groupName' | 'outcome' | 'notes' | 'durationMinutes' | 'dogIds' | 'dogNames'>>
) {
	const serialized: Partial<StoredPlaygroupSession> = {};
	if (updates.date !== undefined) serialized.date = toDateString(updates.date) ?? new Date().toISOString();
	if (updates.groupName !== undefined) serialized.groupName = updates.groupName;
	if (updates.outcome !== undefined) serialized.outcome = updates.outcome;
	if (updates.notes !== undefined) serialized.notes = updates.notes;
	if (updates.durationMinutes !== undefined) serialized.durationMinutes = updates.durationMinutes;
	if (updates.dogIds !== undefined) serialized.dogIds = updates.dogIds;
	if (updates.dogNames !== undefined) serialized.dogNames = updates.dogNames;

	if (db) {
		await updateDoc(doc(db, 'playgroupSessions', id), serialized);
		return;
	}

	const stored = readJson<StoredPlaygroupSession[]>(PLAYGROUP_SESSIONS_KEY, []);
	const idx = stored.findIndex((s) => s.id === id);
	if (idx !== -1) {
		stored[idx] = { ...stored[idx], ...serialized };
		writeJson(PLAYGROUP_SESSIONS_KEY, stored);
	}
}
