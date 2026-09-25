import type { Dog } from '$lib/types';
import { toDate } from '$lib/utils/dates';

function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Finds a dog from a candidate list by name. Tries in order:
 * 1. Exact case-insensitive match
 * 2. Parenthetical stripped ("Sadie (Jazmine)" → "sadie")
 * 3. Normalized match (strips all non-alpha)
 * 4. Prefix match (one normalized name is a prefix of the other — e.g. "Sadie"
 *    → "Sadie (Jazmine)"), but only when exactly one candidate qualifies. A
 *    plain substring check here would let a short query like "Leo" falsely
 *    match an unrelated dog like "Cleopatra"; requiring a prefix and a unique
 *    winner avoids that while still catching real nickname matches.
 */
export function matchDogByName(name: string, candidates: Dog[]): Dog | null {
	const lower = name.toLowerCase().trim();
	const normalized = normalizeName(name);

	const exact = candidates.find((d) => d.name.toLowerCase().trim() === lower);
	if (exact) return exact;

	const base = name.replace(/\s*\(.*?\)\s*$/, '').toLowerCase().trim();
	if (base !== lower) {
		const baseMatch = candidates.find((d) => d.name.toLowerCase().trim() === base);
		if (baseMatch) return baseMatch;
	}

	const fuzzy = candidates.find((d) => normalizeName(d.name) === normalized);
	if (fuzzy) return fuzzy;

	const prefixMatches = candidates.filter((d) => {
		const dn = normalizeName(d.name);
		return dn.startsWith(normalized) || normalized.startsWith(dn);
	});
	return prefixMatches.length === 1 ? prefixMatches[0] : null;
}

const DAY_MS = 86_400_000;

/**
 * Whether the dog was at the shelter on this date, from its intake and departure dates
 * (a day's slack either side). A departure before the latest intake belongs to an earlier
 * stay, and an active dog has not left.
 */
export function wasInShelterOn(dog: Dog, when: Date): boolean {
	const from = toDate(dog.intakeDate)?.getTime() ?? null;
	let to = toDate(dog.leftShelterDate)?.getTime() ?? null;
	if (to !== null && ((from !== null && to < from) || dog.status === 'active')) to = null;
	// A permanent foster left the shelter when it went to its foster home.
	if (dog.permanentFoster) {
		const left = toDate(dog.inFosterSince ?? null)?.getTime() ?? null;
		if (left === null) return false;
		to = left;
	}
	const at = when.getTime();
	return (from === null || at >= from - DAY_MS) && (to === null || at <= to + DAY_MS);
}

/**
 * A name as it was meant on a given day. Names repeat, so the dog at the shelter that day
 * wins; then a dog here now; then anyone on record.
 */
export function matchDogOnDate(name: string, candidates: Dog[], when: Date): Dog | null {
	return (
		matchDogByName(name, candidates.filter((d) => wasInShelterOn(d, when))) ??
		matchDogByName(name, candidates.filter((d) => d.status === 'active')) ??
		matchDogByName(name, candidates)
	);
}
