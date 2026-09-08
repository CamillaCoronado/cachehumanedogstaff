/**
 * Reads yard-time reports out of shelter chat.
 *
 * Yard time is one of the three things that count as enrichment, alongside day trips and
 * playgroups, and it is the only one with no path into the app except by hand. It gets
 * reported as a bare list — "Stragler pickles zinnia junior sally Ann got yard time" —
 * or as a blanket over the whole shelter.
 */

export interface ParsedYardMessage {
	/** Dogs the message says got yard time. */
	dogNames: string[];
	/** The message covers the whole shelter: "All dogs got yard time". */
	allDogs: boolean;
	/** From "15 min in the yard", when stated. */
	durationMinutes: number | null;
	/** The message says yard time did *not* happen. */
	negated: boolean;
	/** Dogs excluded from a blanket: "all dogs went out except for punch". */
	exceptNames: string[];
}

/** The activity itself, however it is spelled. "tine" is a real and frequent typo. */
const YARD_TIME = /\byard\s*(?:time|tine|tim)\b|\bin\s+the\s+yards?\b/i;

/**
 * The other way it gets said, without naming the yard at all: "all dogs went out",
 * "Bagel, Skittles, Phantom went out solo", "Everyone got out today", "had a chance to
 * go out".
 */
const WENT_OUT =
	/\b(?:went|got|were|was|been|taken|took)\s+out(?:side)?\b|\bchance\s+to\s+go\s+out\b/i;

/**
 * A dog getting out of its kennel is an escape, not enrichment — "Caira got out of her
 * outside kennel twice this morning", "Blue got out of his inside kennel", "Hattie got
 * out earlier and her gate was still latched". Logging those as time in the yard would
 * record the worst days as enrichment.
 */
const ESCAPED =
	/\bout\s+of\s+(?:the\s+|h(?:er|is)\s+|their\s+)?(?:outside\s+|inside\s+|back\s+)?(?:kennel|gate|canal|run|crate)\b|\bgate\s+was\s+still\s+latched\b/i;

/** Dogs left out of a blanket: "all dogs went out except for punch". */
const EXCEPT = /\bexcept\s+(?:for\s+)?|\bbut\s+(?:not\s+)?|\bother\s+than\s+/i;

/**
 * A report that it happened. Subject-first ("… got yard time") is the common form; the
 * terse version drops the verb entirely ("Mya Freda shorty roe ann dot zane yard time").
 */
const HAPPENED = /\b(?:got|get|had|have|has|were|was|took|taken|gave)\b/i;

/**
 * The inverse, which reads almost identically: "No dogs got yard time, second shift will
 * have to do that". Missing this would mark the whole shelter as enriched on a day
 * nobody went out.
 */
const NEGATED =
	/\bno\s+(?:dogs?|one)\s+(?:got|get|had|have)\b|\bdid\s*n'?t\s+(?:get|have)\b|\bnobody\s+got\b|\bnone\s+(?:got|of)\b/i;

/**
 * Instructions and observations about the yard, which are not reports that a dog was in
 * it: "do not leave ace unattended in yard", "Luna opens up when you take her to the
 * yards", "Jack is terrified … in the meet and greet yard".
 */
const NOT_A_REPORT =
	/\bdo\s*n'?t\s+leave\b|\bdo\s+not\s+leave\b|\bwhen\s+you\b|\bmake\s+sure\b|\bneeds?\s+to\b|\bwill\s+have\s+to\b|\bshould\b|\bcan\s+be\b|\bis\s+terrified\b|\bcould\s+take\s+out\b|\bbed\s+rest\b|\btake\s+out\s+for\b/i;

/**
 * The whole shelter at once. One adjective is allowed through — "all adult dogs", "all
 * healthy dogs" — but not a possessive: "all 3 of my dogs have been sick" is somebody
 * talking about their own dogs at home.
 */
const ALL_DOGS =
	/\ball\s+(?:the\s+)?(?!my\b|your\b|his\b|her\b|their\b|our\b)(?:\w+\s+)?dogs?\b|\bevery\s?(?:one|body)\b|\bevery\s+dog\b|\ball\s+of\s+(?:the\s+)?dogs?\b/i;

const DURATION = /\b(\d{1,3})\s*(?:min|mins|minutes)\b/i;

function normalizeForCompare(value: string): string {
	return value.toLowerCase().replace(/[^a-z]/g, '');
}

/** Same alias expansion the other parsers use: nicknames, first words, initials. */
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

export function parseYardMessage(text: string, knownDogNames: string[] = []): ParsedYardMessage {
	const empty = { dogNames: [], allDogs: false, durationMinutes: null, negated: false, exceptNames: [] };

	// Named the yard, or just said the dogs went out.
	const marker = YARD_TIME.exec(text) ?? WENT_OUT.exec(text);
	if (!marker) return empty;

	// A dog out of its kennel is an escape; the day it happened is not enrichment.
	if (ESCAPED.test(text)) return empty;
	if (NEGATED.test(text)) return { ...empty, negated: true };
	if (NOT_A_REPORT.test(text) || text.includes('?')) return empty;

	const duration = DURATION.exec(text);
	const durationMinutes = duration ? Number(duration[1]) : null;
	const roster = buildRoster(knownDogNames);

	// A blanket covers the shelter, so no name list is needed or expected — but it may
	// still carve dogs out: "all dogs went out except for punch".
	if (ALL_DOGS.test(text.slice(0, marker.index + marker[0].length))) {
		const except = EXCEPT.exec(text.slice(marker.index));
		const exceptNames = except
			? namesIn(text.slice(marker.index + except.index + except[0].length), roster)
			: [];
		return { dogNames: [], allDogs: true, durationMinutes, negated: false, exceptNames };
	}

	// The dogs are named before the activity, whether or not a verb comes between —
	// "… sally Ann got yard time" and "… zane paisley junior yard time" both work.
	const before = text.slice(0, marker.index);
	const dogNames = namesIn(before, roster);

	// A verb is not required, but without one and without any dog named this is prose
	// that happens to mention the yard.
	if (dogNames.length === 0 && !HAPPENED.test(before)) return empty;

	return { dogNames, allDogs: false, durationMinutes, negated: false, exceptNames: [] };
}
