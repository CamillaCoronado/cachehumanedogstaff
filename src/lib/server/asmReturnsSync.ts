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
 * is read once per intake; the rest of a backlog is picked up on the next syncs, or all
 * at once by the Admin page's backfill. Runs after the animal sync, which keeps
 * intakeDate current.
 */
export async function syncReturnsFromASM(
	opts: { limit?: number; budgetMs?: number; neverRead?: boolean } = {}
): Promise<{ read: number; failed: number; left: number; failures: { name: string; error: string }[] }> {
	const stopAt = Date.now() + (opts.budgetMs ?? Infinity);
	const db = getAdminDb();
	const snapshot = await db.collection('dogs').get();
	const docs = new Map(snapshot.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
	const due = dogsNeedingReturns(docs, { neverRead: opts.neverRead });
	const today = shelterToday();
	const batch = due.slice(0, opts.limit ?? PER_SYNC);
	let read = 0;
	let failed = 0;
	const failures: { name: string; error: string }[] = [];
	for (let i = 0; i < batch.length && Date.now() < stopAt; i += AT_ONCE) {
		await Promise.all(
			batch.slice(i, i + AT_ONCE).map(async ({ id, asmId, intake }) => {
				let rows: Record<string, unknown>[];
				try {
					rows = await loadAsmMovements(asmId);
				} catch (e) {
					// One dog ASM won't show (deleted, no rights) mustn't stop the rest; it's
					// tried again next time.
					console.error(`[asm returns] dog ${id}`, e);
					failed++;
					failures.push({
						name: `${String(docs.get(id)?.name ?? id)} (ASM ${asmId})`,
						error: e instanceof Error ? e.message : String(e)
					});
					return;
				}
				const returns = parseAsmReturns(rows, today);
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
		read += Math.min(AT_ONCE, batch.length - i);
	}
	read -= failed;
	return { read, failed, left: due.length - read, failures };
}
