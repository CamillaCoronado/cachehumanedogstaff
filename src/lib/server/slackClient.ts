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
