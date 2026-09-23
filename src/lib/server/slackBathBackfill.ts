import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import { channelHistory, resolveAuthors } from '$lib/server/slackClient';
import { bathLogId, buildDogIndex, planBaths, type DogRecord } from '$lib/data/feedingImport';

/** Stops a very long range from running past the function's time limit (3,000 messages). */
const MAX_PAGES = 15;

export interface BathBackfillRow {
	/** `${slackTs}|${dogId}` — what the admin ticks to keep. */
	key: string;
	dogId: string;
	dogName: string;
	/** When the bath was given (a "yesterday" report is dated back). */
	at: string;
	author: string;
	text: string;
}

export interface BathBackfillResult {
	scanned: number;
	/** Baths found that are not logged yet. */
	rows: BathBackfillRow[];
	/** Baths found that are already logged — left alone. */
	alreadyLogged: number;
	/** Written this run; always 0 on a dry run. */
	written: number;
	/** The range held more than MAX_PAGES of history; its oldest messages went unread. */
	truncated: boolean;
	/** Threads not read because the run hit its cap — the oldest ones. */
	threadsSkipped: number;
	skipped?: string;
}

/**
 * Reads past bath reports from #dog-staff and logs them, the same way the live poll
 * logs a bath: the same parser, the same log id, and lastBathDate only ever moves
 * forward. With dryRun nothing is written. `keep` limits a real run to the rows the
 * admin left ticked.
 */
export async function backfillSlackBaths(since: Date, dryRun: boolean, keep?: string[]): Promise<BathBackfillResult> {
	const empty = { scanned: 0, rows: [], alreadyLogged: 0, written: 0, truncated: false, threadsSkipped: 0 };
	const { SLACK_BOT_TOKEN, SLACK_FEEDING_CHANNEL_ID } = env;
	if (!SLACK_BOT_TOKEN || !SLACK_FEEDING_CHANNEL_ID) return { ...empty, skipped: 'not configured' };

	const db = getAdminDb();
	// Replies too: baths are often reported inside a thread, which history alone skips.
	const { messages, truncated, threadsSkipped } = await channelHistory(SLACK_BOT_TOKEN, SLACK_FEEDING_CHANNEL_ID, since, MAX_PAGES, true);
	if (messages.length === 0) return { ...empty, truncated, threadsSkipped };

	const [dogsSnap, groupsSnap] = await Promise.all([db.collection('dogs').get(), db.collection('dogGroups').get()]);
	const index = buildDogIndex(
		dogsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DogRecord, 'id'>) })),
		groupsSnap.docs.map((d) => ({ name: d.data().name, dogIds: d.data().dogIds ?? [] }))
	);
	const authors = await resolveAuthors(SLACK_BOT_TOKEN, db, [...new Set(messages.map((m) => String(m.user ?? '')))]);

	// Every bath the messages report, oldest first; one per dog per day, as the log id is.
	const found: (BathBackfillRow & { logId: string; ts: string })[] = [];
	const seenLog = new Set<string>();
	for (const m of [...messages].sort((a, b) => Number(a.ts) - Number(b.ts))) {
		const postedAt = new Date(Number(m.ts) * 1000);
		for (const bath of planBaths(String(m.text), postedAt, index)) {
			const logId = bathLogId(bath.at, bath.dogId);
			if (seenLog.has(`${bath.dogId}/${logId}`)) continue;
			seenLog.add(`${bath.dogId}/${logId}`);
			found.push({
				key: `${m.ts}|${bath.dogId}`,
				dogId: bath.dogId,
				dogName: bath.dogName,
				at: bath.at.toISOString(),
				author: authors[String(m.user ?? '')] ?? 'Unknown',
				text: String(m.text).slice(0, 160),
				logId,
				ts: String(m.ts)
			});
		}
	}

	// Leave alone anything already logged, by the live poll or an earlier run.
	const dogIds = [...new Set(found.map((f) => f.dogId))];
	const existing = new Set<string>();
	for (let i = 0; i < dogIds.length; i += 20) {
		const snaps = await Promise.all(dogIds.slice(i, i + 20).map((id) => db.collection('dogs').doc(id).collection('bathLogs').get()));
		snaps.forEach((snap, j) => snap.docs.forEach((d) => existing.add(`${dogIds[i + j]}/${d.id}`)));
	}
	const fresh = found.filter((f) => !existing.has(`${f.dogId}/${f.logId}`));
	const rows = fresh.map(({ logId: _l, ts: _t, ...row }) => row);
	const result = { scanned: messages.length, rows, alreadyLogged: found.length - fresh.length, written: 0, truncated, threadsSkipped };
	if (dryRun) return result;

	const kept = keep ? new Set(keep) : null;
	const toWrite = fresh.filter((f) => !kept || kept.has(f.key));
	if (toWrite.length === 0) return result;

	// The newest bath per dog decides lastBathDate, which only ever moves forward.
	const newest = new Map<string, { at: string; by: string }>();
	for (const f of toWrite) {
		const prev = newest.get(f.dogId);
		if (!prev || prev.at < f.at) newest.set(f.dogId, { at: f.at, by: `${f.author} (via Slack)` });
	}
	for (let i = 0; i < toWrite.length; i += 400) {
		const batch = db.batch();
		for (const f of toWrite.slice(i, i + 400)) {
			batch.set(db.collection('dogs').doc(f.dogId).collection('bathLogs').doc(f.logId), {
				id: f.logId,
				timestamp: f.at,
				loggedBy: 'slack-import',
				loggedByName: `${f.author} (via Slack)`,
				source: 'slack',
				sourceTs: f.ts
			});
		}
		await batch.commit();
	}
	const dogDocs = await Promise.all([...newest.keys()].map((id) => db.collection('dogs').doc(id).get()));
	const batch = db.batch();
	for (const snap of dogDocs) {
		const next = newest.get(snap.id)!;
		const current = snap.data()?.lastBathDate;
		if (!current || new Date(current).getTime() < new Date(next.at).getTime()) {
			batch.set(snap.ref, { lastBathDate: next.at, lastBathBy: next.by }, { merge: true });
		}
	}
	await batch.commit();
	return { ...result, written: toWrite.length };
}
