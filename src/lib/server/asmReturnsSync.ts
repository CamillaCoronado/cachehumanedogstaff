import { getAdminDb } from '$lib/firebase/admin';
import { loadAsmMovements } from '$lib/server/asmAnimals';
import { dogsNeedingReturns, parseAsmReturns } from '$lib/utils/asmReturns';
import { shelterToday } from '$lib/utils/medicalSync';

/** Dogs read per sync (5 at a time), so a first run over a backlog fits in the sync's minute. */
const PER_SYNC = 15;
const AT_ONCE = 5;

/**
 * Every returned dog's return history from its ASM movements: dates, what it came back
 * from, ASM's return category and reason. The dates become the dog's re-entries. A dog
 * is read once per intake; the rest of a backlog is picked up on the next syncs. Runs
 * after the animal sync, which keeps intakeDate current.
 */
export async function syncReturnsFromASM(): Promise<{ read: number; left: number }> {
	const db = getAdminDb();
	const snapshot = await db.collection('dogs').get();
	const docs = new Map(snapshot.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
	const due = dogsNeedingReturns(docs);
	const today = shelterToday();
	const batch = due.slice(0, PER_SYNC);
	for (let i = 0; i < batch.length; i += AT_ONCE) {
		await Promise.all(
			batch.slice(i, i + AT_ONCE).map(async ({ id, asmId, intake }) => {
				const returns = parseAsmReturns(await loadAsmMovements(asmId), today);
				await db.collection('dogs').doc(id).set(
					{
						returnHistory: returns,
						reentryDates: [...new Set(returns.map((r) => r.returnedAt))],
						returnHistoryFor: intake,
						updatedAt: new Date().toISOString()
					},
					{ merge: true }
				);
			})
		);
	}
	const read = batch.length;
	return { read, left: due.length - read };
}
