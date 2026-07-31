import type { Dog, DogPlayStyle, PlaygroupSession } from '$lib/types';
import { daysSince, toDate } from '$lib/utils/dates';
import { dogAgeWeeks, isPuppyVaccinated, isSurgeryResting } from '$lib/utils/attention';

export { isPuppyVaccinated };

export type DogReadiness = 'ready' | 'caution' | 'hold';

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
	reason: string;
}

export function isPuppy(dog: Dog): boolean {
	const weeks = dogAgeWeeks(dog, new Date());
	return weeks !== null && weeks < 26;
}

export function getReadiness(dog: Dog): DogReadiness {
	if (dog.isolationStatus !== 'none' || dog.sickHold || dog.goodWithDogs === 'no') return 'hold';
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
		if (dog.sickHold) return 'Sick (outbreak hold): no playgroups.';
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

export function sizeCategory(dog: Dog): 'tiny' | 'small' | 'medium' | 'large' | 'unknown' {
	if (dog.weightLbs === null || dog.weightLbs === undefined) return 'unknown';
	if (dog.weightLbs < 15) return 'tiny';
	if (dog.weightLbs < 30) return 'small';
	if (dog.weightLbs <= 55) return 'medium';
	return 'large';
}

export function sizeLabelShort(dog: Dog): string {
	const s = sizeCategory(dog);
	if (s === 'unknown') return '?';
	if (s === 'tiny') return 'T';
	if (s === 'small') return 'S';
	if (s === 'medium') return 'M';
	return 'L';
}

// Dogs sorted into play-style buckets — purely from staff-assessed tags, no
// size/energy grouping. A dog tagged both rough & gentle lands in `both`
// (shown between the two single-style columns) instead of appearing twice.
// Solo-tagged dogs are excluded here; they live in the dedicated Solo column.
export interface PlayStyleBuckets {
	roughOnly: Dog[];
	both: Dog[];
	gentleOnly: Dog[];
	unassessed: Dog[];
}

export function bucketByPlayStyle(ready: Dog[]): PlayStyleBuckets {
	const roughOnly: Dog[] = [];
	const both: Dog[] = [];
	const gentleOnly: Dog[] = [];
	const unassessed: Dog[] = [];

	for (const dog of ready) {
		const styles = dogPlayStyles(dog);
		if (styles.includes('solo')) continue;
		const hasRough = styles.includes('rough_and_rowdy');
		const hasGentle = styles.includes('gentle_and_dainty');
		if (hasRough && hasGentle) both.push(dog);
		else if (hasRough) roughOnly.push(dog);
		else if (hasGentle) gentleOnly.push(dog);
		else unassessed.push(dog);
	}

	const byName = (a: Dog, b: Dog) => a.name.localeCompare(b.name);
	return {
		roughOnly: roughOnly.sort(byName),
		both: both.sort(byName),
		gentleOnly: gentleOnly.sort(byName),
		unassessed: unassessed.sort(byName)
	};
}

export function buildTestSuggestions(caution: Dog[]): TestSuggestion[] {
	return caution.map((dog) => ({
		id: `test-${dog.id}`,
		dog,
		reason: guidanceForDog(dog)
	}));
}

// ─── Selection-time assist ──────────────────────────────────────────────────
// Two kinds of help for staff building a session by hand, replacing the old
// auto-grouping engine: (1) flag facts that are objectively true and unsafe
// to ignore — not judgment calls; (2) surface pairs with a real track record
// together, pulled from actual outcomes rather than inferred from energy/size.

export interface SelectionWarning {
	id: string;
	message: string;
}

export function checkSelectionWarnings(selected: Dog[]): SelectionWarning[] {
	const warnings: SelectionWarning[] = [];

	for (const dog of selected) {
		if (dog.isolationStatus !== 'none') {
			warnings.push({ id: `iso-${dog.id}`, message: `${dog.name} is in isolation.` });
		} else if (dog.sickHold) {
			warnings.push({ id: `sick-${dog.id}`, message: `${dog.name} is on a sick (outbreak) hold — no playgroups.` });
		} else if (isSurgeryResting(dog, new Date())) {
			warnings.push({ id: `med-${dog.id}`, message: `${dog.name} is on medical/surgery rest.` });
		}
	}

	const intactMales = selected.filter((d) => !d.isFixed && d.sex === 'male');
	const intactFemales = selected.filter((d) => !d.isFixed && d.sex === 'female');
	if (intactMales.length > 0 && intactFemales.length > 0) {
		warnings.push({
			id: 'intact-conflict',
			message: `Intact male (${intactMales.map((d) => d.name).join(', ')}) and intact female (${intactFemales.map((d) => d.name).join(', ')}) together — keep separate.`
		});
	}

	const known = selected.filter((d) => d.weightLbs !== null && d.weightLbs !== undefined);
	if (known.length >= 2) {
		const hasTiny = known.some((d) => sizeCategory(d) === 'tiny');
		const hasNonTiny = known.some((d) => sizeCategory(d) !== 'tiny');
		const weights = known.map((d) => d.weightLbs as number);
		const min = Math.min(...weights);
		const max = Math.max(...weights);
		if ((hasTiny && hasNonTiny) || max > min * 2) {
			warnings.push({
				id: 'size-mismatch',
				message: `Wide size spread (${min}–${max} lbs) — double check this pairing.`
			});
		}
	}

	return warnings;
}

export interface KnownPairHint {
	dogIds: [string, string];
	count: number;
	lastDate: Date;
}

// Pairs among the currently-selected dogs that have actually played together
// successfully before, newest/most-frequent first. Names are deliberately not
// included here — dogNames on older sessions can be positionally misaligned
// with dogIds (see the History-edit off-roster-name fix), so callers should
// resolve display names from the live dog list instead.
export function findKnownGoodPairs(selectedDogIds: string[], sessions: PlaygroupSession[]): KnownPairHint[] {
	const selectedSet = new Set(selectedDogIds);
	const pairMap = new Map<string, { count: number; lastDate: Date }>();

	for (const session of sessions) {
		if (session.outcome !== 'successful') continue;
		const relevant = session.dogIds.filter((id) => selectedSet.has(id));
		if (relevant.length < 2) continue;
		const date = toDate(session.date);
		if (!date) continue;

		for (let i = 0; i < relevant.length; i++) {
			for (let j = i + 1; j < relevant.length; j++) {
				const [a, b] = [relevant[i], relevant[j]].sort();
				const key = `${a}|${b}`;
				const existing = pairMap.get(key);
				if (existing) {
					existing.count++;
					if (date.getTime() > existing.lastDate.getTime()) existing.lastDate = date;
				} else {
					pairMap.set(key, { count: 1, lastDate: date });
				}
			}
		}
	}

	return Array.from(pairMap.entries())
		.map(([key, v]) => {
			const [a, b] = key.split('|');
			return { dogIds: [a, b] as [string, string], count: v.count, lastDate: v.lastDate };
		})
		.sort((a, b) => b.count - a.count || b.lastDate.getTime() - a.lastDate.getTime());
}
