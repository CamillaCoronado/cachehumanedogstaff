import type { AmountEaten, MealTime } from '$lib/types';
import { parseFeedingMessage } from '$lib/utils/parseFeedingMessage';

/** The shelter feeds again at 3pm; before that a report is about the morning feed. */
const PM_FEED_HOUR = 15;

export interface DogRecord {
	id: string;
	name: string;
	intakeDate?: string | null;
	leftShelterDate?: string | null;
	status?: string | null;
	asmShelterCode?: string | null;
}

interface Candidate {
	id: string;
	from: number | null;
	to: number | null;
	code: string | null;
}

export interface PlannedFeeding {
	dogId: string;
	dogName: string;
	amountEaten: AmountEaten;
	mealTime: MealTime;
	mealTimeInferred: boolean;
}

export type DogIndex = Map<string, Candidate[]>;

const DAY_MS = 86_400_000;

/**
 * Groups dogs by name for lookup. Names repeat across years and the same animal is
 * sometimes recorded twice, so every candidate is kept and the date decides.
 */
export function buildDogIndex(dogs: DogRecord[]): DogIndex {
	const index: DogIndex = new Map();
	for (const dog of dogs) {
		if (!dog.name) continue;
		const from = dog.intakeDate ? new Date(dog.intakeDate).getTime() : null;
		let to = dog.leftShelterDate ? new Date(dog.leftShelterDate).getTime() : null;
		// A departure earlier than the dog's own intake belongs to an earlier stay: the
		// dog left and came back, and only the intake date moved. Treating it as current
		// hides the dog from every report since.
		if (to !== null && ((from !== null && to < from) || dog.status === 'active')) to = null;
		if (!index.has(dog.name)) index.set(dog.name, []);
		index.get(dog.name)!.push({ id: dog.id, from, to, code: dog.asmShelterCode ?? null });
	}
	return index;
}

function presentOn(c: Candidate, at: number): boolean {
	return (c.from === null || at >= c.from - DAY_MS) && (c.to === null || at <= c.to + DAY_MS);
}

/** Only the dogs actually at the shelter that day — every extra name is a chance to mismatch. */
export function rosterOn(index: DogIndex, when: Date): string[] {
	const at = when.getTime();
	const names: string[] = [];
	for (const [name, candidates] of index) {
		if (candidates.some((c) => presentOn(c, at))) names.push(name);
	}
	return names;
}

/** The dog of this name at the shelter on `when`, or null when it cannot be told. */
export function resolveDogId(index: DogIndex, name: string, when: Date): string | null {
	const candidates = index.get(name);
	if (!candidates) return null;
	if (candidates.length === 1) return candidates[0].id;

	const at = when.getTime();
	let inWindow = candidates.filter((c) => presentOn(c, at));

	// A document keyed by shelter number is one ASM maintains; a UUID-keyed one is a
	// legacy record the sync no longer touches, several of them stale twins still marked
	// present long after the dog left.
	const numbered = inWindow.filter((c) => /^\d+$/.test(c.id));
	if (numbered.length > 0) inWindow = numbered;

	if (inWindow.length > 1) {
		const stillHere = inWindow.filter((c) => c.to === null);
		if (stillHere.length === 1) inWindow = stillHere;
	}

	// Two records are the same animal only if their shelter codes agree. A shared intake
	// date is not enough — two dogs can arrive the same day.
	if (inWindow.length > 1) {
		const codes = new Set(inWindow.map((c) => c.code).filter(Boolean));
		if (codes.size === 1) {
			inWindow = [inWindow.slice().sort((a, b) => (b.to ?? Infinity) - (a.to ?? Infinity))[0]];
		}
	}

	// One match is an answer; anything else is a guess, and a guess files a real meal
	// onto the wrong animal's history.
	return inWindow.length === 1 ? inWindow[0].id : null;
}

/**
 * Reads one message into the feeding logs it implies. Returns an empty list when the
 * message says nothing about a specific dog eating — a blanket "everyone ate" and a
 * "do not feed" instruction both deliberately produce nothing.
 */
export function planFeedings(text: string, postedAt: Date, index: DogIndex): PlannedFeeding[] {
	const parsed = parseFeedingMessage(text, rosterOn(index, postedAt));
	if (parsed.entries.length === 0) return [];

	const mealTime: MealTime =
		parsed.mealTime ?? (postedAt.getHours() < PM_FEED_HOUR ? 'am' : 'pm');

	const planned: PlannedFeeding[] = [];
	for (const entry of parsed.entries) {
		const dogId = resolveDogId(index, entry.name, postedAt);
		if (!dogId) continue; // ambiguous or unknown — skipped, never guessed
		planned.push({
			dogId,
			dogName: entry.name,
			amountEaten: entry.amountEaten,
			mealTime,
			mealTimeInferred: !parsed.mealTime
		});
	}
	return planned;
}

/** Derived from the source message so a repeat delivery overwrites instead of duplicating. */
export function feedingLogId(slackTs: string, dogId: string, mealTime: MealTime): string {
	return `slack-${slackTs.replace('.', '-')}-${dogId}-${mealTime}`;
}
