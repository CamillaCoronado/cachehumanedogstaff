import type { AmountEaten, MealTime } from '$lib/types';
import { parseFeedingMessage } from '$lib/utils/parseFeedingMessage';

/** The shelter feeds again at 3pm; before that a report is about the morning feed. */
const PM_FEED_HOUR = 15;

/**
 * The shelter's own clock. Server time is not it: the poll runs on Vercel in UTC, so a
 * report posted at 12:38pm read as 18:38 and landed on the afternoon feed. Every meal
 * the live import classified was six hours out.
 */
const SHELTER_TZ = 'America/Denver';

const shelterParts = new Intl.DateTimeFormat('en-CA', {
	timeZone: SHELTER_TZ,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	hour12: false
});

function shelterFields(date: Date): { day: string; hour: number } {
	const parts = Object.fromEntries(shelterParts.formatToParts(date).map((p) => [p.type, p.value]));
	return {
		day: `${parts.year}${parts.month}${parts.day}`,
		// 24 is midnight in some locales' hourCycle; normalise it.
		hour: Number(parts.hour) % 24
	};
}

/** The hour of the day at the shelter, whatever timezone this code is running in. */
export function shelterHour(date: Date): number {
	return shelterFields(date).hour;
}

/** The shelter's calendar day as YYYYMMDD, for keying one feed per day. */
export function shelterDay(date: Date): string {
	return shelterFields(date).day;
}

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
	/** Extra names staff use for this dog, matched exactly like its own name. */
	nicknames?: string[];
}

/** A name standing for several dogs at once, such as a litter. */
export interface DogGroupRecord {
	name: string;
	dogIds: string[];
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

export interface FeedingPlan {
	entries: PlannedFeeding[];
	/**
	 * Why this needs a person's eye before it is written, if it does. Empty means it can
	 * be applied on arrival — most reports are plain and there is nothing to decide.
	 */
	uncertain: string[];
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

export interface DogIndex {
	byName: Map<string, Candidate[]>;
	/** Names standing for several dogs at once, normalised for lookup. */
	groups: Map<string, string[]>;
	/** A dog's own name, so a nickname match is recorded under the name it is filed by. */
	namesById: Map<string, string>;
}

const DAY_MS = 86_400_000;

/** Same normalisation the parser uses, so a group name matches however it is typed. */
function normalizeName(value: string): string {
	return value.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Groups dogs by name for lookup. Names repeat across years and the same animal is
 * sometimes recorded twice, so every candidate is kept and the date decides.
 */
export function buildDogIndex(dogs: DogRecord[], groups: DogGroupRecord[] = []): DogIndex {
	const index: DogIndex = {
		byName: new Map(),
		groups: new Map(groups.map((g) => [normalizeName(g.name), g.dogIds])),
		namesById: new Map(dogs.filter((d) => d.name).map((d) => [d.id, d.name]))
	};

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

		// Foster is dated, so it can be applied to the day in question rather than to now:
		// a dog in foster today was still being fed here before it left, and one that went
		// to foster in April was not being fed here in May.
		const fosterFrom = dog.inFosterSince ? new Date(dog.inFosterSince).getTime() : null;
		const backRaw = dog.shelterSince ? new Date(dog.shelterSince).getTime() : null;
		// shelterSince is also stamped when a dog moves off Incoming, so it only marks a
		// return from foster when it comes after the foster started.
		const backFrom = backRaw !== null && fosterFrom !== null && backRaw > fosterFrom ? backRaw : null;

		const candidate: Candidate = {
			id: dog.id,
			name: dog.name,
			from,
			to,
			code: dog.asmShelterCode ?? null,
			feedable,
			isIncoming: Boolean(dog.isIncoming),
			fosterFrom,
			backFrom
		};

		if (!index.byName.has(dog.name)) index.byName.set(dog.name, []);
		index.byName.get(dog.name)!.push(candidate);
	}

	// Nicknames in a second pass, so one never displaces a dog actually called that.
	const realNames = new Set(dogs.map((d) => d.name));
	for (const dog of dogs) {
		const candidates = index.byName.get(dog.name);
		if (!candidates) continue;
		const candidate = candidates.find((c) => c.id === dog.id);
		if (!candidate) continue;
		for (const nickname of dog.nicknames ?? []) {
			const key = nickname.trim();
			if (!key || realNames.has(key)) continue;
			if (!index.byName.has(key)) index.byName.set(key, []);
			index.byName.get(key)!.push(candidate);
		}
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
	for (const [name, candidates] of index.byName) {
		if (candidates.some((c) => presentOn(c, at))) names.push(name);
	}
	return names;
}

/** The dog of this name at the shelter on `when`, or null when it cannot be told. */
export function resolveDogId(index: DogIndex, name: string, when: Date): string | null {
	const candidates = index.byName.get(name);
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

/**
 * Two reports far enough apart are two feeds. Two a few minutes apart are one feed
 * written up twice — often the same person adding a detail — and splitting those would
 * invent a meal.
 */
const SEPARATE_FEEDS_MS = 4 * 60 * 60 * 1000;
const SLOT_ORDER: MealTime[] = ['am', 'pm', 'second'];

export interface DayReport {
	postedAt: Date;
	/** From the message itself: "morning", "second meal". Never overridden. */
	statedMealTime: MealTime | null;
}

/**
 * Assigns a meal slot to each of a day's reports.
 *
 * The clock decides on its own — before 3pm is the morning feed. But when two reports
 * land in the same slot and neither says which meal it is, their order settles it: the
 * shelter feeds twice, so the later write-up is the later feed. That only applies when
 * they are hours apart, since a pair minutes apart is one feed reported twice.
 *
 * A message that states its meal keeps it, and never gets moved to make room.
 */
export function assignDaySlots(reports: DayReport[]): MealTime[] {
	const order = reports.map((r, i) => i).sort((a, b) => reports[a].postedAt.getTime() - reports[b].postedAt.getTime());
	const slots: MealTime[] = reports.map(
		(r) => r.statedMealTime ?? (shelterHour(r.postedAt) < PM_FEED_HOUR ? 'am' : 'pm')
	);

	for (let n = 1; n < order.length; n++) {
		const here = order[n];
		const before = order[n - 1];
		if (reports[here].statedMealTime) continue; // stated wins
		if (slots[here] !== slots[before]) continue; // already distinct
		if (reports[here].postedAt.getTime() - reports[before].postedAt.getTime() < SEPARATE_FEEDS_MS) continue;

		const next = SLOT_ORDER[SLOT_ORDER.indexOf(slots[before]) + 1];
		// Nothing after the second meal; leave it where the clock put it.
		if (next && !slots.some((s, i) => s === next && reports[i].statedMealTime)) slots[here] = next;
	}
	return slots;
}

/** Every dog the feeding shift would have fed that day. */
function feedableOn(index: DogIndex, when: Date): Candidate[] {
	const at = when.getTime();
	const out: Candidate[] = [];
	for (const candidates of index.byName.values()) {
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
export function planFeedings(
	text: string,
	postedAt: Date,
	index: DogIndex,
	/** Supplied when the day's other reports are known, so order can settle the slot. */
	slotOverride?: MealTime
): PlannedFeeding[] {
	return planFeedingsDetailed(text, postedAt, index, slotOverride).entries;
}

export function planFeedingsDetailed(
	text: string,
	postedAt: Date,
	index: DogIndex,
	slotOverride?: MealTime
): FeedingPlan {
	const parsed = parseFeedingMessage(text, rosterOn(index, postedAt));
	// Either form is a feeding record: dogs named as exceptions, or a plain statement
	// that the whole shelter ate. Anything else is not a report of a feed.
	if (parsed.entries.length === 0 && !parsed.allAte) return { entries: [], uncertain: [] };

	const mealTime: MealTime =
		parsed.mealTime ?? slotOverride ?? (shelterHour(postedAt) < PM_FEED_HOUR ? 'am' : 'pm');
	const mealTimeInferred = !parsed.mealTime;

	const planned: PlannedFeeding[] = [];
	const named = new Set<string>();
	for (const entry of parsed.entries) {
		const dogId = resolveDogId(index, entry.name, postedAt);
		if (!dogId) continue; // ambiguous or unknown — skipped, never guessed
		named.add(dogId);
		planned.push({
			dogId,
			dogName: index.namesById.get(dogId) ?? entry.name,
			amountEaten: entry.amountEaten,
			mealTime,
			mealTimeInferred,
			implied: false
		});
	}
	// "Everyone ate" names nobody, and that is the whole message: every dog ate.
	if (planned.length === 0 && !parsed.allAte) return { entries: [], uncertain: [] };

	// Any statement that a dog did not eat is a statement about that feed, wherever it
	// appears — a round-up, or one line inside a shift note. The shelter reports by
	// exception, so naming one dog accounts for all the others.

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

	const uncertain = [...parsed.uncertain];
	// A dog named in the message that could not be pinned to one record is not written
	// at all, and that is worth saying rather than silently dropping.
	const unresolved = parsed.entries.length - planned.filter((p) => !p.implied).length;
	if (unresolved > 0) {
		uncertain.push(`${unresolved} named dog${unresolved === 1 ? '' : 's'} could not be matched`);
	}

	return { entries: planned, uncertain };
}

export interface PlannedSurgery {
	dogId: string;
	dogName: string;
}

/**
 * Reads the morning surgery list. Elizabeth posts it as a "do not feed" instruction —
 * the dogs going under anaesthetic have to fast — so the same line that keeps them off
 * the feed list is the list of who is having surgery.
 *
 * Returns nothing for a message that only says how to feed ("do not feed X together")
 * or that names dogs nobody can resolve ("all the hat puppies").
 */
export function planSurgery(text: string, postedAt: Date, index: DogIndex): PlannedSurgery[] {
	const parsed = parseFeedingMessage(text, rosterOn(index, postedAt));
	if (!parsed.isSurgeryList) return [];

	const out: PlannedSurgery[] = [];
	const seen = new Set<string>();
	const add = (dogId: string, dogName: string) => {
		if (seen.has(dogId)) return;
		seen.add(dogId);
		out.push({ dogId, dogName });
	};

	for (const name of parsed.doNotFeed) {
		const dogId = resolveDogId(index, name, postedAt);
		if (dogId) add(dogId, index.namesById.get(dogId) ?? name);
	}

	// A litter is named as a group long before anyone types out every puppy — "all the
	// hat puppies". Matched against the raw text, since the group name is not a dog name
	// and never reaches the parser's roster.
	const haystack = normalizeName(text);
	for (const [groupKey, dogIds] of index.groups) {
		if (!groupKey || !haystack.includes(groupKey)) continue;
		for (const dogId of dogIds) {
			const name = index.namesById.get(dogId);
			if (name) add(dogId, name);
		}
	}

	return out;
}

/**
 * One id per dog per meal per day, deliberately not per message: two people often report
 * the same meal, and keying by message would give a dog two logs for one feed.
 */
export function feedingLogId(postedAt: Date, dogId: string, mealTime: MealTime): string {
	return `slack-${shelterDay(postedAt)}-${mealTime}-${dogId}`;
}
