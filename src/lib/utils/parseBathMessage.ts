/**
 * Reads bath reports out of shelter chat.
 *
 * Baths are written far more plainly than feedings — "Roe got a bath", "Hattie and dot
 * got baths" — so the work here is mostly in not reading the many messages that mention
 * a bath without one having happened: dogs that need one, questions about whether one
 * was given, and plans for later.
 */

export interface ParsedBathMessage {
	/** Dogs the message says were bathed, in the order named. */
	dogNames: string[];
	/** Whole days before the message date, from "yesterday". Baths are reported late. */
	daysAgo: number;
	/** Set when the message names a bath that has not happened, so a caller can skip it. */
	notYet: boolean;
}

/**
 * A bath that happened, and the text that names the dogs.
 *
 * Two shapes: the dogs come first ("Hattie and dot got baths", "Madonna was bathed"), or
 * the verb comes first and the dogs follow ("I gave whoogie a bath", "we bathed Koda").
 */
const SUBJECT_FIRST =
	// The words between the verb and "bath" vary too much to list — "got flea and tic
	// baths", "have gotten flea and tick baths", "got her medicated bath" — so allow a
	// short run of anything rather than enumerating the kinds of bath.
	/\b(?:got|gotten|get|had|have|has|was|were|been)\s+(?:\w+[\s/]+){0,4}?(?:baths?|bathed)\b/i;
const VERB_FIRST = /\b(?:gave|give|giving|bathed|bathing|washed)\b/i;
/** "Baths Roomba and Toby" — the word alone, heading a list. */
const BATH_HEADING = /^\s*baths?\s*:?\s+/i;
/**
 * "birdie bath", "archer bath" — a name and the bare word, which is how a bath gets
 * noted when someone is working through the kennels.
 */
const TERSE = /^[\sA-Za-z'-]{2,40}\s+baths?\s*$/i;

/**
 * Mentions of a bath that has not happened. Checked before anything else, because these
 * outnumber the reports: "Ace, Canyon, and Yukon could use baths", "he needs a bath",
 * "will need bathing", "Did Koda get bathed?".
 */
const NOT_YET =
	/\b(?:could\s+use|needs?\s+(?:to\s+get\s+)?|need\s+(?:to\s+get\s+)?|will\s+need|should\s+(?:get|have)|has\s+to\s+get|hold\s+off|planning|going\s+to|gonna|want(?:s|ed)?\s+to)\b/i;

/** A question is asking whether a bath happened, not reporting that one did. */
const QUESTION = /\?/;

/**
 * Things that get washed but are not dogs. "I washed and refilled the adult dog food
 * bucket" mentions dogs and washing and is not a bath.
 */
const NOT_A_DOG =
	/\b(?:bucket|buckets|bowl|bowls|dish|dishes|laundry|blanket|blankets|towel|towels|bedding|kennel|kennels|floor|floors|wall|walls|toy|toys)\b/i;

const YESTERDAY = /\byesterday\b/i;

/** Any mention of a bath at all, whether or not one happened. */
const MENTIONS_BATH = /\bbaths?\b|\bbath(?:ed|ing)\b|\bbathe\b/i;

function normalizeForCompare(value: string): string {
	return value.toLowerCase().replace(/[^a-z]/g, '');
}

/** Same alias expansion the feeding parser uses: nicknames, first words, initials. */
function aliasesFor(name: string): { canonical: string[]; derived: string[] } {
	const parenthetical = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
	const base = (parenthetical ? parenthetical[1] : name).trim();
	const canonical = [name, base];
	const derived: string[] = [];
	if (parenthetical) derived.push(parenthetical[2]);
	if (base.includes(' ')) {
		const words = base.split(/\s+/);
		if (words[0].length >= 3) derived.push(words[0]);
		const initials = words.map((w) => w[0]).join('');
		if (initials.length >= 2) derived.push(initials);
	}
	return { canonical, derived };
}

function buildRoster(knownDogNames: string[]): Map<string, string> {
	const roster = new Map<string, string>();
	const all = knownDogNames.map((name) => ({ name, ...aliasesFor(name) }));
	// Canonical names first, so a derived alias never displaces a real dog of that name.
	for (const { name, canonical } of all) {
		for (const alias of canonical) {
			const key = normalizeForCompare(alias);
			if (key && !roster.has(key)) roster.set(key, name);
		}
	}
	for (const { name, derived } of all) {
		for (const alias of derived) {
			const key = normalizeForCompare(alias);
			if (key && !roster.has(key)) roster.set(key, name);
		}
	}
	return roster;
}

/** Roster dogs named in a fragment, longest name first so "Bento Box" is not "Bento". */
function namesIn(fragment: string, roster: Map<string, string>): string[] {
	const words = fragment.split(/[^A-Za-z'-]+/).filter(Boolean);
	const found: string[] = [];
	let i = 0;
	while (i < words.length) {
		let matched = false;
		for (let span = Math.min(3, words.length - i); span >= 1; span--) {
			const hit = roster.get(normalizeForCompare(words.slice(i, i + span).join('')));
			if (hit) {
				if (!found.includes(hit)) found.push(hit);
				i += span;
				matched = true;
				break;
			}
		}
		if (!matched) i++;
	}
	return found;
}

export function parseBathMessage(text: string, knownDogNames: string[] = []): ParsedBathMessage {
	const empty = { dogNames: [], daysAgo: 0, notYet: false };
	if (!MENTIONS_BATH.test(text) || NOT_A_DOG.test(text)) return empty;

	// Checked before looking for a verb: "could use baths" and "will need baths" name no
	// verb at all, and these outnumber the actual reports in the channel.
	if (NOT_YET.test(text) || QUESTION.test(text)) return { ...empty, notYet: true };

	const roster = buildRoster(knownDogNames);

	// "birdie bath" — the whole message is a name and the word, so the name is all of it.
	if (TERSE.test(text)) {
		return { dogNames: namesIn(text, roster), daysAgo: YESTERDAY.test(text) ? 1 : 0, notYet: false };
	}

	// "Baths Roomba and Toby." — the word heads the list rather than following it.
	const heading = BATH_HEADING.exec(text);
	if (heading) {
		return {
			dogNames: namesIn(text.slice(heading[0].length), roster),
			daysAgo: YESTERDAY.test(text) ? 1 : 0,
			notYet: false
		};
	}

	const subject = SUBJECT_FIRST.exec(text);
	const verb = subject ? null : VERB_FIRST.exec(text);
	const marker = subject ?? verb;
	if (!marker) return empty;
	// Subject-first names the dogs before the verb. Verb-first usually names them after,
	// but not always — "Spaghetti and meatballs I gave them fle baths" puts them first —
	// so fall back to the other side rather than losing the report.
	const before = text.slice(0, marker.index);
	const after = text.slice(marker.index + marker[0].length);
	const dogNames = subject
		? namesIn(before, roster)
		: namesIn(after, roster).length > 0
			? namesIn(after, roster)
			: namesIn(before, roster);
	// A report with no recognisable dog is usually about a group — "all the transfer
	// dogs got baths" — which only a caller holding the groups can expand.
	return { dogNames, daysAgo: YESTERDAY.test(text) ? 1 : 0, notYet: false };
}
