/**
 * Dry run: what would backfilling feeding logs from Slack actually write?
 *
 * Usage: node scripts/feeding-dry-run.mjs [--show 25] [--channel dog-staff]
 *
 * Writes nothing. Parses every message in slack-export/ with the real dog roster and
 * reports coverage, the amount breakdown, and — most importantly — the messages that
 * look feeding-related but parsed to nothing, since those are where a backfill would
 * silently lose data.
 */
import { readFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build } from 'esbuild';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const SHOW = Number(flag('show', 20));
const CHANNEL = flag('channel', 'dog-staff');

function loadEnv() {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
	}
}

/** The parser is TypeScript and the repo has no TS runner; esbuild is already here. */
async function loadParser() {
	const out = join(mkdtempSync(join(tmpdir(), 'feedparse-')), 'parser.mjs');
	await build({
		entryPoints: ['src/lib/utils/parseFeedingMessage.ts'],
		outfile: out,
		bundle: true,
		format: 'esm',
		platform: 'node',
		logLevel: 'error'
	});
	return (await import(out)).parseFeedingMessage;
}

/**
 * Roster comes from ASM, the system of record. The Sheets service account in .env has
 * no Firestore access, and Firestore is only a mirror of ASM anyway.
 *
 * Two calls, because neither alone is enough: json_shelter_animals covers dogs still
 * here, json_adopted_animals covers the ones that left during the window. January
 * messages are full of dogs adopted since, and omitting them understates coverage.
 */
async function loadRoster(sinceISO) {
	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = process.env;
	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) {
		throw new Error('ASM credentials not configured in .env');
	}
	const base = `${ASM_URL}/asmservice?account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`;

	const get = async (qs) => {
		const res = await fetch(`${base}&${qs}`);
		if (!res.ok) throw new Error(`ASM ${qs} failed: ${res.status}`);
		const body = await res.json();
		return Array.isArray(body) ? body : [];
	};

	const today = new Date().toISOString().slice(0, 10);
	const [current, departed] = await Promise.all([
		get('method=json_shelter_animals&sensitive=1'),
		// Departed dogs are a bonus, not a requirement — an unsupported date range or a
		// permissions difference should not sink the whole dry run.
		get(`method=json_adopted_animals&fromdate=${sinceISO}&todate=${today}`).catch((e) => {
			console.log(`  (adopted-animals lookup skipped: ${e.message})`);
			return [];
		})
	]);

	const names = new Set();
	for (const a of [...current, ...departed]) {
		// Kept whole, parentheses and all: "Nova (Newsie)" carries the name staff use,
		// and the parser expands the aliases itself.
		const name = (a.ANIMALNAME ?? a.NAME ?? '').trim();
		if (name) names.add(name);
	}
	console.log(`  ASM: ${current.length} in shelter, ${departed.length} departed since ${sinceISO}`);
	return [...names];
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

const FEEDING_HINT = /\b(fed|feed|feeding|ate|eat|eaten)\b/i;

async function main() {
	loadEnv();
	const file = join('slack-export', `${CHANNEL}.json`);
	if (!existsSync(file)) {
		console.error(`No ${file}. Run: node scripts/slack-fetch.mjs ${CHANNEL} --since 2026-01-01`);
		process.exit(1);
	}

	const [parseFeedingMessage, roster] = await Promise.all([loadParser(), loadRoster('2026-01-01')]);
	console.log(`Roster: ${roster.length} dogs (including archived)\n`);

	const messages = messagesFrom(file);
	const hinted = messages.filter((m) => FEEDING_HINT.test(m.text));

	const amounts = { all: 0, most: 0, half: 0, little: 0, none: 0 };
	let parsed = 0, blanket = 0, directives = 0, withMeal = 0, logs = 0;
	const misses = [];
	const samples = [];
	const dogHits = new Map();

	for (const m of hinted) {
		const r = parseFeedingMessage(m.text, roster);
		const produced = r.entries.length > 0 || r.allAte || r.doNotFeed.length > 0;
		if (!produced) { misses.push(m.text.replace(/\s+/g, ' ').trim()); continue; }
		parsed++;
		if (r.allAte) blanket++;
		if (r.doNotFeed.length) directives++;
		if (r.mealTime) withMeal++;
		for (const e of r.entries) {
			amounts[e.amountEaten]++;
			logs++;
			dogHits.set(e.name, (dogHits.get(e.name) ?? 0) + 1);
		}
		const parts = [];
		if (r.allAte) parts.push('ALL ATE');
		if (r.doNotFeed.length) parts.push(`do-not-feed[${r.doNotFeed.join(', ')}]`);
		if (r.mealTime) parts.push(r.mealTime.toUpperCase());
		parts.push(...r.entries.map((e) => `${e.name}=${e.amountEaten}`));
		samples.push({ text: m.text.replace(/\s+/g, ' ').trim(), summary: parts.join('  ') });
	}

	console.log(`Messages scanned:        ${messages.length}`);
	console.log(`Feeding-related:         ${hinted.length}`);
	console.log(`Parsed to something:     ${parsed} (${((parsed / hinted.length) * 100).toFixed(0)}%)`);
	console.log(`  with a blanket "all":  ${blanket}`);
	console.log(`  with a do-not-feed:    ${directives}`);
	console.log(`  with explicit AM/PM:   ${withMeal} (${((withMeal / parsed) * 100).toFixed(0)}% of parsed)`);
	console.log(`\nPer-dog entries that would be written: ${logs}`);
	for (const [k, v] of Object.entries(amounts)) {
		console.log(`  ${k.padEnd(6)} ${String(v).padStart(4)}`);
	}

	console.log(`\nTop dogs by mentions:`);
	for (const [name, n] of [...dogHits].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
		console.log(`  ${name.padEnd(16)} ${n}`);
	}

	if (argv.includes('--sample')) {
		console.log(`\n── Sample parses (verify these before trusting the totals) ──\n`);
		for (const m of samples.slice(0, SHOW)) {
			console.log(`  "${m.text.slice(0, 130)}"`);
			console.log(`    => ${m.summary}\n`);
		}
	}

	console.log(`\n── Feeding-ish messages that parsed to NOTHING (${misses.length}) ──`);
	console.log(`These are the silent losses. Showing ${Math.min(SHOW, misses.length)}:\n`);
	for (const t of misses.slice(0, SHOW)) console.log(`  · ${t.slice(0, 170)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
