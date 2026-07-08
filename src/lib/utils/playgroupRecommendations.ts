import type { Dog, DogPlayStyle, PlaygroupSession } from '$lib/types';
import { daysSince, toDate } from '$lib/utils/dates';
import { dogAgeWeeks, isPuppyVaccinated, isSurgeryResting } from '$lib/utils/attention';

export { isPuppyVaccinated };

export type DogReadiness = 'ready' | 'caution' | 'hold';
export type RecommendationPriority = 'high' | 'medium';

export interface PlaygroupRecommendation {
	id: string;
	title: string;
	playStyle: DogPlayStyle;
	dogs: Dog[];
	dogIds: string[];
	reason: string;
	recommendationType: PlaygroupSession['recommendationType'];
	priority: RecommendationPriority;
}

export const PLAY_STYLE_LABELS: Record<DogPlayStyle, string> = {
	rough_and_rowdy: 'Rough & Rowdy',
	gentle_and_dainty: 'Gentle & Dainty',
	solo: 'Solo Playtime'
};

// A dog's observed play styles. Not derived from energy or size — staff tag it
// after watching the dog play. Untagged puppies default to rough & rowdy
// (that's how puppies play); untagged adults have no style and need assessment.
export function dogPlayStyles(dog: Dog): DogPlayStyle[] {
	const styles = dog.playStyles ?? [];
	if (styles.length > 0) return styles;
	return isPuppy(dog) ? ['rough_and_rowdy'] : [];
}

export function needsPlayAssessment(dog: Dog): boolean {
	return dogPlayStyles(dog).length === 0;
}

export interface TestSuggestion {
	id: string;
	dog: Dog;
	suggestedGroup: PlaygroupRecommendation | null;
	reason: string;
}

export interface SwapInSuggestion {
	dog: Dog;
	compatibleGroups: PlaygroupRecommendation[];
}

export function isPuppy(dog: Dog): boolean {
	const weeks = dogAgeWeeks(dog, new Date());
	return weeks !== null && weeks < 26;
}

// A dog counted as a puppy (under 26 weeks) at a given past date.
function wasPuppyAt(dog: Dog, date: Date): boolean {
	const dob = toDate(dog.dateOfBirth);
	if (!dob) return false;
	return Math.floor((date.getTime() - dob.getTime()) / (7 * 86_400_000)) < 26;
}

// Adults earn puppy experience by having shared a successful playgroup with a
// dog that was a puppy at the time. Until then, pairing them with a puppy is
// something to evaluate, not assume.
export function hasPuppyExperience(dog: Dog, allDogs: Dog[], sessions: PlaygroupSession[]): boolean {
	const byId = new Map(allDogs.map((d) => [d.id, d]));
	for (const session of sessions) {
		if (session.outcome !== 'successful') continue;
		if (!session.dogIds.includes(dog.id)) continue;
		const date = toDate(session.date);
		if (!date) continue;
		const playedWithPuppy = session.dogIds.some((id) => {
			if (id === dog.id) return false;
			const other = byId.get(id);
			return other ? wasPuppyAt(other, date) : false;
		});
		if (playedWithPuppy) return true;
	}
	return false;
}

// Puppies play rough — so a group with a puppy takes other puppies, or adults
// that are puppy-experienced and not TOO rough (very-high energy is out).
export function puppyCompatible(
	group: Dog[],
	candidate: Dog,
	puppyExperienced: (dog: Dog) => boolean
): boolean {
	const members = [...group, candidate];
	if (!members.some(isPuppy)) return true;
	return members.every((d) => isPuppy(d) || (puppyExperienced(d) && dogEnergyRank(d) <= 3));
}

export function intactConflict(dogs: Dog[]): boolean {
	const hasIntactMale = dogs.some((d) => !d.isFixed && d.sex === 'male');
	const hasIntactFemale = dogs.some((d) => !d.isFixed && d.sex === 'female');
	return hasIntactMale && hasIntactFemale;
}

export function getReadiness(dog: Dog): DogReadiness {
	if (dog.isolationStatus !== 'none' || dog.goodWithDogs === 'no') return 'hold';
	if (isSurgeryResting(dog, new Date())) return 'hold';
	const weeks = dogAgeWeeks(dog, new Date());
	if (weeks !== null && weeks < 26) {
		if (weeks < 12 || !isPuppyVaccinated(dog)) return 'hold';
	}
	if (dog.goodWithDogs === 'yes') return 'ready';
	return 'caution';
}

export function readinessLabel(readiness: DogReadiness) {
	if (readiness === 'ready') return 'Ready';
	if (readiness === 'caution') return 'Caution';
	return 'Hold';
}

export function guidanceForDog(dog: Dog) {
	const readiness = getReadiness(dog);
	if (readiness === 'hold') {
		if (dog.isolationStatus !== 'none') return 'In isolation: do not schedule.';
		if (dog.goodWithDogs === 'no') return 'Marked not dog-social: behavior team only.';
		const surgeryDaysAgo = daysSince(dog.surgeryDate);
		if (surgeryDaysAgo !== null && surgeryDaysAgo >= 0 && surgeryDaysAgo < (dog.surgeryRestDays ?? 0)) {
			const daysLeft = (dog.surgeryRestDays ?? 0) - surgeryDaysAgo;
			return `Post-surgery rest — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining.`;
		}
		if (dog.dayTripStatus === 'ineligible' && dog.dayTripIneligibleReason === 'medical') {
			return dog.dayTripNotes?.trim() ? `Medical hold: ${dog.dayTripNotes.trim()}` : 'Medical hold: do not schedule.';
		}
		const weeks = dogAgeWeeks(dog, new Date());
		if (weeks !== null && weeks < 12) return `Too young for playgroup (${weeks} wks — minimum 12 weeks).`;
		if (isPuppy(dog) && !isPuppyVaccinated(dog)) {
			if (dog.vaccineCount < 2) return `Needs 2 vaccine rounds before playgroup (${dog.vaccineCount} on record).`;
			const vaccDate = toDate(dog.vaccinatedDate);
			if (vaccDate) {
				const daysAgo = Math.floor((Date.now() - vaccDate.getTime()) / 86_400_000);
				const daysLeft = 14 - daysAgo;
				return `Last vaccine ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago — wait ${daysLeft} more day${daysLeft === 1 ? '' : 's'} for immunity.`;
			}
			return 'Vaccination date unknown — confirm 2 rounds before playgroup.';
		}
	}
	if (readiness === 'caution') {
		if (isPuppy(dog)) return 'Puppy (12+ wks, vaccinated): OK with other puppies or puppy-experienced adults (not too rough). Do a controlled intro.';
		return 'Unknown dog compatibility: do controlled intro with a stable dog.';
	}
	return 'Eligible for standard playgroup rotation.';
}

export function energyRank(value: Dog['energyLevel']) {
	if (value === 'low') return 1;
	if (value === 'medium') return 2;
	if (value === 'high') return 3;
	if (value === 'very_high') return 4;
	return 2;
}

export function dogEnergyRank(dog: Dog): number {
	return isPuppy(dog) ? 3 : energyRank(dog.energyLevel);
}

export function sizeCategory(dog: Dog): 'tiny' | 'small' | 'medium' | 'large' | 'unknown' {
	if (dog.weightLbs === null || dog.weightLbs === undefined) return 'unknown';
	if (dog.weightLbs < 15) return 'tiny';
	if (dog.weightLbs < 30) return 'small';
	if (dog.weightLbs <= 55) return 'medium';
	return 'large';
}

export function sizeRank(dog: Dog): number {
	return dog.weightLbs ?? 30;
}

export function sizeCompatible(dogs: Dog[]): boolean {
	const known = dogs.filter((d) => d.weightLbs !== null && d.weightLbs !== undefined);
	if (known.length === 0) return true;
	const hasTiny = known.some((d) => sizeCategory(d) === 'tiny');
	const hasNonTiny = known.some((d) => sizeCategory(d) !== 'tiny');
	if (hasTiny && hasNonTiny) return false;
	const weights = known.map((d) => d.weightLbs as number);
	const min = Math.min(...weights);
	const max = Math.max(...weights);
	return max <= min * 2;
}

export function sizeLabelShort(dog: Dog): string {
	const s = sizeCategory(dog);
	if (s === 'unknown') return '?';
	if (s === 'tiny') return 'T';
	if (s === 'small') return 'S';
	if (s === 'medium') return 'M';
	return 'L';
}

// Energy is a hard constraint like size: all members must be within one
// energy level of each other (puppies count as high).
export function energyCompatible(group: Dog[], candidate: Dog): boolean {
	const ranks = [...group.map(dogEnergyRank), dogEnergyRank(candidate)];
	return Math.max(...ranks) - Math.min(...ranks) <= 1;
}

const ENERGY_LABELS: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'very high' };

// Human-readable rationale for a group card: actual size range, energy band,
// and whether an intact male/female was deliberately kept out.
function groupReason(group: Dog[], heldOutForIntact: number): string {
	const weights = group.map((d) => d.weightLbs as number);
	const minW = Math.min(...weights);
	const maxW = Math.max(...weights);
	const ranks = group.map(dogEnergyRank);
	const minR = Math.min(...ranks);
	const maxR = Math.max(...ranks);
	const parts = [
		minW === maxW ? `${minW} lbs` : `${minW}–${maxW} lbs`,
		`${minR === maxR ? ENERGY_LABELS[minR] : `${ENERGY_LABELS[minR]}–${ENERGY_LABELS[maxR]}`} energy`
	];
	if (group.some(isPuppy)) parts.push('puppy group — puppy-experienced adults only');
	if (heldOutForIntact > 0) parts.push('intact M/F kept separate');
	return parts.join(' · ');
}

export function buildRecommendations(
	ready: Dog[],
	allDogs: Dog[] = [],
	sessions: PlaygroupSession[] = []
): { groups: PlaygroupRecommendation[]; swapIns: SwapInSuggestion[]; needsAssessment: Dog[] } {
	const groups: PlaygroupRecommendation[] = [];
	const groupedIds = new Set<string>();

	// Puppy experience is derived from history once per build.
	const experiencedIds = new Set(
		ready.filter((d) => !isPuppy(d) && hasPuppyExperience(d, allDogs, sessions)).map((d) => d.id)
	);
	const puppyExperienced = (dog: Dog) => experiencedIds.has(dog.id);

	// Play style is the bucket, staff-assessed (never derived from energy/size).
	// Untagged dogs can't be grouped — they surface as needing assessment.
	const needsAssessment = ready.filter(needsPlayAssessment);
	const styleNumbers: Record<DogPlayStyle, number> = { rough_and_rowdy: 1, gentle_and_dainty: 1, solo: 1 };

	for (const style of ['rough_and_rowdy', 'gentle_and_dainty'] as const) {
		const bucket = ready.filter(
			(d) =>
				!groupedIds.has(d.id) &&
				dogPlayStyles(d).includes(style) &&
				d.weightLbs !== null &&
				d.weightLbs !== undefined
		);
		const sorted = [...bucket].sort(
			(a, b) => sizeRank(a) - sizeRank(b) || dogEnergyRank(a) - dogEnergyRank(b) || a.name.localeCompare(b.name)
		);

		// Repeatedly seed a group with the lightest ungrouped dog. Dogs that don't
		// fit (size window, energy band, puppy rules, or an intact conflict) stay in
		// the pool and get their own chance to anchor a later group — a single
		// mismatch no longer discards everyone around it.
		let remaining = sorted;
		while (remaining.length > 0) {
			const [anchor, ...rest] = remaining;
			const group: Dog[] = [anchor];
			const leftover: Dog[] = [];
			let heldOutForIntact = 0;
			for (const candidate of rest) {
				// Anchor is the group's lightest dog, so pairwise size check with it
				// bounds the whole group's spread.
				if (
					group.length >= 4 ||
					!sizeCompatible([anchor, candidate]) ||
					!energyCompatible(group, candidate) ||
					!puppyCompatible(group, candidate, puppyExperienced)
				) {
					leftover.push(candidate);
					continue;
				}
				if (intactConflict([...group, candidate])) {
					heldOutForIntact++;
					leftover.push(candidate);
					continue;
				}
				group.push(candidate);
			}
			remaining = leftover;
			if (group.length < 2) continue; // ungrouped anchor becomes a swap-in below
			groups.push({
				id: `ready-${group.map((d) => d.id).join('-')}`,
				title: `${PLAY_STYLE_LABELS[style]} ${styleNumbers[style]++}`,
				playStyle: style,
				dogs: group,
				dogIds: group.map((d) => d.id),
				reason: groupReason(group, heldOutForIntact),
				recommendationType: 'ready_group',
				priority: 'high'
			});
			group.forEach((d) => groupedIds.add(d.id));
		}
	}

	// Style-tagged dogs with known weight that didn't land in any group
	const swapIns: SwapInSuggestion[] = ready
		.filter(
			(d) =>
				!groupedIds.has(d.id) &&
				!needsPlayAssessment(d) &&
				!dogPlayStyles(d).every((s) => s === 'solo') &&
				d.weightLbs !== null &&
				d.weightLbs !== undefined
		)
		.map((dog) => ({
			dog,
			compatibleGroups: groups.filter(
				(g) =>
					dogPlayStyles(dog).includes(g.playStyle) &&
					sizeCompatible([...g.dogs, dog]) &&
					energyCompatible(g.dogs, dog) &&
					puppyCompatible(g.dogs, dog, puppyExperienced) &&
					!intactConflict([...g.dogs, dog])
			)
		}));

	return { groups, swapIns, needsAssessment };
}

export function buildTestSuggestions(caution: Dog[], readyGroups: PlaygroupRecommendation[]): TestSuggestion[] {
	return caution.map((dog) => {
		const dogEnergy = dogEnergyRank(dog);
		const compatible = readyGroups.filter((g) => {
			if (intactConflict([dog, ...g.dogs])) return false;
			if (!sizeCompatible([dog, ...g.dogs])) return false;
			return true;
		});
		const match = compatible.sort((a, b) => {
			const avgA = a.dogs.reduce((s, d) => s + dogEnergyRank(d), 0) / a.dogs.length;
			const avgB = b.dogs.reduce((s, d) => s + dogEnergyRank(d), 0) / b.dogs.length;
			return Math.abs(avgA - dogEnergy) - Math.abs(avgB - dogEnergy);
		})[0] ?? null;
		return {
			id: `test-${dog.id}`,
			dog,
			suggestedGroup: match,
			reason: guidanceForDog(dog)
		};
	});
}

