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
	const out = [];
	for (const m of ch.messages ?? []) {
		out.push(m);
		for (const r of m.replies ?? []) out.push(r);
	}
	return out.filter((m) => (m.text ?? '').trim() && !m.bot_id);
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

	const parseFeedingMessage = await loadParser();
	const users = JSON.parse(readFileSync(join('slack-export', 'users.json'), 'utf8'));

	// Roster from Firestore, not ASM: the doc id is what the log has to be filed under,
	// and a dog named in chat but absent from Firestore has nowhere to put a log.
	const dogsSnap = await store
		.collection('dogs')
		.select('name', 'intakeDate', 'leftShelterDate', 'status', 'asmShelterCode')
		.get();
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
		const from = data.intakeDate ? new Date(data.intakeDate).getTime() : null;
		let to = data.leftShelterDate ? new Date(data.leftShelterDate).getTime() : null;
		// A departure earlier than the dog's own intake belongs to an earlier stay: the
		// dog left, came back, and intakeDate moved to the return while leftShelterDate
		// kept the old value. Shorty left in May and returned in August. Treating that
		// stale departure as current hid him from every report since.
		if (to !== null && ((from !== null && to < from) || data.status === 'active')) to = null;
		byName.get(data.name).push({ id: d.id, from, to, code: data.asmShelterCode ?? null });
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
		let inWindow = candidates.filter(
			(c) => (c.from === null || at >= c.from - 86_400_000) && (c.to === null || at <= c.to + 86_400_000)
		);

		// A document keyed by shelter number is one ASM maintains; a UUID-keyed one is a
		// legacy record the sync no longer touches, and several of those are stale twins
		// still marked present long after the dog left. The shelter number wins.
		const byShelterNumber = inWindow.filter((c) => /^\d+$/.test(c.id));
		if (byShelterNumber.length > 0) inWindow = byShelterNumber;

		// Between two shelter numbers, the dog still at the shelter is the one being
		// written about — the other is a previous animal of the same name.
		if (inWindow.length > 1) {
			const stillHere = inWindow.filter((c) => c.to === null);
			if (stillHere.length === 1) inWindow = stillHere;
		}

		// Two records are the same animal only if they carry the same shelter code. A
		// shared intake date is not enough: the two "Malone" records are different dogs
		// admitted the same day, one still showing a name that was later changed in ASM
		// without the rename syncing. Picking either would file meals onto the wrong dog,
		// so they stay ambiguous and are skipped.
		if (inWindow.length > 1) {
			const codes = new Set(inWindow.map((c) => c.code).filter(Boolean));
			if (codes.size === 1) {
				inWindow = [inWindow.slice().sort((a, b) => (b.to ?? Infinity) - (a.to ?? Infinity))[0]];
			}
		}

		// Exactly one match is an answer; none or several is a guess, and a guess here
		// files a real meal onto the wrong animal's medical history.
		return inWindow.length === 1 ? inWindow[0].id : null;
	}

	/**
	 * Only the dogs actually at the shelter on a given day. Passing the whole roster made
	 * "Freda" ambiguous between Frida and Freya even on dates when Freya had not yet
	 * arrived — and every extra name is another chance for a fuzzy match to go wrong.
	 */
	const rosterCache = new Map();
	function rosterOn(when) {
		const key = dayKey(when);
		if (rosterCache.has(key)) return rosterCache.get(key);
		const at = when.getTime();
		const names = [];
		for (const [name, cands] of byName) {
			const present = cands.some(
				(c) => (c.from === null || at >= c.from - 86_400_000) && (c.to === null || at <= c.to + 86_400_000)
			);
			if (present) names.push(name);
		}
		rosterCache.set(key, names);
		return names;
	}

	const planned = [];
	const skipped = { noDog: 0, blanket: 0, ambiguous: 0 };

	for (const m of messagesFrom(file)) {
		const postedAtForRoster = new Date(Number(m.ts) * 1000);
		if (postedAtForRoster.getTime() < SINCE) continue;
		const parsed = parseFeedingMessage(m.text, rosterOn(postedAtForRoster));
		if (parsed.entries.length === 0) {
			if (parsed.allAte) skipped.blanket++;
			continue;
		}
		// "do not feed" is an instruction about a meal that never happened. It is parsed
		// so it cannot be mistaken for a record — and then deliberately not written.
		const postedAt = new Date(Number(m.ts) * 1000);
		if (postedAt.getTime() < SINCE) continue;
		const stated = parsed.mealTime;

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
				date: dayKey(postedAt),
				statedMealTime: stated,
				amountEaten: entry.amountEaten,
				postedAt,
				entryCount: parsed.entries.length,
				author: users[m.user] ?? 'Unknown',
				slackTs: String(m.ts),
				text: m.text.replace(/\s+/g, ' ').trim()
			});
		}
	}

	assignMealTimes(planned);
	for (const p of planned) {
		// Derived from the message and slot, so a second run lands on the same document.
		p.id = `slack-${p.slackTs.replace('.', '-')}-${p.dogId}-${p.mealTime}`;
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
