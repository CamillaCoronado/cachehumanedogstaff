import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import { newChannelMessages, resolveAuthors } from '$lib/server/slackClient';
import { parsePlaygroupMessage } from '$lib/utils/parsePlaygroupMessage';

/** Where the last-read message timestamp lives, so each run starts where the last stopped. */
const CURSOR_DOC = 'syncState/slackPlaygroupCursor';
/** A first run with no cursor takes this much history rather than the whole channel. */
const FIRST_RUN_DAYS = 2;

interface SlackMessage {
	ts: string;
	text?: string;
	user?: string;
	subtype?: string;
	bot_id?: string;
}

export interface PlaygroupPollResult {
	scanned: number;
	/** Queued to pendingPlaygroups for a dog editor to review on the Playgroups page. */
	queued: number;
	skipped?: string;
}

/**
 * Pulls new playgroup reports from Slack and queues them for review.
 *
 * Reads with the same bot token the feeding poll already uses, so there is nothing new to
 * create in Slack — just invite the existing bot to the playgroups channel and set
 * SLACK_PLAYGROUPS_CHANNEL_ID. Called both by the daily cron and by the ASM sync every user
 * triggers on load, same as feeding.
 */
export async function pollSlackPlaygroups(): Promise<PlaygroupPollResult> {
	const { SLACK_BOT_TOKEN, SLACK_PLAYGROUPS_CHANNEL_ID } = env;
	if (!SLACK_BOT_TOKEN || !SLACK_PLAYGROUPS_CHANNEL_ID) {
		return { scanned: 0, queued: 0, skipped: 'not configured' };
	}

	const db = getAdminDb();
	const cursorSnap = await db.doc(CURSOR_DOC).get();
	const lastTs: string | null = cursorSnap.exists ? (cursorSnap.data()?.ts ?? null) : null;
	// New messages and new thread replies since the cursor, newest first.
	const messages: SlackMessage[] = await newChannelMessages(SLACK_BOT_TOKEN, SLACK_PLAYGROUPS_CHANNEL_ID, lastTs, FIRST_RUN_DAYS);
	if (messages.length === 0) return { scanned: 0, queued: 0 };

	const dogsSnap = await db.collection('dogs').select('name').get();
	const knownDogNames = dogsSnap.docs
		.map((d) => (d.data().name as string | undefined) ?? '')
		.filter(Boolean);

	const authors = await resolveAuthors(SLACK_BOT_TOKEN, db, [
		...new Set(messages.map((m) => String(m.user ?? '')))
	]);

	let queued = 0;
	for (const m of messages) {
		const slackTs = String(m.ts);
		const rawText = String(m.text ?? '').trim();
		const parsed = parsePlaygroupMessage(rawText, knownDogNames);

		// Only queue if we parsed at least one dog name — most channel chatter isn't a report.
		if (parsed.dogNames.length === 0) continue;

		const author = authors[String(m.user ?? '')] ?? 'Unknown';

		// Keyed by message, so a re-poll of the same message updates rather than duplicates.
		await db.collection('pendingPlaygroups').doc(slackTs.replace('.', '-')).set({
			rawText,
			author,
			dogNames: parsed.dogNames,
			suggestedNotes: parsed.notes,
			suggestedOutcome: parsed.outcome,
			slackTs,
			receivedAt: new Date().toISOString(),
			processed: false
		});
		queued++;
	}

	// Advance past everything scanned, not just what queued — a message that named no dog
	// should not be looked at again on the next run.
	const newest = messages.reduce((max, m) => (Number(m.ts) > Number(max) ? String(m.ts) : max), lastTs ?? '0');
	await db.doc(CURSOR_DOC).set({ ts: newest, updatedAt: new Date().toISOString() });

	return { scanned: messages.length, queued };
}
