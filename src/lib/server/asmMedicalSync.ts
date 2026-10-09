import { randomUUID } from 'node:crypto';
import { getAdminDb } from '$lib/firebase/admin';
import { loadAsmMedical } from '$lib/server/asmAnimals';
import { planMedicalSync, shelterToday } from '$lib/utils/medicalSync';

/**
 * Brings every active dog's Medical page in line with ASM's medical book. Runs after the
 * animal sync, so a neuter date ASM just recorded is already on the dog. If ASM's
 * website can't be read, or reads as empty, nothing is written: a shelter always has some
 * medical records, so empty means a failed read, and no surgery is dropped for want of
 * data. Says what it did, for the sync badge to show an admin.
 */
export type MedicalSyncResult =
	| { status: 'ok'; changed: number; regimens: number }
	| { status: 'empty' }
	| { status: 'failed'; error: string };

export async function syncMedicalFromASM(): Promise<MedicalSyncResult> {
	const asm = await loadAsmMedical();
	if (asm.regimens.length === 0 && asm.given.length === 0) {
		console.warn('[asm medical] medical book read as empty — skipped');
		return { status: 'empty' };
	}
	const db = getAdminDb();
	const snapshot = await db.collection('dogs').get();
	const docs = new Map(snapshot.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
	const writes = planMedicalSync(docs, asm, shelterToday(), () => randomUUID());
	for (let i = 0; i < writes.length; i += 450) {
		const batch = db.batch();
		for (const { id, data } of writes.slice(i, i + 450)) {
			batch.set(db.collection('dogs').doc(id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
		}
		await batch.commit();
	}
	return { status: 'ok', changed: writes.length, regimens: asm.regimens.length };
}
