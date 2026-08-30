import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import type { AsmAnimal, SyncEnvironment } from '$lib/data/asm-sync';

/** Cross-sync bookkeeping lives here, one document per key. */
const STATE_COLLECTION = 'syncState';

function asmBase() {
	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;
	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) return null;
	return `${ASM_URL}/asmservice?account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`;
}

/**
 * Server-side plumbing for the sync. firebase-admin bypasses the security rules, which
 * is what lets any signed-in user trigger a reconcile without being able to write dog
 * documents themselves.
 */
export function createAdminSyncEnvironment(): SyncEnvironment {
	const db = getAdminDb();

	return {
		async listDogs() {
			const snapshot = await db.collection('dogs').get();
			return new Map(snapshot.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
		},

		async commit(writes) {
			if (writes.length === 0) return;
			const batch = db.batch();
			for (const { id, data } of writes) {
				batch.set(db.collection('dogs').doc(id), data, { merge: true });
			}
			await batch.commit();
		},

		async fetchAnimals() {
			const base = asmBase();
			if (!base) return null; // not configured — same silent skip as before
			try {
				const res = await fetch(`${base}&method=json_shelter_animals&sensitive=1`);
				if (!res.ok) return null;
				const body = await res.json();
				return Array.isArray(body) ? (body as AsmAnimal[]) : null;
			} catch {
				return null; // ASM unreachable
			}
		},

		async fetchRecentAdoptions(days) {
			const base = asmBase();
			if (!base) return [];
			const res = await fetch(`${base}&method=json_recent_adoptions`);
			if (!res.ok) return [];
			const body = await res.json();
			if (!Array.isArray(body)) return [];

			const cutoff = Date.now() - days * 86_400_000;
			return body
				.map((a: Record<string, unknown>) => ({
					id: String(a.ID ?? a.ANIMALID ?? ''),
					shelterCode: String(a.SHELTERCODE ?? ''),
					adoptedAt: String(a.MOVEMENTDATE ?? a.ADOPTEDDATE ?? '')
				}))
				.filter((a) => {
					if (!a.id) return false;
					if (!a.adoptedAt) return true; // keep undated rather than silently dropping
					const at = new Date(a.adoptedAt).getTime();
					return !Number.isFinite(at) || at >= cutoff;
				});
		},

		async readState<T>(key: string, fallback: T): Promise<T> {
			const snap = await db.collection(STATE_COLLECTION).doc(key).get();
			const value = snap.exists ? (snap.data()?.value as T | undefined) : undefined;
			return value ?? fallback;
		},

		async writeState(key, value) {
			await db.collection(STATE_COLLECTION).doc(key).set({ value, updatedAt: new Date().toISOString() });
		}
	};
}
