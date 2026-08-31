/**
 * Backfills feeding logs from parsed Slack history.
 *
 * Usage:
 *   node scripts/feeding-backfill.mjs                 # preview, writes nothing
 *   node scripts/feeding-backfill.mjs --write         # actually write
 *   node scripts/feeding-backfill.mjs --undo          # remove everything it wrote
 *   node scripts/feeding-backfill.mjs --expand-blankets   # also log "everyone ate"
 *
 * Preview is the default and --write must be explicit, because this writes hundreds of
 * records into live dog histories.
 *
 * Every log it creates is marked `source: 'slack'` with the originating message ts, and
 * its document id is derived from that message. So a re-run overwrites rather than
 * duplicates, and --undo can find and remove exactly what this wrote and nothing else.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
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
const SHOW = Number(flag('show', 20));
const REPORT = has('report');
/**
 * Firestore holds no dogs that left before roughly March, so an earlier date rebuilds a
 * roster of six dogs for a shelter that held eighty — and the fill-in then records a day
 * on which six dogs were fed. Better to have no record than a wrong one.
 */
const SINCE = new Date(`${flag('since', '2026-03-01')}T00:00:00`).getTime();

const SOURCE = 'slack';
const LOGGED_BY = 'slack-import';
const LOGGED_BY_NAME = 'Slack import';

function loadEnv() {
	for (const m of readFileSync('.env', 'utf8').matchAll(/^([A-Z0-9_]+)=(?:"([\s\S]*?)"|(.*))$/gm)) {
		if (!(m[1] in process.env)) process.env[m[1]] = (m[2] ?? m[3]).trim();
	}
}

/**
 * Current names straight from ASM, keyed by animal id.
 *
 * Firestore mirrors ASM, but a rename does not always make it across: "Belmont" was
 * still filed under her old name Malone, colliding with the dog who actually is Malone
 * and making every "Malone" in the chat ambiguous. ASM is the system of record for what
 * a dog is called today, so names come from there when it knows the animal.
 */
async function asmNames() {
	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = process.env;
	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) return new Map();
	const base = `${ASM_URL}/asmservice?account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`;
	const get = async (qs) => {
		try {
			const res = await fetch(`${base}&${qs}`);
			if (!res.ok) return [];
			const body = await res.json();
			return Array.isArray(body) ? body : [];
		} catch {
			return [];
		}
	};
	const [current, departed] = await Promise.all([
		get('method=json_shelter_animals&sensitive=1'),
		get('method=json_adopted_animals&fromdate=2026-01-01&todate=2026-12-31')
	]);
	const names = new Map();
	for (const a of [...current, ...departed]) {
		const name = String(a.ANIMALNAME ?? '').trim();
		if (a.ID != null && name) names.set(String(a.ID), name);
	}
	return names;
}

function db() {
	initializeApp({
		credential: cert({
			projectId: process.env.PUBLIC_FIREBASE_PROJECT_ID,
			clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
			privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n')
		})
	});
	return getFirestore();
}

/**
 * The app's own import logic, bundled rather than reimplemented — the roster rules, the
 * 3pm rule and the exception expansion have to mean the same thing here as they do when
 * a message arrives live, or the two quietly disagree about what a message said.
 */
async function loadImport() {
	const out = join(mkdtempSync(join(tmpdir(), 'feedimport-')), 'import.mjs');
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

/** Local calendar day, matching how the app stores and filters feeding dates. */
function dayKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The rule, from the shelter: anything posted after 3pm is the afternoon feed, anything
 * before it is the morning one — unless the message says "morning", which means a
 * morning feed being reported late.
 *
 * An earlier version also tried to infer the slot from the order of a day's reports.
 * That could override the clock, which is not what the shelter does.
 */
const PM_FEED_HOUR = 15;

function assignMealTimes(planned) {
	for (const p of planned) {
		if (p.statedMealTime) {
			p.mealTime = p.statedMealTime;
			p.mealTimeInferred = false;
			continue;
		}
		p.mealTime = p.postedAt.getHours() < PM_FEED_HOUR ? 'am' : 'pm';
		p.mealTimeInferred = true;
	}
}

function messagesFrom(file) {
	const ch = JSON.parse(readFileSync(file, 'utf8'));
	// Keyed by timestamp: a reply broadcast to the channel appears both as a reply and
	// as a message, and a resumed pull can overlap. The same message read twice would
	// become the same feeding logged twice.
	const byTs = new Map();
	for (const m of ch.messages ?? []) {
		if (!byTs.has(m.ts)) byTs.set(m.ts, m);
		for (const r of m.replies ?? []) if (!byTs.has(r.ts)) byTs.set(r.ts, r);
	}
	return [...byTs.values()].filter((m) => (m.text ?? '').trim() && !m.bot_id);
}

/**
 * Finds every imported log. The collectionGroup query is the fast path but needs a
 * single-field index on `source` that a fresh project does not have — and undo must not
 * depend on infrastructure being in place, or the promise that this is reversible is
 * worth nothing. So it falls back to walking each dog, which needs no index at all.
 */
async function findImported(store) {
	try {
		const snap = await store.collectionGroup('feedingLogs').where('source', '==', SOURCE).get();
		return snap.docs.map((d) => d.ref);
	} catch (e) {
		if (e.code !== 9) throw e; // 9 = FAILED_PRECONDITION, i.e. missing index
		console.log('  (no collection-group index; scanning per dog instead)');
		const dogs = await store.collection('dogs').select().get();
		const refs = [];
		for (let i = 0; i < dogs.docs.length; i += 20) {
			const batch = await Promise.all(
				dogs.docs.slice(i, i + 20).map((d) => d.ref.collection('feedingLogs').get())
			);
			for (const snap of batch) {
				// Both checks: the id is derived from the source message, and the field is
				// written by this script. Either alone identifies an imported log.
				for (const doc of snap.docs) {
					if (doc.id.startsWith('slack-') || doc.data().source === SOURCE) refs.push(doc.ref);
				}
			}
		}
		return refs;
	}
}

async function undo(store) {
	const refs = await findImported(store);
	console.log(`Found ${refs.length} imported feeding logs.`);
	if (refs.length === 0) return;
	if (!WRITE) return console.log('Preview only — re-run with --undo --write to delete.');
	let done = 0;
	for (let i = 0; i < refs.length; i += 400) {
		const batch = store.batch();
		for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
		await batch.commit();
		done += Math.min(400, refs.length - i);
		console.log(`  deleted ${done}/${refs.length}`);
	}
}

/**
 * What to distrust, rather than what was produced. Totals look fine even when
 * individual records are wrong, so this surfaces the specific shapes most likely to be
 * a bad read.
 */
function reportProblems(planned) {
	const line = (t) => console.log(t);
	line(`\n${'='.repeat(70)}\nWHAT TO CHECK\n${'='.repeat(70)}`);

	// 1. Two messages disagreeing about the same dog, day and meal. One of them is wrong,
	//    and a re-run would silently keep whichever was written last.
	const slots = new Map();
	for (const p of planned) {
		const key = `${p.dogId}|${p.date}|${p.mealTime}`;
		if (!slots.has(key)) slots.set(key, []);
		slots.get(key).push(p);
	}
	const conflicts = [...slots.values()].filter(
		(g) => new Set(g.map((x) => x.amountEaten)).size > 1
	);
	line(`\n1. Contradictions — same dog, same meal, different amounts: ${conflicts.length}`);
	for (const g of conflicts.slice(0, 8)) {
		line(`   ${g[0].date} ${g[0].mealTime} ${g[0].dogName}: ${g.map((x) => x.amountEaten).join(' vs ')}`);
		for (const x of g) line(`      "${x.text.slice(0, 100)}"`);
	}

	// 2. Which slot the 3pm rule put things in.
	const pm = planned.filter((p) => p.mealTime === 'pm').length;
	const am = planned.filter((p) => p.mealTime === 'am').length;
	const second = planned.filter((p) => p.mealTime === 'second').length;
	line(`\n2. Meal slots by the 3pm rule: ${am} morning, ${pm} afternoon, ${second} second meal`);

	// 3. One message naming a lot of dogs is either a genuine roll-call or an over-match.
	const big = [...new Map(planned.filter((p) => p.entryCount >= 8).map((p) => [p.slackTs, p])).values()];
	line(`\n3. Messages naming 8+ dogs at once: ${big.length}`);
	for (const p of big.slice(0, 5)) line(`   ${p.entryCount} dogs: "${p.text.slice(0, 110)}"`);

	// 4. 'all' is the least distinctive reading — the bare "ate" fallback lands here, so
	//    it is where a misread is most likely to hide.
	const alls = planned.filter((p) => p.amountEaten === 'all');
	line(`\n4. Logged as ate-everything (from a bare "ate"): ${alls.length}`);
	for (const p of alls.slice(0, 6)) line(`   ${p.dogName}: "${p.text.slice(0, 105)}"`);

	line(`\n${'='.repeat(70)}`);
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

	const { buildDogIndex, planFeedings, feedingLogId } = await loadImport();
	const users = JSON.parse(readFileSync(join('slack-export', 'users.json'), 'utf8'));

	// Roster from Firestore, not ASM: the doc id is what the log has to be filed under,
	// and a dog named in chat but absent from Firestore has nowhere to put a log.
	const [dogsSnap, liveNames] = await Promise.all([
		store.collection('dogs').get(),
		asmNames()
	]);
	const groupsSnap = await store.collection('dogGroups').get();
	let renamed = 0;
	const dogRecords = [];
	for (const d of dogsSnap.docs) {
		const data = d.data();
		// ASM's name wins when it knows this animal: Firestore can be holding a name the
		// dog no longer has, which then collides with whichever dog does have it.
		const live = liveNames.get(d.id);
		if (live && live !== data.name) renamed++;
		const name = live ?? data.name;
		if (!name) continue;
		dogRecords.push({ ...data, id: d.id, name });
	}
	const index = buildDogIndex(
		dogRecords,
		groupsSnap.docs.map((d) => ({ name: d.data().name, dogIds: d.data().dogIds ?? [] }))
	);
	console.log(
		`Roster: ${dogRecords.length} dogs` +
			`${renamed ? ` (${renamed} renamed since Firestore last synced)` : ''}\n`
	);

	const planned = [];
	let reports = 0;

	for (const m of messagesFrom(file)) {
		const postedAt = new Date(Number(m.ts) * 1000);
		if (postedAt.getTime() < SINCE) continue;

		// planFeedings is the app's own reading of a message, expansion included: the
		// dogs named, plus everyone else at the shelter that day recorded as having eaten.
		const entries = planFeedings(m.text, postedAt, index);
		if (entries.length === 0) continue;
		reports++;

		for (const entry of entries) {
			planned.push({
				...entry,
				id: feedingLogId(postedAt, entry.dogId, entry.mealTime),
				date: dayKey(postedAt),
				postedAt,
				author: users[m.user] ?? 'Unknown',
				slackTs: String(m.ts),
				text: m.text.replace(/\s+/g, ' ').trim()
			});
		}
	}

	// Two people often report the same meal. One record per dog per meal per day, and a
	// dog someone actually named beats one filled in from the exceptions.
	const bySlot = new Map();
	for (const p of planned) {
		const existing = bySlot.get(p.id);
		if (!existing || (existing.implied && !p.implied)) bySlot.set(p.id, p);
	}
	const deduped = [...bySlot.values()];
	const dropped = planned.length - deduped.length;
	planned.length = 0;
	planned.push(...deduped);

	const byAmount = {};
	for (const p of planned) byAmount[p.amountEaten] = (byAmount[p.amountEaten] ?? 0) + 1;
	const inferredCount = planned.filter((p) => p.mealTimeInferred).length;

	const impliedCount = planned.filter((p) => p.implied).length;
	console.log(`Reports read: ${reports}`);
	console.log(`Feeding logs to write: ${planned.length}`);
	console.log(`  named in a message:   ${planned.length - impliedCount}`);
	console.log(`  everyone else (all):  ${impliedCount}`);
	console.log(`  duplicate slots merged: ${dropped}`);
	for (const [k, v] of Object.entries(byAmount)) console.log(`  ${k.padEnd(7)} ${v}`);
	console.log(`\n  meal time inferred from post time: ${inferredCount} (${((inferredCount / planned.length) * 100).toFixed(0)}%)`);

	console.log(`\nSample:`);
	for (const p of planned.slice(0, SHOW)) {
		const time = `${String(p.postedAt.getHours()).padStart(2, '0')}:${String(p.postedAt.getMinutes()).padStart(2, '0')}`;
		console.log(`  ${p.date} ${time} ${p.mealTime.padEnd(6)} ${p.dogName.padEnd(16)} ${p.amountEaten}`);
	}

	if (REPORT) reportProblems(planned);

	if (has('review')) {
		// Grouped by source message, because that is the unit a person can actually judge:
		// read what was written, see what it produced, decide if it is right.
		const byMsg = new Map();
		for (const p of planned) {
			if (!byMsg.has(p.slackTs)) {
				byMsg.set(p.slackTs, {
					ts: p.slackTs, author: p.author, text: p.text,
					at: p.postedAt.toISOString(), date: p.date, logs: []
				});
			}
			byMsg.get(p.slackTs).logs.push({
				dog: p.dogName, amount: p.amountEaten, meal: p.mealTime,
				inferred: p.mealTimeInferred
			});
		}
		const out = [...byMsg.values()].sort((a, b) => Number(b.ts) - Number(a.ts));
		writeFileSync('slack-export/review.json', JSON.stringify({ total: planned.length, messages: out }, null, 2));
		console.log(`\nWrote slack-export/review.json (${out.length} messages, ${planned.length} logs)`);
	}

	if (!WRITE) {
		console.log(`\nPreview only. Nothing written. Re-run with --write to commit.`);
		return;
	}

	const now = new Date().toISOString();
	let written = 0;
	for (let i = 0; i < planned.length; i += 400) {
		const batch = store.batch();
		for (const p of planned.slice(i, i + 400)) {
			batch.set(store.collection('dogs').doc(p.dogId).collection('feedingLogs').doc(p.id), {
				id: p.id,
				date: new Date(`${p.date}T12:00:00`).toISOString(),
				mealTime: p.mealTime,
				amountEaten: p.amountEaten,
				notes: `via Slack — ${p.author}: "${p.text.slice(0, 180)}"`,
				loggedBy: LOGGED_BY,
				loggedByName: `${p.author} (via Slack)`,
				createdAt: now,
				// Provenance, so these are findable and removable as a set.
				source: SOURCE,
				sourceTs: p.slackTs,
				// Whether a person named this dog or it was filled in from the exceptions.
				// Without it there is no way to tell an observation from an inference after
				// the fact, which is exactly what an audit needs to know.
				impliedFromExceptions: Boolean(p.implied),
				mealTimeInferred: p.mealTimeInferred
			});
		}
		await batch.commit();
		written += Math.min(400, planned.length - i);
		console.log(`  wrote ${written}/${planned.length}`);
	}
	console.log(`\nDone. Undo with: node scripts/feeding-backfill.mjs --undo --write`);
}

main().catch((e) => { console.error(e); process.exit(1); });
