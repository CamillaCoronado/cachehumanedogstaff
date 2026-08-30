import type { AmountEaten, MealTime } from '$lib/types';

export interface ParsedFeedingEntry {
	name: string;
	amountEaten: AmountEaten;
}

export interface ParsedFeedingMessage {
	entries: ParsedFeedingEntry[];
	/**
	 * The message asserted that everyone ate ("Everyone ate", "All dogs ate"). Callers
	 * should treat every roster dog as 'all' and then apply `entries` on top, which is
	 * how staff actually write it: the blanket statement plus its exceptions.
	 */
	allAte: boolean;
	/**
	 * Dogs named in a "do not feed" instruction. This is a directive about a meal that
	 * has not happened — usually surgery — not a record of one that did. Kept separate
	 * so a caller can never mistake it for a log.
	 */
	doNotFeed: string[];
	/** Only set when the message says so; inferring from post time is the caller's call. */
	mealTime: MealTime | null;
}

/**
 * Longest phrase first — "ate a little" must beat "ate", and "didn't eat much" must
 * beat "didn't eat", or the coarser reading wins and the amount is wrong.
 */
const AMOUNT_PATTERNS: { re: RegExp; amount: AmountEaten }[] = [
	{ re: /did(?:n'?t| not)\s+(?:\w+\s+)?eat\s+(?:much|a\s+lot|all|hardly)/i, amount: 'little' },
	{ re: /(?:hardly|barely)\s+(?:ate|touched)/i, amount: 'little' },
	{ re: /did(?:n'?t| not)\s+(?:really\s+|want\s+to\s+)?(?:eat|finish|touch)/i, amount: 'none' },
	{ re: /would(?:n'?t| not)\s+eat/i, amount: 'none' },
	{ re: /(?:has|have|had)(?:n'?t| not)\s+eaten/i, amount: 'none' },
	{ re: /ate\s+(?:about\s+|around\s+)?half/i, amount: 'half' },
	{ re: /ate\s+most/i, amount: 'most' },
	{ re: /ate\s+(?:a\s+)?(?:little|bit|few|some)\b(?:\s+bites?)?/i, amount: 'little' },
	{ re: /ate\s+(?:it\s+)?all\b/i, amount: 'all' },
	{ re: /ate\s+(?:everything|their\s+food|his\s+food|her\s+food)/i, amount: 'all' },
	{ re: /\bfinished\b/i, amount: 'all' },
	// Bare verbs last: they are the fallback once every qualified form has missed.
	// A trailing "didnt" carries the meaning on its own — "Tasha thor Linda doug didnt".
	// Only at the end of a clause, though: mid-sentence it almost always belongs to a
	// different verb, and matching it turned "didn't drink water", "didn't handle him"
	// and "didn't get to it" into records of dogs refusing food.
	{ re: /\bdid(?:n'?t|nt)\b(?=\s*$|\s*[.,;•!?])/i, amount: 'none' },
	{ re: /\bate\b/i, amount: 'all' }
];

// Built once per call from the roster; a message is mostly ordinary prose and only
// the roster can tell "Buck" from "Bruno has bad poop".
const MEAL_AM = /\b(?:this\s+)?(?:morning|breakfast|am|a\.m\.)\b/i;
const MEAL_PM = /\b(?:this\s+)?(?:dinner|evening|tonight|pm|p\.m\.|supper)\b/i;
// The third feed of the day is its own slot in the schema. Without this, a note about
// it lands on the morning and contradicts whatever was already logged there.
const MEAL_SECOND = /\b(?:second|2nd)\s+meal\b/i;

const DO_NOT_FEED = /\b(?:do\s+not|don'?t)\s+feed\b\s*:?\s*/i;
const EVERYONE = /\b(?:everyone|every\s?body|every\s?one|all(?:\s+(?:the|of\s+the))?\s+dogs?)\b/i;

/** Sentence and bullet boundaries — staff separate thoughts with all of these. */
const SENTENCE_BREAK = /[.\n•!?;]|\s-\s/;

/** Index just past the nearest sentence boundary before `index`. */
function sentenceStart(text: string, index: number): number {
	const before = text.slice(0, index);
	let start = 0;
	for (const match of before.matchAll(new RegExp(SENTENCE_BREAK.source, 'g'))) {
		start = (match.index ?? 0) + match[0].length;
	}
	return start;
}

function normalizeForCompare(s: string): string {
	return s.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Pulls roster dogs out of a fragment, longest name first so "Frito Pie" is not read
 * as a dog called "Frito". Everything that is not a roster hit is discarded — these
 * fragments are full of prose ("threw it all up and has nasty poop") and guessing at
 * unknown capitalised words would manufacture dogs that do not exist.
 */
function namesIn(fragment: string, roster: Map<string, string>): string[] {
	const words = fragment.split(/[^A-Za-z'-]+/).filter(Boolean);
	const found: string[] = [];
	let i = 0;
	while (i < words.length) {
		let matched = false;
		for (let span = Math.min(3, words.length - i); span >= 1; span--) {
			const candidate = normalizeForCompare(words.slice(i, i + span).join(''));
			const hit = roster.get(candidate);
			if (hit) {
				found.push(hit);
				i += span;
				matched = true;
				break;
			}
		}
		if (!matched) i++;
	}
	return found;
}

/** First amount phrase at or after `from`, or null when the rest of the text has none. */
function nextAmount(text: string, from: number) {
	let best: { index: number; length: number; amount: AmountEaten } | null = null;
	for (const { re, amount } of AMOUNT_PATTERNS) {
		const scoped = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
		scoped.lastIndex = from;
		const match = scoped.exec(text);
		if (!match) continue;
		// Earliest wins; on a tie the longer phrase wins, which preserves the
		// specific-before-generic ordering above.
		if (!best || match.index < best.index || (match.index === best.index && match[0].length > best.length)) {
			best = { index: match.index, length: match[0].length, amount };
		}
	}
	return best;
}

/**
 * The names staff type are not always the names ASM stores. A renamed dog is recorded
 * as "Nova (Newsie)" and the chat only ever says "Newsie"; a formal name like "Duke of
 * Earl" is only ever "Duke". Indexing just the stored string loses those dogs entirely
 * — "Newsie" was the second most-discussed dog in the channel and matched nothing.
 *
 * Every alias maps back to the canonical roster name, so callers still get one
 * consistent identity to write against.
 */
function aliasesFor(name: string): string[] {
	const aliases = [name];
	const parenthetical = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
	if (parenthetical) {
		aliases.push(parenthetical[1], parenthetical[2]);
	}
	// "Duke of Earl" → "Duke". Two characters is too short to be distinctive.
	const base = (parenthetical ? parenthetical[1] : name).trim();
	const firstWord = base.split(/\s+/)[0];
	if (base.includes(' ') && firstWord.length >= 3) aliases.push(firstWord);
	return aliases;
}

export function parseFeedingMessage(
	rawText: string,
	knownDogNames: string[] = []
): ParsedFeedingMessage {
	// Phone keyboards autocorrect ' to ’, and "didn’t eat" then matches none of the
	// patterns below — the single largest source of silently dropped messages.
	const text = rawText.replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'");
	const roster = new Map<string, string>();
	for (const name of knownDogNames) {
		for (const alias of aliasesFor(name)) {
			const key = normalizeForCompare(alias);
			// First registration wins, so a full name beats another dog's derived alias.
			if (key && !roster.has(key)) roster.set(key, name);
		}
	}

	const doNotFeed: string[] = [];
	let working = text;

	// Strip "do not feed: A, B, C" before anything else — it names dogs next to feeding
	// words and would otherwise be read as a record of them not eating.
	const directive = DO_NOT_FEED.exec(working);
	if (directive) {
		const after = working.slice(directive.index + directive[0].length);
		// The list runs to the end of its sentence or line.
		const list = after.split(/[.\n•]/)[0];
		doNotFeed.push(...namesIn(list, roster));
		working = working.slice(0, directive.index) + ' ' + after.slice(list.length);
	}

	const entries: ParsedFeedingEntry[] = [];
	const claimed = new Set<string>();
	const push = (name: string, amountEaten: AmountEaten) => {
		if (claimed.has(name)) return; // first statement about a dog wins
		claimed.add(name);
		entries.push({ name, amountEaten });
	};

	// "Everyone ate except X and Y" — handle before the general scan, which would read
	// the "ate" as belonging to whatever preceded it.
	let allAte = false;
	const everyoneMatch = EVERYONE.exec(working);
	if (everyoneMatch) {
		const after = working.slice(everyoneMatch.index);
		if (/^\W*\w*\s*(?:ate|eat|fed|were\s+fed)/i.test(after.slice(everyoneMatch[0].length)) || /\bate\b/i.test(after.split(/[.\n•]/)[0])) {
			allAte = true;
			const except = /\bexcept\b|\bbut\s+(?:not\s+)?|\bother\s+than\b/i.exec(after);
			if (except) {
				const tail = after.slice(except.index + except[0].length).split(/[.\n•]/)[0];
				for (const name of namesIn(tail, roster)) push(name, 'none');
				// Remove the handled clause so the scan below does not re-read it.
				working = working.slice(0, everyoneMatch.index);
			}
		}
	}

	// Scan verb-phrase by verb-phrase, attributing the names between the previous phrase
	// and this one. Staff routinely write without punctuation — "River uno ate half Tasha
	// thor Linda doug didnt" — so clause splitting on commas alone loses half the dogs.
	const hits: { index: number; end: number; amount: AmountEaten; colonLed: boolean }[] = [];
	for (let from = 0; ; ) {
		const hit = nextAmount(working, from);
		if (!hit) break;
		const end = hit.index + hit.length;
		// "Didn't eat: Nala, Buck   Ate half: Daffodil, Dot" — a colon turns the phrase
		// into a heading and its dogs follow it. Read as subject-first this parses exactly
		// backwards, handing each list to the wrong verb.
		hits.push({ index: hit.index, end, amount: hit.amount, colonLed: /^\s*:/.test(working.slice(end)) });
		from = end;
	}

	let lastAmount: AmountEaten | null = null;
	let lastPhraseHadNames = false;
	let cursor = 0;
	for (const [i, hit] of hits.entries()) {
		let names: string[];
		if (hit.colonLed) {
			// Its list runs to the next verb phrase, or to the end.
			const stop = hits[i + 1]?.index ?? working.length;
			names = namesIn(working.slice(hit.end, stop), roster);
			cursor = stop;
		} else {
			// A dog belongs to a verb only within the same sentence. Scanning back to the
			// previous verb instead swept up whole paragraphs: "Stony is currently in time
			// out for day trips … stuffed toys were in the dryer …" tagged nine dogs as
			// having refused food because a feeding word appeared later in the message.
			const windowStart = Math.max(cursor, sentenceStart(working, hit.index));
			names = namesIn(working.slice(windowStart, hit.index), roster);
			cursor = hit.end;
		}
		for (const name of names) push(name, hit.amount);
		lastAmount = hit.amount;
		lastPhraseHadNames = names.length > 0;
	}

	// Subject-after-verb: "Only dog that didn't eat this morning was Buck". Restricted to
	// the same sentence, and only when the verb found no subject before it — otherwise a
	// following sentence gets swept in, and "…didn't eat. Cora threw it all up and has
	// nasty poop." records Cora as refusing a meal the message never mentions.
	if (lastAmount && !lastPhraseHadNames && cursor < working.length) {
		const sameSentence = working.slice(cursor).split(SENTENCE_BREAK)[0];
		for (const name of namesIn(sameSentence, roster)) push(name, lastAmount);
	}

	// Checked first: "second meal" also contains no am/pm cue, but a message can mention
	// both ("didn't eat this morning, ate half of second meal") and the specific wins.
	const mealTime: MealTime | null = MEAL_SECOND.test(text)
		? 'second'
		: MEAL_AM.test(text)
			? 'am'
			: MEAL_PM.test(text)
				? 'pm'
				: null;

	return { entries, allAte, doNotFeed, mealTime };
}
