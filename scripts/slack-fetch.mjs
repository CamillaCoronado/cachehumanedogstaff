/**
 * Pulls Slack channel history to local JSON so it can be analyzed offline.
 *
 * Usage:
 *   node scripts/slack-fetch.mjs dog-staff --since 2026-01-01
 *   node scripts/slack-fetch.mjs                 # every channel the bot is in, all history
 *
 * Needs SLACK_BOT_TOKEN in .env with scopes:
 *   channels:history, channels:read, users:read   (public channels)
 *   groups:history,   groups:read                 (private channels, optional)
 *
 * Output lands in slack-export/ (gitignored) — one file per channel, plus users.json.
 * The channel file is rewritten as it goes, so killing a long pull keeps what it had.
 * Re-running resumes from the newest message already saved.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR = 'slack-export';
const PAGE_SIZE = 200;
// conversations.history/replies are Slack tier 3: ~50 requests/minute. Stay under it.
const PAGE_DELAY_MS = 1300;
// Thread fetching is one request per thread, so a busy channel spends most of its
// time here. Checkpoint often enough that an interrupt costs little.
const CHECKPOINT_EVERY = 10;

const argv = process.argv.slice(2);
function flag(name) {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? null : argv[i + 1];
}
// Channel names are the positional args — everything that isn't a flag or its value.
const flagIndices = new Set();
for (const [i, a] of argv.entries()) if (a.startsWith('--')) { flagIndices.add(i); flagIndices.add(i + 1); }
const wanted = argv.filter((_, i) => !flagIndices.has(i)).map((a) => a.toLowerCase().replace(/^#/, ''));

const sinceArg = flag('since');
const sinceTs = sinceArg ? Math.floor(new Date(`${sinceArg}T00:00:00`).getTime() / 1000) : null;
if (sinceArg && !Number.isFinite(sinceTs)) {
	console.error(`Bad --since "${sinceArg}" — use YYYY-MM-DD.`);
	process.exit(1);
}

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
async function paginate(token, method, params, key, stopAtTs = null, label = null) {
	const items = [];
	let cursor;
	do {
		const body = await slack(token, method, { ...params, limit: PAGE_SIZE, cursor });
		if (!body) return items;
		for (const item of body[key] ?? []) {
			// Resuming: everything at or below the newest saved ts is already on disk.
			if (stopAtTs && Number(item.ts) <= Number(stopAtTs)) return items;
			items.push(item);
		}
		cursor = body.response_metadata?.next_cursor || undefined;
		if (cursor) {
			// One line per page, not \r — stdout is block-buffered when piped to a log,
			// so carriage-return progress never appears until the process exits.
			if (label) console.log(`  ${label}: ${items.length} so far…`);
			await sleep(PAGE_DELAY_MS);
		}
	} while (cursor);
	return items;
}

const channelFile = (name) => join(OUT_DIR, `${name}.json`);

function readSaved(name) {
	const file = channelFile(name);
	if (!existsSync(file)) return { messages: [] };
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return { messages: [] };
	}
}

function writeChannel(channel, messages) {
	writeFileSync(
		channelFile(channel.name),
		JSON.stringify({ channel: channel.name, id: channel.id, messages }, null, 2)
	);
}

async function main() {
	loadEnv();
	const token = process.env.SLACK_BOT_TOKEN;
	if (!token) {
		console.error('Missing SLACK_BOT_TOKEN in .env — see the header of this file for scopes.');
		process.exit(1);
	}

	mkdirSync(OUT_DIR, { recursive: true });
	if (sinceArg) console.log(`Window: ${sinceArg} → now\n`);

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
		const previous = readSaved(channel.name).messages ?? [];
		const resumeFrom = previous[0]?.ts ?? null; // Slack returns newest-first
		console.log(`#${channel.name}${resumeFrom ? ' (resuming)' : ''}`);

		const fresh = await paginate(
			token,
			'conversations.history',
			{ channel: channel.id, oldest: sinceTs ?? undefined },
			'messages',
			resumeFrom,
			'messages'
		);

		// Save before threads: history is the bulk of the value, and thread fetching is
		// the slow part most likely to be interrupted.
		let messages = [...fresh, ...previous];
		writeChannel(channel, messages);
		console.log(`  ${fresh.length} new messages (${messages.length} total) — saved`);

		// Threaded replies do not appear in history — fetch each thread separately.
		const parents = fresh.filter((m) => m.thread_ts && m.reply_count > 0);
		if (parents.length) {
			const mins = Math.ceil((parents.length * PAGE_DELAY_MS) / 60000);
			console.log(`  ${parents.length} threads to fetch (~${mins} min)`);
		}
		for (const [i, parent] of parents.entries()) {
			const replies = await paginate(token, 'conversations.replies', { channel: channel.id, ts: parent.thread_ts }, 'messages');
			parent.replies = replies.filter((r) => r.ts !== parent.ts);
			if ((i + 1) % CHECKPOINT_EVERY === 0) {
				writeChannel(channel, messages);
				console.log(`  threads ${i + 1}/${parents.length}`);
			}
			await sleep(PAGE_DELAY_MS);
		}

		writeChannel(channel, messages);
		console.log(`  done: ${messages.length} messages, ${parents.length} threads\n`);
		await sleep(PAGE_DELAY_MS);
	}

	console.log(`Wrote ${readdirSync(OUT_DIR).length} files to ${OUT_DIR}/`);
}

main().catch((err) => {
	console.error(`\n${err.message}`);
	process.exit(1);
});
