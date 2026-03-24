import type { PlaygroupOutcome } from '$lib/types';

export interface ParsedEntry {
	name: string;
	action: 'in' | 'out';
	notes: string | null;
}

export interface ParsedPlaygroupMessage {
	entries: ParsedEntry[];
	dogNames: string[]; // unique names from 'in' events, first-seen casing
	notes: string | null; // per-dog notes joined into one block
	outcome: PlaygroupOutcome; // inferred from keywords
}

// Strict: Name + action only, no trailing text (used when matching comma-split parts)
const SIMPLE_RE = /^([A-Za-z][A-Za-z\s'-]+?)\s+(in|out)$/i;
// Full: Name + action + optional colon/comma notes (used when matching a whole segment)
const FULL_RE = /^([A-Za-z][A-Za-z\s'-]+?)\s+(in|out)(?:[,:]\s*(.+))?$/i;
// Bare name: 1–2 words, no action verb — used for "Birdie, Rosie, Dexter in" pattern
const NAME_LIKE_RE = /^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?$/;

const INCIDENT_WORDS = /\b(airhorn|scuffle|fight|broke[\s-]?up|bite|biting|bit\b|blood)\b/i;
const MIXED_WORDS =
	/\b(tense|nervous|warning|rude|growl|growling|wasn[''`]?t\s+having|was not having)\b/i;

function parseLine(line: string): { entries: ParsedEntry[]; freeform: string | null } {
	const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
	const foundEntries: ParsedEntry[] = [];
	const nameQueue: string[] = []; // bare names waiting for an action word
	const noteParts: string[] = []; // trailing text after entries (becomes notes)

	for (const part of parts) {
		// Simple match: "Birdie in" — most common case, unambiguous
		const simple = SIMPLE_RE.exec(part);
		if (simple) {
			const action = simple[2].toLowerCase() as 'in' | 'out';
			for (const name of nameQueue) foundEntries.push({ name, action, notes: null });
			nameQueue.length = 0;
			foundEntries.push({ name: simple[1].trim(), action, notes: null });
			continue;
		}

		// Full match: "Birdie out: she was great" — entry with colon-notes
		const full = FULL_RE.exec(part);
		if (full) {
			const action = full[2].toLowerCase() as 'in' | 'out';
			const notes = full[3]?.trim() ?? null;
			for (const name of nameQueue) foundEntries.push({ name, action, notes: null });
			nameQueue.length = 0;
			foundEntries.push({ name: full[1].trim(), action, notes });
			continue;
		}

		// Bare name before an action word: "Birdie, Rosie, Dexter in"
		if (NAME_LIKE_RE.test(part) && foundEntries.length === 0) {
			nameQueue.push(part);
			continue;
		}

		// Trailing text after entries = notes for the last entry
		if (foundEntries.length > 0) {
			noteParts.push(part);
		}
		// else: unrecognized at line start — will become freeform if no entries found
	}

	if (foundEntries.length === 0) {
		return { entries: [], freeform: line };
	}

	// Attach trailing notes to last entry
	if (noteParts.length > 0) {
		const last = foundEntries[foundEntries.length - 1];
		const notesStr = noteParts.join(', ');
		last.notes = last.notes ? `${last.notes}, ${notesStr}` : notesStr;
	}

	return { entries: foundEntries, freeform: null };
}

export function parsePlaygroupMessage(
	text: string,
	knownDogNames: string[] = []
): ParsedPlaygroupMessage {
	const entries: ParsedEntry[] = [];
	const freeformLines: string[] = [];

	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line) continue;

		const result = parseLine(line);
		entries.push(...result.entries);
		if (result.freeform) freeformLines.push(result.freeform);
	}

	// Unique names from 'in' events, preserving first-seen casing
	const seenNames = new Map<string, string>(); // lowercased → original
	for (const entry of entries) {
		if (entry.action === 'in') {
			const key = entry.name.toLowerCase();
			if (!seenNames.has(key)) seenNames.set(key, entry.name);
		}
	}

	// Also scan the full text for any known dog names mentioned but not explicitly logged
	for (const known of knownDogNames) {
		const key = known.toLowerCase();
		if (seenNames.has(key)) continue;
		// Match the name as a whole word (case-insensitive) anywhere in the text
		const nameRe = new RegExp(`\\b${known.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
		if (nameRe.test(text)) seenNames.set(key, known);
	}

	// Scan freeform lines and entry notes for any capitalized word that looks like a name.
	// This catches dogs mentioned in notes that are no longer in the shelter roster.
	const STOP_WORDS = new Set([
		'i', 'she', 'he', 'they', 'we', 'you', 'it', 'her', 'him', 'his', 'their', 'our', 'my', 'its',
		'the', 'a', 'an', 'and', 'but', 'or', 'so', 'for', 'nor', 'yet', 'with', 'from', 'to', 'at',
		'in', 'out', 'on', 'up', 'of', 'by', 'as', 'no', 'not', 'this', 'that', 'these', 'those',
		'was', 'were', 'is', 'are', 'has', 'had', 'have', 'been', 'be', 'got', 'did', 'do', 'does',
		'after', 'before', 'during', 'while', 'when', 'then', 'than', 'also', 'just', 'still', 'even',
		'all', 'some', 'both', 'each', 'other', 'another', 'ok', 'okay', 'yes', 'yeah', 'good', 'great',
		'well', 'nice', 'very', 'really', 'super', 'little', 'big',
		'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
		'group', 'session', 'playgroup', 'yard', 'kennel', 'staff', 'volunteer', 'handler', 'run',
	]);
	const capitalWordRe = /\b([A-Z][a-z']{1,})\b/g;
	const scanTexts = [
		...freeformLines,
		...entries.filter((e) => e.notes).map((e) => e.notes as string)
	];
	for (const line of scanTexts) {
		for (const m of line.matchAll(capitalWordRe)) {
			const word = m[1];
			const key = word.toLowerCase();
			if (!seenNames.has(key) && !STOP_WORDS.has(key)) {
				seenNames.set(key, word);
			}
		}
	}

	const dogNames = Array.from(seenNames.values());

	// Build notes: per-dog out-notes first, then any free-form lines
	const noteLines: string[] = [];
	for (const entry of entries) {
		if (entry.notes) noteLines.push(`${entry.name}: ${entry.notes}`);
	}
	if (freeformLines.length > 0) noteLines.push(...freeformLines);
	const notes = noteLines.length > 0 ? noteLines.join('\n') : null;

	let outcome: PlaygroupOutcome = 'successful';
	if (INCIDENT_WORDS.test(text)) outcome = 'incident';
	else if (MIXED_WORDS.test(text)) outcome = 'mixed';

	return { entries, dogNames, notes, outcome };
}
