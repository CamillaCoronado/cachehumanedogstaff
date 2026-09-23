import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import { parsePlaygroupMessage } from '$lib/utils/parsePlaygroupMessage';
import { slack, type SlackMessage } from '$lib/server/slackFeedingPoll';

/** Where the last-read message timestamp lives, so each run starts where the last stopped. */
const CURSOR_DOC = 'syncState/slackPlaygroupCursor';
/** A first run with no cursor takes this much history rather than the whole channel. */
const FIRST_RUN_DAYS = 2;
const MAX_MESSAGES = 200;

export interface PlaygroupPollResult {
	scanned: number;
	queued: number;
	skipped?: string;
}

/**
 * Pulls new messages from the playgroups channel and queues the ones naming dogs for
 * review on the Playgroups page.
 *
 * Same bot and same schedule as the feeding poll, so there is nothing to set up in
 * Slack beyond adding the bot to the channel. This used to arrive by Slack pushing
 * events to the app, which needed its own subscription and signing secret.
 */
export async function pollSlackPlaygroups(): Promise<PlaygroupPollResult> {
	const { SLACK_BOT_TOKEN, SLACK_PLAYGROUPS_CHANNEL_ID } = env;
	if (!SLACK_BOT_TOKEN || !SLACK_PLAYGROUPS_CHANNEL_ID) {
		return { scanned: 0, queued: 0, skipped: 'not configured' };
	}

	const db = getAdminDb();
	const cursorSnap = await db.doc(CURSOR_DOC).get();
	const lastTs: string | null = cursorSnap.exists ? (cursorSnap.data()?.ts ?? null) : null;
	const oldest = lastTs ?? String(Math.floor((Date.now() - FIRST_RUN_DAYS * 86_400_000) / 1000));

	const history = await slack(SLACK_BOT_TOKEN, 'conversations.history', {
		channel: SLACK_PLAYGROUPS_CHANNEL_ID,
		oldest,
		limit: String(MAX_MESSAGES)
	});

	// Slack returns newest first; oldest is inclusive, so drop the cursor message itself.
	const messages: SlackMessage[] = (history.messages ?? []).filter(
		(m: SlackMessage) =>
			m.subtype === undefined && m.bot_id === undefined && String(m.text ?? '').trim() && m.ts !== lastTs
	);
	if (messages.length === 0) return { scanned: 0, queued: 0 };

	const dogsSnap = await db.collection('dogs').select('name').get();
	const knownDogNames = dogsSnap.docs
		.map((d) => (d.data().name as string | undefined) ?? '')
		.filter(Boolean);

	let queued = 0;
	for (const m of messages) {
		const rawText = String(m.text).trim();
		const parsed = parsePlaygroupMessage(rawText, knownDogNames);
		if (parsed.dogNames.length === 0) continue;

		// Keyed by message, and created rather than set, so a re-poll neither duplicates
		// it nor reopens one someone already reviewed.
		const key = `${SLACK_PLAYGROUPS_CHANNEL_ID}-${m.ts}`.replace(/[./]/g, '-');
		try {
			await db.collection('pendingPlaygroups').doc(key).create({
				rawText,
				dogNames: parsed.dogNames,
				suggestedNotes: parsed.notes,
				suggestedOutcome: parsed.outcome,
				slackTs: String(m.ts),
				receivedAt: new Date().toISOString(),
				processed: false
			});
			queued++;
		} catch (e) {
			if ((e as { code?: number }).code !== 6) throw e; // 6: already stored
		}
	}

	const newest = messages.reduce((max, m) => (Number(m.ts) > Number(max) ? String(m.ts) : max), lastTs ?? '0');
	await db.doc(CURSOR_DOC).set({ ts: newest, updatedAt: new Date().toISOString() });

	return { scanned: messages.length, queued };
}
