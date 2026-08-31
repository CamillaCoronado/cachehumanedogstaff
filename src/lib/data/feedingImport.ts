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
	// Who the feeding shift actually feeds — mirrors activeDogs/shelterDogs on the
	// Feeding page, so "everyone else" here means the same set it means there.
	inFoster?: boolean;
	permanentFoster?: boolean;
	inFosterSince?: string | null;
	shelterSince?: string | null;
	isolationStatus?: string | null;
	isIncoming?: boolean;
}

interface Candidate {
	id: string;
	name: string;
	from: number | null;
	to: number | null;
	code: string | null;
	feedable: boolean;
	isIncoming: boolean;
	fosterFrom: number | null;
	backFrom: number | null;
}

export interface PlannedFeeding {
	dogId: string;
	dogName: string;
	amountEaten: AmountEaten;
	mealTime: MealTime;
	mealTimeInferred: boolean;
	/**
	 * True when the message did not name this dog. Staff report exceptions — "Buck and
	 * Cora didn't eat" means everyone else finished — so the rest are filled in as having
	 * eaten. An implied log never overwrites one somebody actually recorded.
	 */
	implied: boolean;
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
		// Isolation dogs are fed by the clinic, so they are not part of "everyone else".
		// This one is current-state only — nothing records when an isolation began — but
		// it covers a couple of dogs at a time.
		//
		// Status is deliberately not part of this. It records where a dog is *now*, so
		// requiring 'active' would drop every dog since adopted and leave a message from
		// February implying a meal for only the handful still here today. Whether a dog
		// was at the shelter on a given date is what the dates are for.
		const feedable = !dog.permanentFoster && (dog.isolationStatus ?? 'none') === 'none';
		if (!index.has(dog.name)) index.set(dog.name, []);
		// Foster is dated, so it can be applied to the day in question rather than to now:
		// a dog in foster today was still being fed here before it left, and one that went
		// to foster in April was not being fed here in May.
		const fosterFrom = dog.inFosterSince ? new Date(dog.inFosterSince).getTime() : null;
		const backRaw = dog.shelterSince ? new Date(dog.shelterSince).getTime() : null;
		// shelterSince is also stamped when a dog moves off Incoming, so it only marks a
		// return from foster when it comes after the foster started.
		const backFrom = backRaw !== null && fosterFrom !== null && backRaw > fosterFrom ? backRaw : null;

		index.get(dog.name)!.push({
			id: dog.id,
			name: dog.name,
			from,
			to,
			code: dog.asmShelterCode ?? null,
			feedable,
			isIncoming: Boolean(dog.isIncoming),
			fosterFrom,
			backFrom
		});
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

/** In a foster home on this date, so fed there rather than by the shelter. */
function inFosterOn(c: Candidate, at: number): boolean {
	if (c.fosterFrom === null || at < c.fosterFrom) return false;
	// Came back: in foster only for the stretch between leaving and returning.
	return c.backFrom === null || at < c.backFrom;
}

/** Every dog the feeding shift would have fed that day. */
function feedableOn(index: DogIndex, when: Date): Candidate[] {
	const at = when.getTime();
	const out: Candidate[] = [];
	for (const candidates of index.values()) {
		for (const c of candidates) {
			if (!c.feedable || !presentOn(c, at)) continue;
			if (inFosterOn(c, at)) continue;
			// An incoming dog is only fed from the day it actually arrives.
			if (c.isIncoming && (c.from === null || at < c.from - DAY_MS)) continue;
			out.push(c);
		}
	}
	return out;
}

/**
 * Reads one message into the feeding logs it implies.
 *
 * Staff report by exception: "Buck and Cora didn't eat" means every other dog finished.
 * So the named dogs are recorded as stated and the rest of that day's feedable dogs are
 * filled in as having eaten, marked `implied` so they can never overwrite something
 * somebody actually observed.
 *
 * Returns nothing when the message names no dog — a bare "everyone ate", a "do not feed"
 * instruction, or ordinary chatter. Without a named exception there is nothing to say
 * the message is a feeding report at all.
 */
export function planFeedings(text: string, postedAt: Date, index: DogIndex): PlannedFeeding[] {
	const parsed = parseFeedingMessage(text, rosterOn(index, postedAt));
	// Either form is a feeding record: dogs named as exceptions, or a plain statement
	// that the whole shelter ate. Anything else is not a report of a feed.
	if (parsed.entries.length === 0 && !parsed.allAte) return [];

	const mealTime: MealTime =
		parsed.mealTime ?? (postedAt.getHours() < PM_FEED_HOUR ? 'am' : 'pm');
	const mealTimeInferred = !parsed.mealTime;

	const planned: PlannedFeeding[] = [];
	const named = new Set<string>();
	for (const entry of parsed.entries) {
		const dogId = resolveDogId(index, entry.name, postedAt);
		if (!dogId) continue; // ambiguous or unknown — skipped, never guessed
		named.add(dogId);
		planned.push({
			dogId,
			dogName: entry.name,
			amountEaten: entry.amountEaten,
			mealTime,
			mealTimeInferred,
			implied: false
		});
	}
	// "Everyone ate" names nobody, and that is the whole message: every dog ate.
	if (planned.length === 0 && !parsed.allAte) return [];

	// Only the shift's round-up accounts for the dogs it does not name. A passing remark
	// about one dog says nothing about the rest, so it records that dog and stops.
	if (!parsed.looksLikeReport) return planned;

	// A dog told not to be fed did not refuse a meal and did not eat one either.
	const excluded = new Set(
		parsed.doNotFeed.map((name) => resolveDogId(index, name, postedAt)).filter(Boolean) as string[]
	);

	for (const dog of feedableOn(index, postedAt)) {
		if (named.has(dog.id) || excluded.has(dog.id)) continue;
		planned.push({
			dogId: dog.id,
			dogName: dog.name,
			amountEaten: 'all',
			mealTime,
			mealTimeInferred,
			implied: true
		});
	}
	return planned;
}

/**
 * One id per dog per meal per day, deliberately not per message: two people often report
 * the same meal, and keying by message would give a dog two logs for one feed.
 */
export function feedingLogId(postedAt: Date, dogId: string, mealTime: MealTime): string {
	const day = `${postedAt.getFullYear()}${String(postedAt.getMonth() + 1).padStart(2, '0')}${String(postedAt.getDate()).padStart(2, '0')}`;
	return `slack-${day}-${mealTime}-${dogId}`;
}
