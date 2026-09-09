/**
 * Backfills baths and yard time from Slack history.
 *
 * Usage:
 *   node scripts/enrichment-backfill.mjs                 # preview, writes nothing
 *   node scripts/enrichment-backfill.mjs --write         # actually write
 *   node scripts/enrichment-backfill.mjs --undo --write  # remove everything it wrote
 *
 * Preview is the default. Every record carries source: 'slack' with the originating
 * message, and its id is derived from the dog and the day, so a re-run overwrites
 * rather than duplicating and --undo finds exactly what this wrote.
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
const CHANNEL = flag('channel', 'dog-staff');
const SHOW = Number(flag('show', 12));
/** The roster cannot be rebuilt before Firestore's own dog history begins. */
const SINCE = new Date(`${flag('since', '2026-03-01')}T00:00:00-07:00`).getTime();

function loadEnv() {
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

/** The app's own reading, bundled rather than reimplemented, so the two cannot disagree. */
async function loadImport() {
	const out = join(mkdtempSync(join(tmpdir(), 'enrich-')), 'import.mjs');
	await build({
		entryPoints: ['src/lib/data/feedingImport.ts'],
		outfile: out,
		bundle: true,
		format: 'esm',
		platform: 'node',
		logLevel: 'error',
		alias: { $lib: new URL('../src/lib', import.meta.url).pathname }
	});
	return import(out);
}

function messagesFrom(file) {
	const ch = JSON.parse(readFileSync(file, 'utf8'));
	// Keyed by timestamp: a reply broadcast to the channel arrives twice, and a resumed
	// pull can overlap. The same message read twice is the same bath logged twice.
	const byTs = new Map();
	for (const m of ch.messages ?? []) {
		if (!byTs.has(m.ts)) byTs.set(m.ts, m);
		for (const r of m.replies ?? []) if (!byTs.has(r.ts)) byTs.set(r.ts, r);
	}
	return [...byTs.values()].filter((m) => (m.text ?? '').trim() && !m.bot_id);
}

/**
 * Finds imported records without a collection-group index, which a fresh project does
 * not have. Undo must not depend on infrastructure being in place.
 */
async function findImported(store, sub) {
	const dogs = await store.collection('dogs').select().get();
	const refs = [];
	for (let i = 0; i < dogs.docs.length; i += 20) {
		const batch = await Promise.all(
			dogs.docs.slice(i, i + 20).map((d) => d.ref.collection(sub).get())
		);
		for (const snap of batch) {
			for (const doc of snap.docs) {
				if (doc.id.startsWith('slack-') || doc.data().source === 'slack') refs.push(doc.ref);
			}
		}
	}
	return refs;
}

async function undo(store) {
	for (const sub of ['bathLogs', 'yardLogs']) {
		const refs = await findImported(store, sub);
		console.log(`${sub}: found ${refs.length} imported`);
		if (!WRITE || refs.length === 0) continue;
		for (let i = 0; i < refs.length; i += 400) {
			const batch = store.batch();
			for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
			await batch.commit();
		}
		console.log(`  deleted ${refs.length}`);
	}
	if (!WRITE) console.log('Preview only — re-run with --undo --write to delete.');
}

async function main() {
	loadEnv();
	const store = db();
	if (UNDO) return undo(store);

	const file = join('slack-export', `${CHANNEL}.json`);
	if (!existsSync(file)) {
		console.error(`No ${file}. Run scripts/slack-fetch.mjs first.`);
		process.exit(1);
	}

	const { buildDogIndex, planBaths, planYardTime, bathLogId, yardLogId } = await loadImport();
	const users = JSON.parse(readFileSync(join('slack-export', 'users.json'), 'utf8'));

	const [dogsSnap, groupsSnap] = await Promise.all([
		store.collection('dogs').get(),
		store.collection('dogGroups').get()
	]);
	const index = buildDogIndex(
		dogsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
		groupsSnap.docs.map((d) => ({ name: d.data().name, dogIds: d.data().dogIds ?? [] }))
	);
	console.log(`Roster: ${dogsSnap.size} dogs\n`);

	const baths = [];
	const yard = [];
	for (const m of messagesFrom(file)) {
		const postedAt = new Date(Number(m.ts) * 1000);
		if (postedAt.getTime() < SINCE) continue;
		const author = users[m.user] ?? 'Unknown';
		const text = String(m.text);
		const context = { author, text, slackTs: String(m.ts), postedAt };

		for (const d of planBaths(text, postedAt, index)) baths.push({ ...d, ...context });
		for (const d of planYardTime(text, postedAt, index)) yard.push({ ...d, ...context, at: postedAt });
	}

	// One record per dog per day; a later report of the same day wins.
	const dedupe = (rows, idOf) => {
		const by = new Map();
		for (const r of rows) by.set(idOf(r), r);
		return [...by.values()];
	};
	const bathRows = dedupe(baths, (r) => bathLogId(r.at, r.dogId));
	const yardRows = dedupe(yard, (r) => yardLogId(r.at, r.dogId));

	console.log(`Baths:     ${bathRows.length} records (${new Set(bathRows.map((r) => r.dogId)).size} dogs)`);
	console.log(`Yard time: ${yardRows.length} records (${new Set(yardRows.map((r) => r.dogId)).size} dogs)`);
	console.log(`  from ${new Set([...bathRows, ...yardRows].map((r) => r.slackTs)).size} messages\n`);

	console.log('Sample baths:');
	for (const r of bathRows.slice(0, SHOW)) {
		console.log(`  ${r.at.toISOString().slice(0, 10)}  ${r.dogName.padEnd(20)} "${r.text.replace(/\s+/g, ' ').slice(0, 52)}"`);
	}
	console.log('\nSample yard time:');
	for (const r of yardRows.slice(0, SHOW)) {
		console.log(`  ${r.at.toISOString().slice(0, 10)}  ${r.dogName.padEnd(20)} "${r.text.replace(/\s+/g, ' ').slice(0, 52)}"`);
	}

	if (!WRITE) {
		console.log('\nPreview only. Nothing written. Re-run with --write to commit.');
		return;
	}

	// Written newest last, so the denormalised lastBathDate / lastYardDate each end up
	// holding the most recent one rather than whichever was written last.
	const write = async (rows, sub, idOf, body, stampField, stampBy) => {
		rows.sort((a, b) => a.at - b.at);
		let n = 0;
		for (let i = 0; i < rows.length; i += 300) {
			const batch = store.batch();
			for (const r of rows.slice(i, i + 300)) {
				const id = idOf(r);
				const dog = store.collection('dogs').doc(r.dogId);
				batch.set(dog.collection(sub).doc(id), {
					id,
					timestamp: r.at.toISOString(),
					loggedBy: 'slack-import',
					loggedByName: `${r.author} (via Slack)`,
					source: 'slack',
					sourceTs: r.slackTs,
					...body(r)
				});
				batch.set(
					dog,
					{ [stampField]: r.at.toISOString(), ...(stampBy ? { [stampBy]: `${r.author} (via Slack)` } : {}) },
					{ merge: true }
				);
				n++;
			}
			await batch.commit();
			console.log(`  ${sub}: ${n}/${rows.length}`);
		}
	};

	await write(bathRows, 'bathLogs', (r) => bathLogId(r.at, r.dogId), () => ({}), 'lastBathDate', 'lastBathBy');
	await write(yardRows, 'yardLogs', (r) => yardLogId(r.at, r.dogId), (r) => ({ durationMinutes: r.durationMinutes ?? null }), 'lastYardDate', null);

	console.log('\nDone. Undo with: node scripts/enrichment-backfill.mjs --undo --write');
}

main().catch((e) => { console.error(e); process.exit(1); });
