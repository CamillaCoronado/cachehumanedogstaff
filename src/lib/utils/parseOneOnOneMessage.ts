/**
 * Reads one-on-one reports out of shelter chat: "spent time with Miles", "spent some
 * time with Rex and Luna today", "spent 20 min with Sheba", "10 min cuddling/petting her". One-on-one is enrichment,
 * like the yard, and is said one way often enough to read on its own.
 *
 * The dogs come after "with", up to the end of that sentence. Past tense only, so
 * "can someone spend time with Miles" and "Rex needs someone to spend time with him"
 * are not reports.
 */

import { buildRoster, namesIn } from './parseYardMessage';

export interface ParsedOneOnOneMessage {
	/** Dogs the message says someone spent time with. */
	dogNames: string[];
	/** From "spent 20 min with", when stated. */
	durationMinutes: number | null;
}

/**
 * "spent time with", with anything short between: "spent some quality time with",
 * "spent 20 minutes with", "spent the afternoon with". Never across a sentence.
 */
const SPENT_WITH = /\bspent\b([^.!?\n]{0,40}?)\bwith\b/i;

/** "haven't spent time with Rex", "nobody has spent time with Luna". */
const NEGATED = /n['’]t\b|\b(?:havent|hasnt|hadnt|not|never|nobody|no\s*one)\b/i;

/** Asks and instructions, not reports. */
const NOT_A_REPORT = /\bneeds?\b|\bshould\b|\bplease\b|\bcan\s+(?:some|any)one\b|\bif\s+you\b/i;

// "10im" is a real typo for "10 min".
const MINUTES = /\b(\d{1,3})\s*(?:min|mins|minutes|im|m)\b/i;
const HOURS = /\b(\d|an?)\s*(?:hour|hours|hr|hrs)\b/i;

function durationIn(text: string): number | null {
	const minutes = MINUTES.exec(text);
	if (minutes) return Number(minutes[1]);
	const hours = HOURS.exec(text);
	if (hours) return /^an?$/i.test(hours[1]) ? 60 : Number(hours[1]) * 60;
	return null;
}

/**
 * The other way it gets reported: "10 min cuddling/petting her calmed her down a lot",
 * "cuddled with Rex". Past or ongoing forms only, so "Jade needs cuddles" and "loves to
 * cuddle" are not reports.
 */
const CUDDLED = /\b(?:cuddl(?:ed|ing)|pett(?:ed|ing)|snuggl(?:ed|ing))\b/i;

/** Liking it is not getting it: "Rex loves cuddling". */
const LIKES = /\b(?:loves?|likes?|enjoys?|wants?|wanted|would)\b/i;

/** "cuddling her": the dog is the one the message is already about. */
const PRONOUN = /^\s*(?:\/\s*\w+\s+)?(?:with\s+)?(?:her|him|them)\b/i;

function sentenceStartBefore(text: string, index: number): number {
	return Math.max(...['.', '!', '\n'].map((p) => text.lastIndexOf(p, index - 1))) + 1;
}

export function parseOneOnOneMessage(text: string, knownDogNames: string[] = []): ParsedOneOnOneMessage {
	const empty = { dogNames: [], durationMinutes: null };
	if (text.includes('?')) return empty;
	const roster = buildRoster(knownDogNames);

	const spent = SPENT_WITH.exec(text);
	if (spent) {
		// Only the sentence the report is in: "Rex barked all day. Spent time with Luna" is Luna.
		const before = text.slice(sentenceStartBefore(text, spent.index), spent.index);
		if (NEGATED.test(before) || NOT_A_REPORT.test(before)) return empty;
		const fragment = text.slice(spent.index + spent[0].length).split(/[.!;\n]/)[0];
		const dogNames = namesIn(fragment, roster);
		if (dogNames.length === 0) return empty;
		return { dogNames, durationMinutes: durationIn(spent[1]) ?? durationIn(fragment) };
	}

	const cuddled = CUDDLED.exec(text);
	if (!cuddled) return empty;
	const before = text.slice(sentenceStartBefore(text, cuddled.index), cuddled.index);
	if (NEGATED.test(before) || NOT_A_REPORT.test(before) || LIKES.test(before)) return empty;
	const after = text.slice(cuddled.index + cuddled[0].length).split(/[.!;\n]/)[0];

	// The dog after the verb ("cuddled Rex"), else before it in the same sentence ("Rex got
	// cuddled"), else — for "cuddling her" — the one dog the message names.
	let dogNames = namesIn(after, roster);
	if (dogNames.length === 0) dogNames = namesIn(before, roster);
	if (dogNames.length === 0 && PRONOUN.test(after)) {
		const named = namesIn(text, roster);
		if (named.length === 1) dogNames = named;
	}
	if (dogNames.length === 0) return empty;
	return { dogNames, durationMinutes: durationIn(before) ?? durationIn(after) };
}
