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
	/**
	 * Whether that instruction is the morning surgery list rather than a note about how
	 * to feed. "Anne and Leslie DO NOT FEED TOGETHER" names two dogs that very much are
	 * being fed, just not beside each other.
	 */
	isSurgeryList: boolean;
	/** Only set when the message says so; inferring from post time is the caller's call. */
	mealTime: MealTime | null;
	/**
	 * Whether this reads as the shift's feeding round-up rather than a passing remark.
	 *
	 * It matters because a round-up reports only exceptions — everyone unnamed ate — so a
	 * caller may fill the rest of the shelter in. "Bodhi didn't eat much, but he did have
	 * a solid poop" says nothing about the other eighty dogs, and treating it as a
	 * round-up would invent eighty meals from one aside.
	 */
	looksLikeReport: boolean;
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
	{ re: /\b(?:ate|eat)\s+(?:about\s+|around\s+)?(?:half|1\/2)/i, amount: 'half' },
	// "ate about 1/4" is a real and common way to write it.
	{ re: /\bate\s+(?:about\s+|around\s+)?(?:1\/4|1\/3|a\s+quarter|a\s+third)/i, amount: 'little' },
	// Food on the floor is food not eaten, whatever the quantity word attached to it.
	{ re: /spill(?:ed|t)?\s+(?:most|all|it|some|his|her|their)/i, amount: 'little' },
	{ re: /\b(?:ate|eat)\s+most/i, amount: 'most' },
	{ re: /\b(?:ate|eat)\s+(?:a\s+)?(?:little|bit|few|some)\b(?:\s+bites?)?/i, amount: 'little' },
	{ re: /\b(?:ate|eat)\s+(?:it\s+)?all\b/i, amount: 'all' },
	{ re: /\b(?:ate|eat)\s+(?:everything|there\s+food|their\s+food|his\s+food|her\s+food)/i, amount: 'all' },
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
/**
 * Which feed a report is about is normally derived from when it was posted — staff do
 * not label it, because at the time it is obvious. The exception is a morning feed
 * reported late, which says "morning" precisely because it no longer is.
 *
 * There is deliberately no PM pattern. "dinner", "tonight" and "this evening" turn up
 * constantly as ordinary narration ("Duke was defensive this morning", "clinic will see
 * him tonight") and reading them as meal designations mislabels far more than it fixes.
 */
const MEAL_AM = /\b(?:this\s+)?(?:morning|breakfast)\b/i;
// The third feed of the day is its own slot in the schema. Without this, a note about
// it lands on the morning and contradicts whatever was already logged there.
const MEAL_SECOND = /\b(?:second|2nd)\s+meal\b/i;

const DO_NOT_FEED = /\b(?:do\s+not|don'?t)\s+feed\b\s*:?\s*/i;
/** "do not feed X together" is about seating, not surgery. */
const FEEDING_ARRANGEMENT = /\b(?:together|separately|side\s+by\s+side|near\s+each\s+other|in\s+the\s+same)\b/i;
/** Things a dog can eat that are not a meal. "she ate most of rubber bone" is not a feed. */
const NOT_FOOD = /^\s*of\s+(?:a\s+|the\s+|his\s+|her\s+)?(?:rubber\s+|hard\s+|chew\s+)?(?:bone|bones|toy|toys|kong|stuffing|blanket|towel|leash|poop|grass|sock)/i;
/** "won't do second meal" is a plan for a meal that will not happen, not a report of one. */
const SECOND_NEGATED = /\b(?:no|won'?t|wont|not)\s+(?:do\s+|doing\s+|give\s+|giving\s+)?(?:a\s+)?(?:second|2nd)\s+meal\b/i;
const EVERYONE =
	/\b(?:everyone|every\s?body|every\s?one|all(?:\s+(?:the|of\s+the))?\s+dogs?|all\s+(?:the\s+)?others?|the\s+rest)\b/i;
/** "…every body else did", "everyone else finished" — the rest are accounted for outright. */
const EVERYONE_ELSE = /\b(?:every\s?(?:one|body)|all)\s+else\b|\belse\s+(?:did|ate|finished)\b/i;
/**
 * A round-up is terse: names and amounts, little else. Past roughly ten words a dog it
 * is prose that happens to mention eating.
 */
const MAX_WORDS_PER_DOG = 10;

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

/**
 * Words that turn up constantly in these messages and are one letter away from being
 * plausible dog names. Without this guard "eaten" finds an Eaton and "water" a Walter.
 */
const NEVER_A_NAME = new Set([
	// Feeding and care vocabulary
	'eaten', 'eating', 'water', 'meal', 'meals', 'treat', 'treats', 'kennel', 'kennels',
	'morning', 'second', 'little', 'bowls', 'bowl', 'crate', 'blood', 'bland', 'stool',
	'stools', 'poops', 'pooped', 'vomit', 'vomited', 'diarrhea', 'kibble', 'breakfast',
	'dinner', 'puppy', 'puppies', 'walked', 'walking', 'leash', 'leashed', 'cleaned',
	'cleaning', 'cleared', 'sprayed', 'bathed', 'muzzle', 'solid', 'runny', 'picky',
	'chunks', 'bites', 'teeth', 'lethargic', 'surgery', 'clinic', 'foster', 'adopted',
	// Ordinary prose that happens to sit one edit from a name
	'today', 'night', 'threw', 'other', 'their', 'there', 'those', 'these', 'still',
	'about', 'after', 'before', 'again', 'didnt', 'doesnt', 'wasnt', 'hasnt', 'seems',
	'would', 'could', 'should', 'think', 'thing', 'things', 'first', 'mixed', 'weird',
	'happy', 'being', 'every', 'everyone', 'everybody', 'something', 'whenever',
	'excellent', 'evening', 'tonight', 'outside', 'inside', 'weather', 'allow', 'photos',
	'doctor', 'hectic', 'sorry', 'looked', 'looks', 'small', 'large'
]);

/**
 * Edit distance, capped. Two edits are only safe on a long word — "scrunchy" for
 * Scrunchie — where the remaining letters still pin the name down; on a short one two
 * edits reach half the roster.
 */
function withinEdits(a: string, b: string, max: number): boolean {
	if (Math.abs(a.length - b.length) > max) return false;
	const prev = new Array(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0];
		prev[0] = i;
		let best = prev[0];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const val = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
			diag = prev[j];
			prev[j] = val;
			if (val < best) best = val;
		}
		if (best > max) return false; // whole row already past the cap
	}
	return prev[b.length] <= max;
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
/** The last word before `index`, so a guard can see across a fragment boundary. */
function wordBefore(text: string, index: number): string {
	const before = text.slice(0, index).match(/([A-Za-z'-]+)[^A-Za-z'-]*$/);
	return before ? before[1] : '';
}

function namesIn(
	fragment: string,
	roster: Map<string, string>,
	derivedKeys: Set<string>,
	precedingWord = ''
): string[] {
	const words = fragment.split(/[^A-Za-z'-]+/).filter(Boolean);
	const found: string[] = [];
	let i = 0;
	while (i < words.length) {
		let matched = false;
		for (let span = Math.min(3, words.length - i); span >= 1; span--) {
			const candidate = normalizeForCompare(words.slice(i, i + span).join(''));
			const hit = roster.get(candidate);
			if (hit) {
				// "Roe spilled most of his Ace" is his food, not the dog Ace is the Place.
				// Only a derived alias is vulnerable to this; a full name is not.
				// Staff break lines mid-sentence — "spilled most of his\n\nAce" — so the
				// possessive can sit outside this fragment entirely.
				const prior = i > 0 ? words[i - 1] : precedingWord;
				const preceded = POSSESSIVE.has(prior.toLowerCase());
				if (preceded && derivedKeys.has(candidate)) {
					i += span;
					matched = true;
					break;
				}
				found.push(hit);
				i += span;
				matched = true;
				break;
			}
		}
		if (!matched) {
			// Names get typed fast and wrong — "stragler" for Straggler drops a real dog.
			// Only single words, only long ones, only one edit away, and only when exactly
			// one roster name is that close: two candidates means guessing which dog.
			const word = normalizeForCompare(words[i]);
			if (word.length >= 5 && !NEVER_A_NAME.has(word) && !roster.has(word)) {
				const max = word.length >= 7 ? 2 : 1;
				// Nearest first: an exact-ish match should not be blocked by a looser one.
				for (let d = 1; d <= max; d++) {
					const near = new Map<string, number>(); // name -> its key length
					for (const [key, name] of roster) {
						// Canonical names only. A derived alias is already a guess about what
						// someone might type, and fuzzy-matching one compounds the guess —
						// "Freda" tied between Frida and Dot (Freya)'s alias.
						if (derivedKeys.has(key)) continue;
						if (withinEdits(word, key, d)) near.set(name, key.length);
					}
					if (near.size === 0) continue;
					let candidates = [...near];
					// A typo usually keeps the length — "Freda" for Frida rather than for
					// Fred, both one edit away. Same-length candidates win the tie.
					if (candidates.length > 1) {
						const sameLength = candidates.filter(([, len]) => len === word.length);
						if (sameLength.length === 1) candidates = sameLength;
					}
					if (candidates.length === 1) { found.push(candidates[0][0]); }
					break; // resolved or genuinely ambiguous; a looser pass will not help
				}
			}
			// A fuzzy hit consumes exactly the one word it matched, same as a miss.
			i++;
		}
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
function aliasesFor(name: string): { canonical: string[]; derived: string[] } {
	const parenthetical = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
	const base = (parenthetical ? parenthetical[1] : name).trim();
	// The name as written, and the part before any parenthetical, are what this dog is
	// actually called. Everything else is a guess about what someone might type.
	const canonical = [name, base];
	const derived: string[] = [];
	if (parenthetical) derived.push(parenthetical[2]);
	if (base.includes(' ')) {
		const words = base.split(/\s+/);
		// "Duke of Earl" is only ever "Duke".
		if (words[0].length >= 3) derived.push(words[0]);
		// "Mary Jane" is written "MJ" as often as not.
		const initials = words.filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).join('');
		if (initials.length >= 2) derived.push(initials);
	}
	return { canonical, derived };
}

/**
 * Two passes, because a derived alias must never outrank a real dog's own name. "Dot
 * (Freya)" yields "Freya" as a guess, and the shelter also has a dog actually called
 * Freya — registering in document order handed her meals to Dot.
 */
function buildRoster(knownDogNames: string[]): { roster: Map<string, string>; derivedKeys: Set<string> } {
	const roster = new Map<string, string>();
	const derivedKeys = new Set<string>();
	const all = knownDogNames.map((name) => ({ name, ...aliasesFor(name) }));
	for (const { name, canonical } of all) {
		for (const alias of canonical) {
			const key = normalizeForCompare(alias);
			if (key && !roster.has(key)) roster.set(key, name);
		}
	}
	for (const { name, derived } of all) {
		for (const alias of derived) {
			const key = normalizeForCompare(alias);
			if (key && !roster.has(key)) {
				roster.set(key, name);
				derivedKeys.add(key);
			}
		}
	}
	return { roster, derivedKeys };
}

/** "his Ace", "her bone" — a possessive before a word means a thing, not a dog. */
const POSSESSIVE = new Set(['his', 'her', 'their', 'its', 'my', 'our', 'the']);

export function parseFeedingMessage(
	rawText: string,
	knownDogNames: string[] = []
): ParsedFeedingMessage {
	// Phone keyboards autocorrect ' to ’, and "didn’t eat" then matches none of the
	// patterns below — the single largest source of silently dropped messages.
	const text = rawText.replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'");
	const { roster, derivedKeys } = buildRoster(knownDogNames);

	const doNotFeed: string[] = [];
	let working = text;

	// Strip "do not feed: A, B, C" before anything else — it names dogs next to feeding
	// words and would otherwise be read as a record of them not eating.
	let isSurgeryList = false;
	const directive = DO_NOT_FEED.exec(working);
	if (directive) {
		const after = working.slice(directive.index + directive[0].length);
		// The list runs to the end of its sentence or line.
		const list = after.split(/[.\n•]/)[0];
		doNotFeed.push(...namesIn(list, roster, derivedKeys));
		// A instruction about how to feed is not a surgery list, even though it is worded
		// the same way — those dogs are being fed, just not next to each other.
		isSurgeryList = doNotFeed.length > 0 && !FEEDING_ARRANGEMENT.test(list);
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
				for (const name of namesIn(tail, roster, derivedKeys)) push(name, 'none');
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
		// "she ate most of rubber bone" is a chewed toy, not a meal.
		if (!NOT_FOOD.test(working.slice(end))) {
			hits.push({ index: hit.index, end, amount: hit.amount, colonLed: /^\s*:/.test(working.slice(end)) });
		}
		from = end;
	}

	const cursorAfter = (h: { end: number }) => h.end;
	// A name lifted off the end of a colon list, waiting for the verb it belongs to.
	let carried: string | null = null;
	let lastAmount: AmountEaten | null = null;
	let lastPhraseHadNames = false;
	let cursor = 0;
	for (const [i, hit] of hits.entries()) {
		let names: string[];
		if (hit.colonLed) {
			// Its list runs to the next verb phrase, or to the end.
			const stop = hits[i + 1]?.index ?? working.length;
			names = namesIn(working.slice(hit.end, stop), roster, derivedKeys, wordBefore(working, hit.end));
			// "Ate some: Rea, Shorty Straggler didn't eat" — the next verb has no colon and
			// no subject of its own, so the last name in this list is really its subject.
			const next = hits[i + 1];
			if (next && !next.colonLed && names.length > 1) {
				const between = working.slice(cursorAfter(hit), next.index);
				if (!/[.,;•!?\n]\s*$/.test(between)) carried = names.pop() ?? null;
			}
			cursor = stop;
		} else {
			// A dog belongs to a verb only within the same sentence. Scanning back to the
			// previous verb instead swept up whole paragraphs: "Stony is currently in time
			// out for day trips … stuffed toys were in the dryer …" tagged nine dogs as
			// having refused food because a feeding word appeared later in the message.
			const windowStart = Math.max(cursor, sentenceStart(working, hit.index));
			names = namesIn(working.slice(windowStart, hit.index), roster, derivedKeys, wordBefore(working, windowStart));
			cursor = hit.end;
		}
		if (carried && !hit.colonLed) {
			push(carried, hit.amount);
			names.unshift(carried);
			carried = null;
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
		for (const name of namesIn(sameSentence, roster, derivedKeys)) push(name, lastAmount);
	}

	// Checked first: a message can mention both ("didn't eat this morning, ate half of
	// second meal") and the more specific slot wins. Null means derive it.
	const mealTime: MealTime | null =
		MEAL_SECOND.test(text) && !SECOND_NEGATED.test(text)
			? 'second'
			: MEAL_AM.test(text)
				? 'am'
				: null;

	// Three ways a message reads as the round-up: it uses heading form ("Didn't eat: …"),
	// it says outright that everyone else ate, or it is a bare list of dogs and amounts.
	const wordCount = text.trim().split(/\s+/).length;
	const looksLikeReport =
		// "Everyone ate" is a complete report on its own — it names nobody because it does
		// not need to, and requiring a named dog dropped it entirely.
		allAte ||
		(entries.length > 0 &&
			(hits.some((h) => h.colonLed) ||
				EVERYONE_ELSE.test(text) ||
				(entries.length >= 2 && wordCount / entries.length <= MAX_WORDS_PER_DOG)));

	return { entries, allAte, doNotFeed, isSurgeryList, mealTime, looksLikeReport };
}
