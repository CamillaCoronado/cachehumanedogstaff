/** Thin wrapper shared by every Slack poller — feeding, playgroups, whatever's next. */
export async function slack(token: string, method: string, params: Record<string, string>) {
	const url = new URL(`https://slack.com/api/${method}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	const body = await res.json();
	if (!body.ok) {
		const err = new Error(`slack ${method}: ${body.error}`) as Error & { retryAfter?: number };
		err.retryAfter = Number(res.headers?.get?.('retry-after')) || undefined;
		throw err;
	}
	return body;
}

const USERS_DOC = 'syncState/slackUserNames';

/**
 * Slack identifies authors by id. Names are cached because they rarely change and
 * users.list is rate-limited far more tightly than conversations.history. Shared across
 * every channel this workspace's bot token reads, since the id -> name mapping is
 * workspace-wide, not channel-specific.
 */
export async function resolveAuthors(
	token: string,
	db: FirebaseFirestore.Firestore,
	ids: string[]
) {
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

export interface HistoryMessage {
	ts: string;
	text?: string;
	user?: string;
	subtype?: string;
	bot_id?: string;
	/** Set on a thread's parent message: how many replies it has, and the newest one. */
	reply_count?: number;
	latest_reply?: string;
	thread_ts?: string;
}

/** Most threads read in one run, so a long range stays inside the time limit. */
const MAX_THREADS = 150;
/** Time a backfill may spend reading threads before it leaves the rest unread. */
const THREAD_BUDGET_MS = 25_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One thread's replies (not its parent), retrying once if Slack asks us to slow down. */
async function threadReplies(token: string, channel: string, ts: string): Promise<HistoryMessage[]> {
	const out: HistoryMessage[] = [];
	let cursor: string | undefined;
	do {
		let body;
		try {
			body = await slack(token, 'conversations.replies', { channel, ts, limit: '200', ...(cursor ? { cursor } : {}) });
		} catch (e) {
			if (!String(e).includes('ratelimited')) throw e;
			await sleep(Math.min(((e as { retryAfter?: number }).retryAfter ?? 3) * 1000, 10_000));
			body = await slack(token, 'conversations.replies', { channel, ts, limit: '200', ...(cursor ? { cursor } : {}) });
		}
		out.push(...((body.messages ?? []) as HistoryMessage[]).filter((m) => m.ts !== ts));
		cursor = body.response_metadata?.next_cursor || undefined;
	} while (cursor);
	return out;
}

/**
 * A channel's messages since `since`, paging through Slack's history up to `maxPages`
 * pages of 200. Slack returns newest first, so when the cap is hit (`truncated`) it is
 * the oldest messages in the range that were not read. Bot and system messages are
 * left out; only what people wrote comes back.
 */
export async function channelHistory(
	token: string,
	channel: string,
	since: Date,
	maxPages = 15,
	/** Also read replies inside threads — history only returns top-level messages. */
	includeReplies = false
): Promise<{ messages: HistoryMessage[]; truncated: boolean; threadsSkipped: number }> {
	const all: HistoryMessage[] = [];
	let cursor: string | undefined;
	let pages = 0;
	do {
		const body = await slack(token, 'conversations.history', {
			channel,
			oldest: String(Math.floor(since.getTime() / 1000)),
			limit: '200',
			...(cursor ? { cursor } : {})
		});
		all.push(...(body.messages ?? []));
		cursor = body.response_metadata?.next_cursor || undefined;
		pages++;
	} while (cursor && pages < maxPages);
	let threadsSkipped = 0;
	if (includeReplies) {
		// Newest threads first, so a cap drops the oldest ones.
		const threads = all.filter((m) => (m.reply_count ?? 0) > 0).slice(0, MAX_THREADS);
		threadsSkipped = Math.max(0, all.filter((m) => (m.reply_count ?? 0) > 0).length - threads.length);
		// Slack rate-limits thread reads. When it keeps saying slow down, or time runs
		// short, the older threads are left unread and counted, rather than failing the run.
		const deadline = Date.now() + THREAD_BUDGET_MS;
		for (let i = 0; i < threads.length; i++) {
			if (Date.now() > deadline) {
				threadsSkipped += threads.length - i;
				break;
			}
			try {
				all.push(...(await threadReplies(token, channel, threads[i].ts)));
			} catch (e) {
				if (!String(e).includes('ratelimited')) throw e;
				threadsSkipped += threads.length - i;
				break;
			}
		}
	}
	const seen = new Set<string>();
	const messages = all.filter((m) => {
		// A reply also sent to the channel shows up in both places; keep it once.
		if (seen.has(m.ts)) return false;
		seen.add(m.ts);
		return m.subtype === undefined && m.bot_id === undefined && String(m.text ?? '').trim();
	});
	return { messages, truncated: Boolean(cursor), threadsSkipped };
}

/** How far back the live polls look for threads that may have picked up new replies. */
const THREAD_LOOKBACK_DAYS = 3;
/** Most threads a live poll re-reads in one go. */
const MAX_LIVE_THREADS = 50;

const isFromPerson = (m: HistoryMessage) =>
	m.subtype === undefined && m.bot_id === undefined && Boolean(String(m.text ?? '').trim());

/**
 * What the live polls read each run: everything posted after `lastTs` — new messages,
 * and new replies inside threads, newest first (the order history returns).
 *
 * History alone returns only top-level messages, and only ones newer than the cursor,
 * so a reply added to an older thread was never seen. Threads from the last few days
 * are checked for replies newer than the cursor, which is where those land.
 */
export async function newChannelMessages(
	token: string,
	channel: string,
	lastTs: string | null,
	firstRunDays: number
): Promise<HistoryMessage[]> {
	const now = Date.now() / 1000;
	const floor = Number(lastTs ?? now - firstRunDays * 86_400);
	const lookback = Math.min(floor, now - THREAD_LOOKBACK_DAYS * 86_400);

	const all: HistoryMessage[] = [];
	let cursor: string | undefined;
	let pages = 0;
	do {
		const body = await slack(token, 'conversations.history', {
			channel,
			oldest: String(lookback),
			limit: '200',
			...(cursor ? { cursor } : {})
		});
		all.push(...((body.messages ?? []) as HistoryMessage[]));
		cursor = body.response_metadata?.next_cursor || undefined;
		pages++;
	} while (cursor && pages < 5);

	const fresh: HistoryMessage[] = all.filter((m) => Number(m.ts) > floor);
	const threads = all
		.filter((m) => (m.reply_count ?? 0) > 0 && Number(m.latest_reply ?? 0) > floor)
		.slice(0, MAX_LIVE_THREADS);
	for (const parent of threads) {
		fresh.push(...(await threadReplies(token, channel, parent.ts)).filter((r) => Number(r.ts) > floor));
	}

	const seen = new Set<string>();
	return fresh
		.filter((m) => {
			if (seen.has(m.ts)) return false;
			seen.add(m.ts);
			return isFromPerson(m);
		})
		.sort((a, b) => Number(b.ts) - Number(a.ts));
}
