import type { Dog, PlaygroupSession } from '$lib/types';
import { daysSince, toDate } from '$lib/utils/dates';
import { dogAgeWeeks, isSurgeryResting } from '$lib/utils/attention';

export type DogReadiness = 'ready' | 'caution' | 'hold';
export type RecommendationPriority = 'high' | 'medium';

export interface PlaygroupRecommendation {
	id: string;
	title: string;
	dogs: Dog[];
	dogIds: string[];
	reason: string;
	recommendationType: PlaygroupSession['recommendationType'];
	priority: RecommendationPriority;
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

// 2+ vaccine rounds AND last shot at least 14 days ago
export function isPuppyVaccinated(dog: Dog): boolean {
	if (dog.vaccineCount < 2) return false;
	const vaccDate = toDate(dog.vaccinatedDate);
	if (!vaccDate) return false;
	return Math.floor((Date.now() - vaccDate.getTime()) / 86_400_000) >= 14;
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
		if (isPuppy(dog)) return 'Puppy (12+ wks, vaccinated): OK with energetic adults that tolerate rough play. Do a controlled intro.';
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
	if (heldOutForIntact > 0) parts.push('intact M/F kept separate');
	return parts.join(' · ');
}

export function buildRecommendations(ready: Dog[]): { groups: PlaygroupRecommendation[]; swapIns: SwapInSuggestion[] } {
	const groups: PlaygroupRecommendation[] = [];
	const groupedIds = new Set<string>();

	const knownWeight = [...ready.filter((d) => d.weightLbs !== null && d.weightLbs !== undefined)]
		.sort((a, b) => sizeRank(a) - sizeRank(b) || dogEnergyRank(a) - dogEnergyRank(b) || a.name.localeCompare(b.name));

	// Repeatedly seed a group with the lightest ungrouped dog. Dogs that don't
	// fit (size window, energy band, or an intact conflict) stay in the pool and
	// get their own chance to anchor a later group — a single mismatch no longer
	// discards everyone around it.
	let groupNumber = 1;
	let remaining = knownWeight;
	while (remaining.length > 0) {
		const [anchor, ...rest] = remaining;
		const group: Dog[] = [anchor];
		const leftover: Dog[] = [];
		let heldOutForIntact = 0;
		for (const candidate of rest) {
			// Anchor is the group's lightest dog, so pairwise size check with it
			// bounds the whole group's spread.
			if (group.length >= 4 || !sizeCompatible([anchor, candidate]) || !energyCompatible(group, candidate)) {
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
			title: `Ready Group ${groupNumber++}`,
			dogs: group,
			dogIds: group.map((d) => d.id),
			reason: groupReason(group, heldOutForIntact),
			recommendationType: 'ready_group',
			priority: 'high'
		});
		group.forEach((d) => groupedIds.add(d.id));
	}

	// Dogs with known weight that didn't land in any group
	const swapIns: SwapInSuggestion[] = knownWeight
		.filter((d) => !groupedIds.has(d.id))
		.map((dog) => ({
			dog,
			compatibleGroups: groups.filter(
				(g) => sizeCompatible([...g.dogs, dog]) && energyCompatible(g.dogs, dog) && !intactConflict([...g.dogs, dog])
			)
		}));

	return { groups, swapIns };
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

