import type { Dog } from '$lib/types';

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
