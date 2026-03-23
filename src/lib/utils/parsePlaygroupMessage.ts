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

const LINE_RE = /^([A-Za-z][A-Za-z\s'-]+?)\s+(in|out)(?::\s*(.+))?$/i;

const INCIDENT_WORDS = /\b(airhorn|scuffle|fight|broke[\s-]?up|bite|biting|bit\b|blood)\b/i;
const MIXED_WORDS =
	/\b(tense|nervous|warning|rude|growl|growling|overwhelmed|wasn[''`]?t\s+having|was not having)\b/i;

export function parsePlaygroupMessage(text: string): ParsedPlaygroupMessage {
	const entries: ParsedEntry[] = [];

	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const match = LINE_RE.exec(line);
		if (!match) continue;
		entries.push({
			name: match[1].trim(),
			action: match[2].toLowerCase() as 'in' | 'out',
			notes: match[3]?.trim() ?? null
		});
	}

	// Unique names from 'in' events, preserving first-seen casing
	const seenNames = new Map<string, string>(); // lowercased → original
	for (const entry of entries) {
		if (entry.action === 'in') {
			const key = entry.name.toLowerCase();
			if (!seenNames.has(key)) seenNames.set(key, entry.name);
		}
	}
	const dogNames = Array.from(seenNames.values());

	// Build notes from per-dog out-notes
	const noteLines: string[] = [];
	for (const entry of entries) {
		if (entry.notes) noteLines.push(`${entry.name}: ${entry.notes}`);
	}
	const notes = noteLines.length > 0 ? noteLines.join('\n') : null;

	let outcome: PlaygroupOutcome = 'successful';
	if (INCIDENT_WORDS.test(text)) outcome = 'incident';
	else if (MIXED_WORDS.test(text)) outcome = 'mixed';

	return { entries, dogNames, notes, outcome };
}
