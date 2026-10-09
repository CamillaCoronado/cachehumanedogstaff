import type { Dog } from '$lib/types';
import { toDate } from '$lib/utils/dates';

/** What ASM says happened to an animal: its last movement, or its death. */
export interface AsmDeparture {
	/** Not found in ASM by id or shelter code. */
	found: boolean;
	/** ASM movement type; null when there is none (still on the shelter). */
	movementType: number | null;
	/** YYYY-MM-DD of that movement, if any. */
	movementDate: string | null;
	/** YYYY-MM-DD of death, if any — outranks any movement. */
	deceasedDate: string | null;
	/** Found by name alone (the ids missed): the ASM shelter code it matched, to double-check. */
	matchedByName?: string | null;
	/** Why it was not found: no ids on record, a failed lookup, or a search that missed. */
	missReason?: string | null;
}

/** A dog from ASM's adoption and recent-changes feeds, for matching without a per-dog search. */
export interface AsmFeedAnimal {
	id: number;
	shelterCode: string;
	/** ASM's short code, the other code shown on an animal's record. */
	shortCode: string;
	name: string;
	movementType: number | null;
	movementDate: string | null;
	deceasedDate: string | null;
}

const sameCode = (a: AsmFeedAnimal, code: string) => {
	const c = code.trim().toUpperCase();
	return Boolean(c) && (a.shelterCode.trim().toUpperCase() === c || a.shortCode.trim().toUpperCase() === c);
};

/** The feed animal with this shelter code or short code, typed in by hand. */
export function findByCode(code: string, feed: AsmFeedAnimal[]): AsmDeparture | null {
	const a = feed.find((x) => sameCode(x, code));
	return a ? { found: true, movementType: a.movementType, movementDate: a.movementDate, deceasedDate: a.deceasedDate } : null;
}

/** A name for matching: ASM adds old names in brackets ("Dragon(Rex)"), so those go, as do case and punctuation. */
const nameKey = (name: string) => name.replace(/\(.*?\)/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Finds a dog in the feed: by ASM id or shelter code, else by exact name when exactly one
 * dog in the feed has it and its departure is not before this dog's intake (so an older
 * dog of the same name is never taken). An intake that is only the day the record was
 * made is not used. Null when nothing fits.
 */
export function matchFromFeed(dog: Dog, feed: AsmFeedAnimal[]): AsmDeparture | null {
	const asmId = dog.asmId ?? (/^\d+$/.test(dog.id) ? Number(dog.id) : null);
	const code = dog.asmShelterCode ?? '';
	const toDeparture = (a: AsmFeedAnimal, matchedByName: string | null): AsmDeparture => ({
		found: true,
		movementType: a.movementType,
		movementDate: a.movementDate,
		deceasedDate: a.deceasedDate,
		matchedByName
	});
	const direct = feed.find((a) => (asmId !== null && a.id === asmId) || sameCode(a, code));
	if (direct) return toDeparture(direct, null);

	const name = nameKey(dog.name);
	if (!name) return null;
	// A dog never linked to ASM (added by the Day Trips import, say) was saved with its
	// creation time as its intake when none was known, so that date says nothing.
	const created = toDate(dog.createdAt ?? null);
	const linked = asmId !== null || Boolean(code.trim());
	const madeUp = !linked && created !== null && ymd(toDate(dog.intakeDate) ?? created) >= ymd(created);
	const intake = madeUp ? null : toDate(dog.intakeDate);
	const intakeDay = intake ? ymd(new Date(intake.getFullYear(), intake.getMonth(), intake.getDate() - 1)) : null;
	const named = feed.filter((a) => {
		if (nameKey(a.name) !== name) return false;
		const left = a.deceasedDate ?? a.movementDate;
		return !intakeDay || !left || left >= intakeDay;
	});
	return named.length === 1 ? toDeparture(named[0], named[0].shelterCode || String(named[0].id)) : null;
}

const MOVEMENT_LABELS: Record<number, string> = {
	1: 'adopted',
	2: 'in foster',
	3: 'transferred',
	4: 'escaped',
	5: 'reclaimed by owner',
	6: 'stolen',
	7: 'released',
	8: 'moved to retailer'
};

export type DepartureCheck =
	| { kind: 'ok' }
	| { kind: 'not-found'; reason: string | null }
	/** ASM shows the dog on the shelter or in foster, but the app has it archived. */
	| { kind: 'still-here'; label: string }
	| { kind: 'fix'; status: Dog['status']; date: string; reason: string; byName: boolean };

const localDay = (value: Dog['leftShelterDate']) => {
	const d = toDate(value ?? null);
	return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
};

/**
 * Compares an archived dog with ASM. A death wins; otherwise the last movement decides
 * the outcome (adopted or transferred — others keep the app's status, which has nothing
 * closer) and its date is the departure date. Anything that differs is a fix.
 */
export function checkDeparture(dog: Dog, asm: AsmDeparture): DepartureCheck {
	if (!asm.found) return { kind: 'not-found', reason: asm.missReason ?? null };

	let status: Dog['status'] = dog.status;
	let date: string | null;
	let what: string;
	if (asm.deceasedDate) {
		status = 'euthanized';
		date = asm.deceasedDate;
		what = 'deceased';
	} else if (asm.movementType === null || asm.movementType === 0 || asm.movementType === 2) {
		return { kind: 'still-here', label: asm.movementType === 2 ? 'in foster' : 'on the shelter' };
	} else {
		if (asm.movementType === 1) status = 'adopted';
		if (asm.movementType === 3) status = 'transferred';
		date = asm.movementDate;
		what = MOVEMENT_LABELS[asm.movementType] ?? `movement ${asm.movementType}`;
	}
	if (!date) return { kind: 'ok' };

	const currentDay = localDay(dog.leftShelterDate);
	if (status === dog.status && currentDay === date) return { kind: 'ok' };

	const parts: string[] = [];
	if (status !== dog.status) parts.push(`${dog.status} → ${status}`);
	if (currentDay !== date) parts.push(`${currentDay ?? 'no date'} → ${date}`);
	const byName = asm.matchedByName ? ` Matched by name only (ASM ${asm.matchedByName}) — check it is the same dog.` : '';
	return { kind: 'fix', status, date, reason: `ASM: ${what}. ${parts.join(', ')}.${byName}`, byName: Boolean(asm.matchedByName) };
}
