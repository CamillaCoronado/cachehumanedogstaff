/**
 * Pulls Slack channel history to local JSON so it can be analyzed offline.
 *
 * Usage:
 *   node scripts/slack-fetch.mjs                 # every channel the bot is in
 *   node scripts/slack-fetch.mjs general feeding # only these channels (name or ID)
 *
 * Needs SLACK_BOT_TOKEN in .env with scopes:
 *   channels:history, channels:read, users:read   (public channels)
 *   groups:history,   groups:read                 (private channels, optional)
 *
 * Output lands in slack-export/ (gitignored) — one file per channel, plus users.json.
 * Re-running is safe: it resumes from the newest message already saved rather than
 * re-downloading the whole channel.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR = 'slack-export';
const PAGE_SIZE = 200;
// conversations.history is Slack tier 3: ~50 requests/minute. Stay under it.
const PAGE_DELAY_MS = 1300;

function loadEnv() {
	// Vite injects .env for the app, but a standalone script gets nothing.
	if (!existsSync('.env')) return;
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (!match) continue;
		const value = match[2].trim().replace(/^["']|["']$/g, '');
		if (!(match[1] in process.env)) process.env[match[1]] = value;
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function slack(token, method, params = {}) {
	const url = new URL(`https://slack.com/api/${method}`);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
	}

	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

		// Slack answers 429 with the seconds to wait; respect it rather than guessing.
		if (res.status === 429) {
			const wait = Number(res.headers.get('retry-after') ?? 30);
			console.log(`  rate limited, waiting ${wait}s`);
			await sleep((wait + 1) * 1000);
			continue;
		}

		const body = await res.json();
		if (body.ok) return body;

		// A channel the bot was never invited to is expected, not fatal — skip it.
		if (body.error === 'not_in_channel' || body.error === 'channel_not_found') return null;
		throw new Error(`${method}: ${body.error}${body.needed ? ` (needs scope: ${body.needed})` : ''}`);
	}
	throw new Error(`${method}: still rate limited after 5 attempts`);
}

/** Walks a cursor-paginated endpoint, collecting `key` from each page. */
async function paginate(token, method, params, key, stopAtTs = null) {
	const items = [];
	let cursor;
	do {
		const body = await slack(token, method, { ...params, limit: PAGE_SIZE, cursor });
		if (!body) return items;
		const page = body[key] ?? [];
		for (const item of page) {
			// Resuming: everything at or below the newest saved ts is already on disk.
			if (stopAtTs && Number(item.ts) <= Number(stopAtTs)) return items;
			items.push(item);
		}
		cursor = body.response_metadata?.next_cursor || undefined;
		if (cursor) {
			process.stdout.write(`\r  ${items.length} messages…`);
			await sleep(PAGE_DELAY_MS);
		}
	} while (cursor);
	return items;
}

function newestSavedTs(file) {
	if (!existsSync(file)) return null;
	try {
		const saved = JSON.parse(readFileSync(file, 'utf8'));
		return saved.messages?.[0]?.ts ?? null; // Slack returns newest-first
	} catch {
		return null;
	}
}

async function main() {
	loadEnv();
	const token = process.env.SLACK_BOT_TOKEN;
	if (!token) {
		console.error('Missing SLACK_BOT_TOKEN in .env — see the header of this file for scopes.');
		process.exit(1);
	}

	mkdirSync(OUT_DIR, { recursive: true });
	const wanted = process.argv.slice(2).map((a) => a.toLowerCase().replace(/^#/, ''));

	console.log('Fetching user directory…');
	const users = await paginate(token, 'users.list', {}, 'members');
	const userNames = Object.fromEntries(
		users.map((u) => [u.id, u.profile?.real_name || u.profile?.display_name || u.name || u.id])
	);
	writeFileSync(join(OUT_DIR, 'users.json'), JSON.stringify(userNames, null, 2));
	console.log(`  ${users.length} users\n`);

	const channels = await paginate(
		token,
		'conversations.list',
		{ types: 'public_channel,private_channel', exclude_archived: true },
		'channels'
	);

	const targets = wanted.length
		? channels.filter((c) => wanted.includes(c.name.toLowerCase()) || wanted.includes(c.id.toLowerCase()))
		: channels.filter((c) => c.is_member);

	if (!targets.length) {
		console.error(
			wanted.length
				? `No channel matched: ${wanted.join(', ')}\nAvailable: ${channels.map((c) => c.name).join(', ')}`
				: 'The bot is not a member of any channel. Invite it with /invite @yourbot first.'
		);
		process.exit(1);
	}

	for (const channel of targets) {
		const file = join(OUT_DIR, `${channel.name}.json`);
		const since = newestSavedTs(file);
		process.stdout.write(`#${channel.name}${since ? ' (resuming)' : ''}\n`);

		const fresh = await paginate(token, 'conversations.history', { channel: channel.id }, 'messages', since);

		// Threaded replies do not appear in history — fetch each thread separately.
		const parents = fresh.filter((m) => m.thread_ts && m.reply_count > 0);
		for (const parent of parents) {
			const replies = await paginate(token, 'conversations.replies', { channel: channel.id, ts: parent.thread_ts }, 'messages');
			parent.replies = replies.filter((r) => r.ts !== parent.ts);
			await sleep(PAGE_DELAY_MS);
		}

		const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).messages ?? [] : [];
		const messages = [...fresh, ...previous];
		writeFileSync(file, JSON.stringify({ channel: channel.name, id: channel.id, messages }, null, 2));
		console.log(`\r  ${fresh.length} new, ${messages.length} total${parents.length ? `, ${parents.length} threads` : ''}`);
		await sleep(PAGE_DELAY_MS);
	}

	console.log(`\nDone. Wrote ${readdirSync(OUT_DIR).length} files to ${OUT_DIR}/`);
}

main().catch((err) => {
	console.error(`\n${err.message}`);
	process.exit(1);
});
