/**
 * Reads slack-export/ and reports what the chat actually contains, bucketed by the
 * app areas that could be backfilled from it.
 *
 * Usage: node scripts/slack-analyze.mjs [--samples 8] [--domain feeding]
 *
 * This is a survey, not a parser. Its output is meant to answer "is there enough
 * signal here to auto-fill feeding logs / playgroups / day trips?" and to show the
 * real phrasings a parser would have to handle. Writes slack-export/REPORT.md.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR = 'slack-export';

// Buckets are keyword-scored, not exclusive: a message saying "fed Blue, then
// playgroup" lands in both. Tuned to be generous — a false positive costs a glance,
// a false negative hides a whole feature's worth of data.
const DOMAINS = {
	feeding: ['fed', 'feed', 'feeding', 'ate', 'eating', 'breakfast', 'dinner', 'meal', 'kibble', 'food', 'satin ball', 'supplement', 'fasting', 'did not eat', "didn't eat"],
	playgroup: ['playgroup', 'play group', 'played', 'playing', 'pg', 'yard time', 'introduced', 'intro', 'muzzle'],
	daytrip: ['day trip', 'daytrip', 'dt', 'dtv', 'field trip', 'outing', 'took out', 'back from', 'signed out', 'returned at'],
	medical: ['meds', 'medication', 'vet', 'sick', 'kennel cough', 'diarrhea', 'vomit', 'limping', 'surgery', 'spay', 'neuter', 'giardia', 'parvo', 'treatment', 'dose'],
	cleaning: ['cleaned', 'cleaning', 'kennel', 'laundry', 'dishes', 'scrub', 'mopped', 'disinfect'],
	stool: ['stool', 'poop', 'pooped', 'bm', 'firm', 'loose', 'runny'],
	foster: ['foster', 'fostering', 'fostered', 'foster home'],
	attendance: ['arrived', 'running late', "can't make it", 'cant make it', 'no show', 'called out', 'on my way', 'here now', 'shift', 'covering'],
	adoption: ['adopted', 'adoption', 'went home', 'meet and greet', 'meet & greet', 'application'],
	behavior: ['reactive', 'growled', 'bit', 'nipped', 'resource guard', 'fearful', 'shut down', 'barrier']
};

// Whole words only. Substring matching quietly ruins the survey: 'ate' hits "running
// late", 'bm' hits "bmp", and the resulting counts look like signal that isn't there.
// Compiled once — this runs over every message in every channel.
const DOMAIN_PATTERNS = Object.entries(DOMAINS).map(([domain, words]) => [
	domain,
	words.map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))
]);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};
const SAMPLES = Number(flag('samples', 8));
const ONLY = flag('domain', null);

function loadExport() {
	if (!existsSync(OUT_DIR)) {
		console.error(`No ${OUT_DIR}/ directory. Run: node scripts/slack-fetch.mjs`);
		process.exit(1);
	}
	const users = existsSync(join(OUT_DIR, 'users.json'))
		? JSON.parse(readFileSync(join(OUT_DIR, 'users.json'), 'utf8'))
		: {};
	const channels = readdirSync(OUT_DIR)
		.filter((f) => f.endsWith('.json') && f !== 'users.json')
		.map((f) => JSON.parse(readFileSync(join(OUT_DIR, f), 'utf8')));
	if (!channels.length) {
		console.error(`${OUT_DIR}/ has no channel files yet. Run: node scripts/slack-fetch.mjs`);
		process.exit(1);
	}
	return { users, channels };
}

/** Flattens threads into the message list so replies are surveyed too. */
function allMessages(channel) {
	const out = [];
	for (const message of channel.messages ?? []) {
		out.push(message);
		for (const reply of message.replies ?? []) out.push(reply);
	}
	return out;
}

function classify(text) {
	return DOMAIN_PATTERNS.filter(([, patterns]) => patterns.some((p) => p.test(text))).map(([domain]) => domain);
}

function main() {
	const { users, channels } = loadExport();
	const lines = [];
	const say = (s = '') => { lines.push(s); console.log(s); };

	const byDomain = {};
	const byChannel = {};
	const byAuthor = {};
	const byHour = new Array(24).fill(0);
	let total = 0;
	let earliest = Infinity;
	let latest = 0;

	for (const channel of channels) {
		const messages = allMessages(channel).filter((m) => (m.text ?? '').trim() && !m.bot_id);
		byChannel[channel.channel] = { total: messages.length, domains: {} };

		for (const message of messages) {
			total++;
			const ts = Number(message.ts);
			if (ts) {
				earliest = Math.min(earliest, ts);
				latest = Math.max(latest, ts);
				byHour[new Date(ts * 1000).getHours()]++;
			}
			const author = users[message.user] ?? message.user ?? 'unknown';
			byAuthor[author] = (byAuthor[author] ?? 0) + 1;

			for (const domain of classify(message.text)) {
				byDomain[domain] ??= { count: 0, samples: [] };
				byDomain[domain].count++;
				byChannel[channel.channel].domains[domain] = (byChannel[channel.channel].domains[domain] ?? 0) + 1;
				if (byDomain[domain].samples.length < SAMPLES * 3) {
					byDomain[domain].samples.push({ channel: channel.channel, author, text: message.text.replace(/\s+/g, ' ').trim() });
				}
			}
		}
	}

	const fmt = (ts) => (Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : 'n/a');
	say(`# Slack history survey\n`);
	say(`${total} human messages across ${channels.length} channel(s), ${fmt(earliest)} → ${fmt(latest)}\n`);

	say(`## Volume by app area\n`);
	say(`| Area | Messages | % of all |`);
	say(`| --- | ---: | ---: |`);
	for (const [domain, data] of Object.entries(byDomain).sort((a, b) => b[1].count - a[1].count)) {
		say(`| ${domain} | ${data.count} | ${((data.count / total) * 100).toFixed(1)}% |`);
	}
	say();

	say(`## By channel\n`);
	for (const [name, data] of Object.entries(byChannel).sort((a, b) => b[1].total - a[1].total)) {
		const top = Object.entries(data.domains).sort((a, b) => b[1] - a[1]).slice(0, 5)
			.map(([d, c]) => `${d} ${c}`).join(', ');
		say(`- **#${name}** — ${data.total} messages${top ? ` (${top})` : ''}`);
	}
	say();

	say(`## Most active posters\n`);
	for (const [author, count] of Object.entries(byAuthor).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
		say(`- ${author} — ${count}`);
	}
	say();

	const peak = byHour.map((c, h) => [h, c]).sort((a, b) => b[1] - a[1]).slice(0, 5);
	say(`## Busiest hours\n`);
	say(peak.map(([h, c]) => `${String(h).padStart(2, '0')}:00 (${c})`).join(' · '));
	say();

	say(`## Sample messages\n`);
	say(`These are what a parser would have to handle.\n`);
	for (const [domain, data] of Object.entries(byDomain).sort((a, b) => b[1].count - a[1].count)) {
		if (ONLY && domain !== ONLY) continue;
		say(`### ${domain} (${data.count})\n`);
		for (const sample of data.samples.slice(0, SAMPLES)) {
			say(`- \`#${sample.channel}\` **${sample.author}**: ${sample.text.slice(0, 240)}`);
		}
		say();
	}

	writeFileSync(join(OUT_DIR, 'REPORT.md'), lines.join('\n'));
	console.log(`\nWrote ${join(OUT_DIR, 'REPORT.md')}`);
}

main();
