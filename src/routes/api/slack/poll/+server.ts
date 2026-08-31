import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import { buildDogIndex, planFeedings, type DogRecord } from '$lib/data/feedingImport';

/**
 * Pulls new feeding reports from Slack and queues them for admin approval.
 *
 * Polling rather than a webhook: reading uses the bot token the app already has, so
 * there is no public endpoint for anyone to post to, no signing secret, and nothing to
 * configure in Slack. These are approved in batches anyway, so arriving within the hour
 * is as good as arriving instantly.
 */

/** Where the last-read message timestamp lives, so each run starts where the last stopped. */
const CURSOR_DOC = 'syncState/slackFeedingCursor';
const USERS_DOC = 'syncState/slackUserNames';
/** A first run with no cursor takes this much history rather than the whole channel. */
const FIRST_RUN_DAYS = 2;
const MAX_MESSAGES = 200;

interface SlackMessage {
	ts: string;
	text?: string;
	user?: string;
	subtype?: string;
	bot_id?: string;
}

async function slack(token: string, method: string, params: Record<string, string>) {
	const url = new URL(`https://slack.com/api/${method}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	const body = await res.json();
	if (!body.ok) throw new Error(`slack ${method}: ${body.error}`);
	return body;
}

/**
 * Slack identifies authors by id. Names are cached because they rarely change and
 * users.list is rate-limited far more tightly than conversations.history.
 */
async function resolveAuthors(token: string, db: FirebaseFirestore.Firestore, ids: string[]) {
	const ref = db.doc(USERS_DOC);
	const snap = await ref.get();
	const cached: Record<string, string> = snap.exists ? (snap.data()?.names ?? {}) : {};
	if (ids.every((id) => id in cached)) return cached;

	try {
		const body = await slack(token, 'users.list', { limit: '500' });
		for (const u of body.members ?? []) {
			cached[u.id] = u.profile?.real_name || u.profile?.display_name || u.name || u.id;
		}
		await ref.set({ names: cached, updatedAt: new Date().toISOString() });
	} catch {
		// Keep whatever is cached; an unresolved id is better than dropping the message.
	}
	return cached;
}

export async function GET({ request }: RequestEvent) {
	const { SLACK_BOT_TOKEN, SLACK_FEEDING_CHANNEL_ID, CRON_SECRET } = env;

	// Vercel sends the cron secret as a bearer token. Without it configured the route
	// stays closed rather than open — this queues data, so it should not be callable.
	if (!CRON_SECRET) throw error(503, 'CRON_SECRET not configured');
	if (request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) throw error(401, 'Unauthorized');

	if (!SLACK_BOT_TOKEN || !SLACK_FEEDING_CHANNEL_ID) {
		throw error(503, 'Slack polling not configured');
	}

	const db = getAdminDb();
	const cursorSnap = await db.doc(CURSOR_DOC).get();
	const lastTs: string | null = cursorSnap.exists ? (cursorSnap.data()?.ts ?? null) : null;
	const oldest = lastTs ?? String(Math.floor((Date.now() - FIRST_RUN_DAYS * 86_400_000) / 1000));

	const history = await slack(SLACK_BOT_TOKEN, 'conversations.history', {
		channel: SLACK_FEEDING_CHANNEL_ID,
		oldest,
		limit: String(MAX_MESSAGES)
	});

	// Slack returns newest first; oldest is inclusive, so drop the cursor message itself.
	const messages: SlackMessage[] = (history.messages ?? []).filter(
		(m: SlackMessage) =>
			m.subtype === undefined && m.bot_id === undefined && String(m.text ?? '').trim() && m.ts !== lastTs
	);

	if (messages.length === 0) return json({ polled: true, queued: 0, scanned: 0 });

	const dogsSnap = await db
		.collection('dogs')
		.select('name', 'intakeDate', 'leftShelterDate', 'status', 'asmShelterCode')
		.get();
	const index = buildDogIndex(
		dogsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DogRecord, 'id'>) }))
	);

	const authors = await resolveAuthors(SLACK_BOT_TOKEN, db, [
		...new Set(messages.map((m) => String(m.user ?? '')))
	]);

	let queued = 0;
	for (const m of messages) {
		const slackTs = String(m.ts);
		const postedAt = new Date(Number(slackTs) * 1000);
		const entries = planFeedings(String(m.text), postedAt, index);
		if (entries.length === 0) continue; // nothing about a specific dog eating

		// Keyed by message, so a re-poll of the same message updates rather than duplicates.
		await db.collection('pendingFeedings').doc(slackTs.replace('.', '-')).set({
			rawText: String(m.text),
			author: authors[String(m.user ?? '')] ?? 'Unknown',
			slackTs,
			postedAt: postedAt.toISOString(),
			receivedAt: new Date().toISOString(),
			processed: false,
			entries
		});
		queued++;
	}

	// Advance past everything scanned, not just what queued — a message that said nothing
	// about feeding should not be looked at again on the next run.
	const newest = messages.reduce(
		(max, m) => (Number(m.ts) > Number(max) ? String(m.ts) : max),
		lastTs ?? '0'
	);
	await db.doc(CURSOR_DOC).set({ ts: newest, updatedAt: new Date().toISOString() });

	return json({ polled: true, scanned: messages.length, queued });
}
