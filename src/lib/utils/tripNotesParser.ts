import type { BehaviorRating } from '$lib/types';

export interface ParsedTrip {
	date: Date;
	tripNotes: string;
	reactionToKids: BehaviorRating | null;
	reactionToDogs: BehaviorRating | null;
	reactionToCats: BehaviorRating | null;
	reactionToStrangers: BehaviorRating | null;
	reactionToLeash: BehaviorRating | null;
	reactionToCarRides: BehaviorRating | null;
	reactionToToys: BehaviorRating | null;
}

const RATING_WORDS: Record<string, BehaviorRating> = {
	friendly: 'friendly',
	neutral: 'neutral',
	nervous: 'nervous',
	excited: 'excited',
	reactive: 'reactive',
};

const CATEGORY_PATTERNS: Array<{ keys: string[]; field: keyof Omit<ParsedTrip, 'date' | 'tripNotes'> }> = [
	{ keys: ['children', 'kids', 'child'], field: 'reactionToKids' },
	{ keys: ['other dogs', 'dogs', 'dog'], field: 'reactionToDogs' },
	{ keys: ['cats', 'cat'], field: 'reactionToCats' },
	{ keys: ['strangers', 'stranger'], field: 'reactionToStrangers' },
	{ keys: ['walking on leash', 'on leash', 'leash', 'walk'], field: 'reactionToLeash' },
	{ keys: ['car rides', 'car ride', 'car'], field: 'reactionToCarRides' },
	{ keys: ['playing with toys', 'with toys', 'toys', 'toy'], field: 'reactionToToys' },
];

function parseRating(word: string): BehaviorRating | null {
	return RATING_WORDS[word.toLowerCase()] ?? null;
}

function parseBehaviorText(text: string): Partial<ParsedTrip> {
	const result: Partial<ParsedTrip> = {};

	// Split on rating keywords to get segments like "Friendly around dogs and strangers"
	const ratingKeywords = Object.keys(RATING_WORDS).join('|');
	const segments = text.split(new RegExp(`(?=\\b(?:${ratingKeywords})\\b)`, 'i')).filter(Boolean);

	for (const segment of segments) {
		// Handle combined ratings like "Friendly/Excited"
		const ratingMatch = segment.match(/^([\w]+(?:\/[\w]+)*)/i);
		if (!ratingMatch) continue;

		const ratingParts = ratingMatch[1].split('/');
		// Use the first rating for the primary value
		const rating = parseRating(ratingParts[0]);
		if (!rating) continue;

		const segLower = segment.toLowerCase();
		for (const { keys, field } of CATEGORY_PATTERNS) {
			if (keys.some(k => segLower.includes(k))) {
				if (!(field in result)) {
					(result as Record<string, BehaviorRating>)[field] = rating;
				}
			}
		}
	}

	return result;
}

export function stripDayTripNotes(text: string): string {
	return text.replace(/\s*Day Trip Notes\s+\d{1,2}\/\d{1,2}\s*:[\s\S]*?(?=Day Trip Notes\s+\d{1,2}\/\d{1,2}|$)/gi, '').trim();
}

export function parseDayTripNotes(text: string): ParsedTrip[] {
	const entryPattern = /Day Trip Notes\s+(\d{1,2})\/(\d{1,2})\s*:/gi;
	const entries: ParsedTrip[] = [];
	const today = new Date();
	const currentYear = today.getFullYear();

	const matches = [...text.matchAll(entryPattern)];
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const month = parseInt(match[1], 10);
		const day = parseInt(match[2], 10);
		const start = match.index! + match[0].length;
		const end = matches[i + 1]?.index ?? text.length;
		const body = text.slice(start, end).trim();

		// Use last year if the date would otherwise be in the future
		let year = currentYear;
		const candidate = new Date(currentYear, month - 1, day);
		if (candidate > today) year = currentYear - 1;

		const quoteMatch = body.match(/"([^"]+)"/);
		const tripNotes = quoteMatch ? quoteMatch[1].trim() : '';
		const behaviorText = quoteMatch ? body.slice(0, body.indexOf('"')) : body;
		const ratings = parseBehaviorText(behaviorText);

		entries.push({
			date: new Date(year, month - 1, day),
			tripNotes,
			reactionToKids: null,
			reactionToDogs: null,
			reactionToCats: null,
			reactionToStrangers: null,
			reactionToLeash: null,
			reactionToCarRides: null,
			reactionToToys: null,
			...ratings,
		});
	}

	return entries;
}
