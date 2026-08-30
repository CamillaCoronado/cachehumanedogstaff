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
const EXPAND_BLANKETS = has('expand-blankets');
const CHANNEL = flag('channel', 'dog-staff');
const SHOW = Number(flag('show', 20));
const REPORT = has('report');
// The app only wants this year; anything earlier is history nobody will look at.
const SINCE = new Date(`${flag('since', '2026-01-01')}T00:00:00`).getTime();

const SOURCE = 'slack';
const LOGGED_BY = 'slack-import';
const LOGGED_BY_NAME = 'Slack import';

function loadEnv() {
	for (const m of readFileSync('.env', 'utf8').matchAll(/^([A-Z0-9_]+)=(?:"([\s\S]*?)"|(.*))$/gm)) {
		if (!(m[1] in process.env)) process.env[m[1]] = (m[2] ?? m[3]).trim();
	}
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

async function loadParser() {
	const out = join(mkdtempSync(join(tmpdir(), 'feedparse-')), 'parser.mjs');
	await build({
		entryPoints: ['src/lib/utils/parseFeedingMessage.ts'],
		outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error'
	});
	return (await import(out)).parseFeedingMessage;
}

/** Local calendar day, matching how the app stores and filters feeding dates. */
function dayKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The shelter feeds again at 3pm, so a message posted at 1pm is still reporting the
 * morning feed. Splitting at noon — the obvious choice — would misfile most of the
 * midday reports, and 10am–1pm is the busiest window in the channel.
 */
const PM_FEED_HOUR = 15;
/** Posts within an hour either side of the changeover are the ones most likely misfiled. */
const BOUNDARY_HOURS = 1;

function resolveMealTime(parsed, postedAt) {
	if (parsed.mealTime) return { mealTime: parsed.mealTime, inferred: false };
	const hour = postedAt.getHours();
	return {
		mealTime: hour < PM_FEED_HOUR ? 'am' : 'pm',
		inferred: true,
		boundary: Math.abs(hour - PM_FEED_HOUR) <= BOUNDARY_HOURS
	};
}

function messagesFrom(file) {
	const ch = JSON.parse(readFileSync(file, 'utf8'));
	const out = [];
	for (const m of ch.messages ?? []) {
		out.push(m);
		for (const r of m.replies ?? []) out.push(r);
	}
	return out.filter((m) => (m.text ?? '').trim() && !m.bot_id);
}

async function undo(store) {
	// collectionGroup finds them wherever they live, without walking every dog.
	const snap = await store.collectionGroup('feedingLogs').where('source', '==', SOURCE).get();
	console.log(`Found ${snap.size} imported feeding logs.`);
	if (!WRITE) return console.log('Preview only — re-run with --undo --write to delete.');
	let done = 0;
	for (let i = 0; i < snap.docs.length; i += 400) {
		const batch = store.batch();
		for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
		await batch.commit();
		done += Math.min(400, snap.docs.length - i);
		console.log(`  deleted ${done}/${snap.size}`);
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

	// 2. Posts near the 3pm changeover, where the inferred meal is a coin flip.
	const boundary = planned.filter((p) => p.boundary);
	line(`\n2. Posted near the 3pm feed, so AM/PM is a guess: ${boundary.length}`);
	for (const p of boundary.slice(0, 6)) {
		line(`   ${p.date} ${String(p.postedAt.getHours()).padStart(2, '0')}:${String(p.postedAt.getMinutes()).padStart(2, '0')} -> ${p.mealTime}  ${p.dogName} ${p.amountEaten}`);
	}

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

	const parseFeedingMessage = await loadParser();

	// Roster from Firestore, not ASM: the doc id is what the log has to be filed under,
	// and a dog named in chat but absent from Firestore has nowhere to put a log.
	const dogsSnap = await store.collection('dogs').select('name', 'intakeDate', 'leftShelterDate').get();
	const byName = new Map();
	const roster = [];
	for (const d of dogsSnap.docs) {
		const data = d.data();
		if (!data.name) continue;
		roster.push(data.name);
		// Names repeat across years — three Rockys, three Birdies. Keep every candidate
		// and pick by date below; keeping only the first would file a 2026 Rocky's meals
		// onto a Rocky that left in 2024.
		if (!byName.has(data.name)) byName.set(data.name, []);
		byName.get(data.name).push({
			id: d.id,
			from: data.intakeDate ? new Date(data.intakeDate).getTime() : null,
			to: data.leftShelterDate ? new Date(data.leftShelterDate).getTime() : null
		});
	}
	const ambiguousNames = [...byName].filter(([, v]) => v.length > 1).length;
	console.log(`Roster: ${roster.length} dogs from Firestore (${ambiguousNames} names shared by more than one dog)\n`);

	/** The dog of this name that was actually at the shelter on `when`. */
	function resolveDog(name, when) {
		const candidates = byName.get(name);
		if (!candidates) return null;
		if (candidates.length === 1) return candidates[0].id;
		const at = when.getTime();
		// A day of slack on the front: a message can land just before the intake stamp.
		const inWindow = candidates.filter(
			(c) => (c.from === null || at >= c.from - 86_400_000) && (c.to === null || at <= c.to + 86_400_000)
		);
		// Exactly one match is an answer; none or several is a guess, and a guess here
		// files a real meal onto the wrong animal's medical history.
		return inWindow.length === 1 ? inWindow[0].id : null;
	}

	const planned = [];
	const skipped = { noDog: 0, blanket: 0, ambiguous: 0 };

	for (const m of messagesFrom(file)) {
		const parsed = parseFeedingMessage(m.text, roster);
		if (parsed.entries.length === 0) {
			if (parsed.allAte) skipped.blanket++;
			continue;
		}
		// "do not feed" is an instruction about a meal that never happened. It is parsed
		// so it cannot be mistaken for a record — and then deliberately not written.
		const postedAt = new Date(Number(m.ts) * 1000);
		if (postedAt.getTime() < SINCE) continue;
		const { mealTime, inferred, boundary } = resolveMealTime(parsed, postedAt);

		for (const entry of parsed.entries) {
			const dogId = resolveDog(entry.name, postedAt);
			if (!dogId) {
				if (byName.has(entry.name)) skipped.ambiguous++;
				else skipped.noDog++;
				continue;
			}
			planned.push({
				dogId,
				dogName: entry.name,
				// Derived from the message, so a second run lands on the same document.
				id: `slack-${String(m.ts).replace('.', '-')}-${dogId}-${mealTime}`,
				date: dayKey(postedAt),
				mealTime,
				amountEaten: entry.amountEaten,
				mealTimeInferred: inferred,
				boundary: Boolean(boundary),
				postedAt,
				entryCount: parsed.entries.length,
				slackTs: String(m.ts),
				text: m.text.replace(/\s+/g, ' ').trim()
			});
		}
	}

	const byAmount = {};
	for (const p of planned) byAmount[p.amountEaten] = (byAmount[p.amountEaten] ?? 0) + 1;
	const inferredCount = planned.filter((p) => p.mealTimeInferred).length;

	console.log(`Feeding logs to write: ${planned.length}`);
	for (const [k, v] of Object.entries(byAmount)) console.log(`  ${k.padEnd(7)} ${v}`);
	console.log(`\n  meal time inferred from post time: ${inferredCount} (${((inferredCount / planned.length) * 100).toFixed(0)}%)`);
	console.log(`  skipped, dog not in Firestore:     ${skipped.noDog}`);
	console.log(`  skipped, name matched >1 dog:      ${skipped.ambiguous}`);
	console.log(`  blanket "everyone ate", not written: ${skipped.blanket}${EXPAND_BLANKETS ? '' : '  (use --expand-blankets to reconsider)'}`);

	console.log(`\nSample:`);
	for (const p of planned.slice(0, SHOW)) {
		console.log(`  ${p.date} ${p.mealTime}${p.mealTimeInferred ? '?' : ' '} ${p.dogName.padEnd(16)} ${p.amountEaten}`);
	}

	if (REPORT) reportProblems(planned);

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
				notes: null,
				loggedBy: LOGGED_BY,
				loggedByName: LOGGED_BY_NAME,
				createdAt: now,
				// Provenance, so these are findable and removable as a set.
				source: SOURCE,
				sourceTs: p.slackTs,
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
