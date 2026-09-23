/**
 * Backfills playgroup reports from the Slack playgroups channel into the review list on
 * the Playgroups page — the same queue the live poll fills, just reaching further back.
 *
 * Usage:
 *   node scripts/playgroup-backfill.mjs                          # preview, writes nothing
 *   node scripts/playgroup-backfill.mjs --write                  # queue them for review
 *   node scripts/playgroup-backfill.mjs --since 2026-03-01       # start date (default)
 *   node scripts/playgroup-backfill.mjs --undo --write           # remove what this queued
 *
 * Needs SLACK_BOT_TOKEN, SLACK_PLAYGROUPS_CHANNEL_ID and the Firebase Admin credentials in
 * .env. Reads Slack directly, paging through the whole range — the live poll takes at most
 * 200 messages a run, which is why it cannot reach this far back on its own.
 *
 * Every entry is keyed by its Slack timestamp, exactly as the live poll keys it, and is
 * only created where nothing exists yet. So a message the poll already queued, or one
 * somebody already reviewed, is left as it is rather than duplicated or reopened.
 * Top-level channel messages only, like the live poll; thread replies are not read.
 */
import { readFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build } from 'esbuild';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const WRITE = has('write');
const UNDO = has('undo');
const SHOW = Number(flag('show', 15));
const SINCE_ARG = flag('since', '2026-03-01');
// Midnight at the shelter (Mountain time), whatever machine runs this.
const SINCE = Math.floor(new Date(`${SINCE_ARG}T00:00:00-07:00`).getTime() / 1000);
if (!Number.isFinite(SINCE)) {
	console.error(`Bad --since "${SINCE_ARG}" — use YYYY-MM-DD.`);
	process.exit(1);
}

const PAGE_SIZE = 200;
// conversations.history is Slack tier 3: ~50 requests/minute. Stay under it.
const PAGE_DELAY_MS = 1300;

function loadEnv() {
	if (!existsSync('.env')) return;
	for (const m of readFileSync('.env', 'utf8').matchAll(/^([A-Z0-9_]+)=(?:"([\s\S]*?)"|(.*))$/gm)) {
		if (!(m[1] in process.env)) process.env[m[1]] = (m[2] ?? m[3]).trim();
	}
}

function db() {
	initializeApp({
		credential: cert({
			projectId: process.env.PUBLIC_FIREBASE_PROJECT_ID ?? 'cachehumane-dogmanagement',
			clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
			privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n')
		})
	});
	return getFirestore();
}

/** The app's own parser, bundled rather than reimplemented, so the two cannot disagree. */
async function loadParser() {
	const out = join(mkdtempSync(join(tmpdir(), 'playgroup-')), 'parse.mjs');
	await build({
		entryPoints: ['src/lib/utils/parsePlaygroupMessage.ts'],
		outfile: out,
		bundle: true,
		format: 'esm',
		platform: 'node',
		logLevel: 'error',
		alias: { $lib: new URL('../src/lib', import.meta.url).pathname }
	});
	return import(out);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function slack(token, method, params = {}) {
	const url = new URL(`https://slack.com/api/${method}`);
	for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
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
		throw new Error(`${method}: ${body.error}${body.needed ? ` (needs scope: ${body.needed})` : ''}`);
	}
	throw new Error(`${method}: still rate limited after 5 tries`);
}

async function fetchHistory(token, channel) {
	const messages = [];
	let cursor;
	do {
		const body = await slack(token, 'conversations.history', {
			channel,
			oldest: SINCE,
			limit: PAGE_SIZE,
			cursor
		});
		messages.push(...(body.messages ?? []));
		cursor = body.response_metadata?.next_cursor || undefined;
		process.stdout.write(`\r  read ${messages.length} messages`);
		if (cursor) await sleep(PAGE_DELAY_MS);
	} while (cursor);
	process.stdout.write('\n');
	return messages
		.filter((m) => m.subtype === undefined && m.bot_id === undefined && String(m.text ?? '').trim())
		.sort((a, b) => Number(a.ts) - Number(b.ts));
}

async function authorNames(token) {
	try {
		const body = await slack(token, 'users.list', { limit: 500 });
		return Object.fromEntries(
			(body.members ?? []).map((u) => [u.id, u.profile?.real_name || u.profile?.display_name || u.name || u.id])
		);
	} catch {
		return {}; // an unresolved author is better than not backfilling at all
	}
}

async function undo(store) {
	// Only entries still waiting for review. One already approved is a logged session
	// now, and removing its queue entry would undo nothing.
	const snap = await store
		.collection('pendingPlaygroups')
		.where('source', '==', 'backfill')
		.get();
	const waiting = snap.docs.filter((d) => d.data().processed === false);
	console.log(`Found ${snap.size} backfilled, ${waiting.length} still waiting for review.`);
	if (!WRITE) return console.log('Preview only — re-run with --undo --write to remove those.');
	for (let i = 0; i < waiting.length; i += 400) {
		const batch = store.batch();
		for (const d of waiting.slice(i, i + 400)) batch.delete(d.ref);
		await batch.commit();
	}
	console.log(`Removed ${waiting.length}.`);
}

async function main() {
	loadEnv();
	const { SLACK_BOT_TOKEN, SLACK_PLAYGROUPS_CHANNEL_ID } = process.env;
	if (!SLACK_BOT_TOKEN || !SLACK_PLAYGROUPS_CHANNEL_ID) {
		console.error('Needs SLACK_BOT_TOKEN and SLACK_PLAYGROUPS_CHANNEL_ID in .env.');
		process.exit(1);
	}
	const store = db();
	if (UNDO) return undo(store);

	const { parsePlaygroupMessage } = await loadParser();

	console.log(`Reading the playgroups channel since ${SINCE_ARG}…`);
	const messages = await fetchHistory(SLACK_BOT_TOKEN, SLACK_PLAYGROUPS_CHANNEL_ID);
	const [dogsSnap, existingSnap, authors] = await Promise.all([
		store.collection('dogs').select('name').get(),
		store.collection('pendingPlaygroups').select().get(),
		authorNames(SLACK_BOT_TOKEN)
	]);
	const knownDogNames = dogsSnap.docs.map((d) => d.data().name ?? '').filter(Boolean);
	const existing = new Set(existingSnap.docs.map((d) => d.id));

	const planned = [];
	let alreadyQueued = 0;
	for (const m of messages) {
		const rawText = String(m.text).trim();
		const parsed = parsePlaygroupMessage(rawText, knownDogNames);
		if (parsed.dogNames.length === 0) continue; // chatter, not a report
		const id = String(m.ts).replace('.', '-'); // same key as the live poll
		if (existing.has(id)) {
			alreadyQueued++;
			continue;
		}
		planned.push({
			id,
			data: {
				rawText,
				author: authors[m.user] ?? 'Unknown',
				dogNames: parsed.dogNames,
				suggestedNotes: parsed.notes,
				suggestedOutcome: parsed.outcome,
				slackTs: String(m.ts),
				receivedAt: new Date().toISOString(),
				processed: false,
				source: 'backfill'
			}
		});
	}

	console.log(
		`\n${messages.length} messages, ${planned.length + alreadyQueued} name dogs: ` +
			`${planned.length} to queue, ${alreadyQueued} already in the queue (left alone).`
	);
	for (const p of planned.slice(0, SHOW)) {
		const day = new Date(Number(p.data.slackTs) * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
		console.log(`  ${day}  ${p.data.dogNames.join(', ')}  (${p.data.suggestedOutcome})`);
	}
	if (planned.length > SHOW) console.log(`  … and ${planned.length - SHOW} more`);

	if (!WRITE) return console.log('\nPreview only. Nothing written. Re-run with --write to queue them.');

	let written = 0;
	for (const p of planned) {
		try {
			// create, not set: never overwrite something that appeared since the check above.
			await store.collection('pendingPlaygroups').doc(p.id).create(p.data);
			written++;
		} catch (e) {
			if (e.code !== 6) throw e; // 6: already exists
		}
	}
	console.log(`\nQueued ${written} for review on the Playgroups page.`);
	console.log('Undo with: node scripts/playgroup-backfill.mjs --undo --write');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
