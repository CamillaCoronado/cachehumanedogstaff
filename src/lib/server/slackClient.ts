/** Thin wrapper shared by every Slack poller — feeding, playgroups, whatever's next. */
export async function slack(token: string, method: string, params: Record<string, string>) {
	const url = new URL(`https://slack.com/api/${method}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	const body = await res.json();
	if (!body.ok) throw new Error(`slack ${method}: ${body.error}`);
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
	maxPages = 15
): Promise<{ messages: HistoryMessage[]; truncated: boolean }> {
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
	const messages = all.filter(
		(m) => m.subtype === undefined && m.bot_id === undefined && String(m.text ?? '').trim()
	);
	return { messages, truncated: Boolean(cursor) };
}
