import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import { slack, resolveAuthors } from '$lib/server/slackClient';
import { parsePlaygroupMessage } from '$lib/utils/parsePlaygroupMessage';

const PAGE_SIZE = 200;
/** Stops a very long range from running past the function's time limit (3,000 messages). */
const MAX_PAGES = 15;

interface SlackMessage {
	ts: string;
	text?: string;
	user?: string;
	subtype?: string;
	bot_id?: string;
}

export interface PlaygroupBackfillSample {
	slackTs: string;
	dogNames: string[];
	outcome: string;
	text: string;
}

export interface PlaygroupBackfillResult {
	scanned: number;
	/** Messages naming dogs that are not yet in the review list. */
	toQueue: number;
	/** Messages naming dogs already in the review list, reviewed or not — left alone. */
	alreadyQueued: number;
	/** Written this run; always 0 on a dry run. */
	queued: number;
	/**
	 * True when the range held more than MAX_PAGES of history. Slack returns newest first,
	 * so it is the oldest messages in the range that went unread.
	 */
	truncated: boolean;
	samples: PlaygroupBackfillSample[];
	skipped?: string;
}

/**
 * Reads the playgroups channel from `since` and queues reports naming dogs for review, the
 * same way the live poll does. The live poll starts two days back and takes at most 200
 * messages a run, so it cannot reach older playgroups on its own.
 *
 * Entries use the live poll's key and are only created where nothing exists, so anything
 * already queued or already reviewed is left as it is. With dryRun nothing is written.
 */
export async function backfillSlackPlaygroups(
	since: Date,
	dryRun: boolean,
	/**
	 * What the admin kept after the dry run: which messages to add, and the dog names to
	 * keep on each. Messages left out are skipped. Names can only be removed here, never
	 * added — anything not in the parser's own reading is ignored.
	 */
	picks?: { slackTs: string; dogNames: string[] }[]
): Promise<PlaygroupBackfillResult> {
	const empty = { scanned: 0, toQueue: 0, alreadyQueued: 0, queued: 0, truncated: false, samples: [] };
	const { SLACK_BOT_TOKEN, SLACK_PLAYGROUPS_CHANNEL_ID } = env;
	if (!SLACK_BOT_TOKEN || !SLACK_PLAYGROUPS_CHANNEL_ID) return { ...empty, skipped: 'not configured' };

	const db = getAdminDb();
	const messages: SlackMessage[] = [];
	let cursor: string | undefined;
	let pages = 0;
	do {
		const body = await slack(SLACK_BOT_TOKEN, 'conversations.history', {
			channel: SLACK_PLAYGROUPS_CHANNEL_ID,
			oldest: String(Math.floor(since.getTime() / 1000)),
			limit: String(PAGE_SIZE),
			...(cursor ? { cursor } : {})
		});
		messages.push(...(body.messages ?? []));
		cursor = body.response_metadata?.next_cursor || undefined;
		pages++;
	} while (cursor && pages < MAX_PAGES);
	const truncated = Boolean(cursor);

	const reports = messages.filter(
		(m) => m.subtype === undefined && m.bot_id === undefined && String(m.text ?? '').trim()
	);
	if (reports.length === 0) return { ...empty, truncated };

	const [dogsSnap, existingSnap] = await Promise.all([
		db.collection('dogs').select('name').get(),
		db.collection('pendingPlaygroups').select().get()
	]);
	const knownDogNames = dogsSnap.docs.map((d) => (d.data().name as string | undefined) ?? '').filter(Boolean);
	const existing = new Set(existingSnap.docs.map((d) => d.id));

	const planned: { id: string; slackTs: string; user: string; rawText: string; parsed: ReturnType<typeof parsePlaygroupMessage> }[] = [];
	let alreadyQueued = 0;
	for (const m of reports) {
		const rawText = String(m.text).trim();
		const parsed = parsePlaygroupMessage(rawText, knownDogNames);
		if (parsed.dogNames.length === 0) continue; // chatter, not a report
		const id = String(m.ts).replace('.', '-'); // the live poll's key
		if (existing.has(id)) {
			alreadyQueued++;
			continue;
		}
		planned.push({ id, slackTs: String(m.ts), user: String(m.user ?? ''), rawText, parsed });
	}
	// Oldest first, so the review list and the preview read in the order things happened.
	planned.sort((a, b) => Number(a.slackTs) - Number(b.slackTs));

	const samples = planned.map((p) => ({
		slackTs: p.slackTs,
		dogNames: p.parsed.dogNames,
		outcome: p.parsed.outcome,
		text: p.rawText.slice(0, 160)
	}));
	const result = { scanned: reports.length, toQueue: planned.length, alreadyQueued, queued: 0, truncated, samples };
	if (dryRun || planned.length === 0) return result;

	let toWrite = planned;
	if (picks) {
		const kept = new Map(picks.map((p) => [p.slackTs, new Set(p.dogNames.map((n) => n.toLowerCase()))]));
		toWrite = planned
			.filter((p) => kept.has(p.slackTs))
			.map((p) => {
				const keep = kept.get(p.slackTs)!;
				const dogNames = p.parsed.dogNames.filter((n: string) => keep.has(n.toLowerCase()));
				return { ...p, parsed: { ...p.parsed, dogNames } };
			})
			.filter((p) => p.parsed.dogNames.length > 0);
	}
	if (toWrite.length === 0) return result;

	const authors = await resolveAuthors(SLACK_BOT_TOKEN, db, [...new Set(toWrite.map((p) => p.user))]);
	const now = new Date().toISOString();
	for (let i = 0; i < toWrite.length; i += 400) {
		const batch = db.batch();
		for (const p of toWrite.slice(i, i + 400)) {
			// create, not set: never overwrite an entry that appeared since the check above.
			batch.create(db.collection('pendingPlaygroups').doc(p.id), {
				rawText: p.rawText,
				author: authors[p.user] ?? 'Unknown',
				dogNames: p.parsed.dogNames,
				suggestedNotes: p.parsed.notes,
				suggestedOutcome: p.parsed.outcome,
				slackTs: p.slackTs,
				receivedAt: now,
				processed: false,
				source: 'backfill'
			});
		}
		await batch.commit();
	}
	return { ...result, queued: toWrite.length };
}
