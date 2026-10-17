/**
 * Reads one-on-one reports out of shelter chat: "spent time with Miles", "spent some
 * time with Rex and Luna today", "spent 20 min with Sheba". One-on-one is enrichment,
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

const MINUTES = /\b(\d{1,3})\s*(?:min|mins|minutes)\b/i;
const HOURS = /\b(\d|an?)\s*(?:hour|hours|hr|hrs)\b/i;

function durationIn(text: string): number | null {
	const minutes = MINUTES.exec(text);
	if (minutes) return Number(minutes[1]);
	const hours = HOURS.exec(text);
	if (hours) return /^an?$/i.test(hours[1]) ? 60 : Number(hours[1]) * 60;
	return null;
}

export function parseOneOnOneMessage(text: string, knownDogNames: string[] = []): ParsedOneOnOneMessage {
	const empty = { dogNames: [], durationMinutes: null };
	const match = SPENT_WITH.exec(text);
	if (!match || text.includes('?')) return empty;

	// Only the sentence the report is in: "Rex barked all day. Spent time with Luna" is Luna.
	const start = Math.max(...['.', '!', '\n'].map((p) => text.lastIndexOf(p, match.index))) + 1;
	const before = text.slice(start, match.index);
	if (NEGATED.test(before) || NOT_A_REPORT.test(before)) return empty;

	const fragment = text.slice(match.index + match[0].length).split(/[.!;\n]/)[0];
	const dogNames = namesIn(fragment, buildRoster(knownDogNames));
	if (dogNames.length === 0) return empty;
	return { dogNames, durationMinutes: durationIn(match[1]) ?? durationIn(fragment) };
}
