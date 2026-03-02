import type { PlaygroupSession, UserProfile } from '$lib/types';
import { readJson, writeJson, createId } from '$lib/utils/storage';
import { toDate, toDateString } from '$lib/utils/dates';
import { db } from '$lib/firebase/config';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';

const PLAYGROUP_SESSIONS_KEY = 'shelter.playgroupSessions';

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
