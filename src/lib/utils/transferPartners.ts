import type { DateValue, Dog } from '$lib/types';
import { toDate } from '$lib/utils/dates';

/**
 * Adoptability by intake source.
 *
 * ASM only serves animals currently in the shelter, so it can't answer this on its own —
 * the dogs that answer it are the ones that already left. Firestore keeps them: the ASM
 * sync archives departed dogs (status + leftShelterDate) instead of deleting, so the dogs
 * collection is the shelter's own outcome history and it deepens every month.
 *
 * Current dogs alone would be actively misleading here. A dog still in the building is by
 * definition one nobody has adopted yet, so ranking partners on the current population
 * punishes whoever sent dogs longest ago. Departed dogs carry the real signal; current
 * dogs are reported separately as a waiting-list view.
 */

export type Adoptability = 'low' | 'moderate' | 'high';
export type Confidence = 'none' | 'low' | 'moderate' | 'good';

export interface PartnerRow {
	partner: string;
	/** Raw origin strings folded into this partner, so the grouping stays auditable. */
	origins: string[];
	total: number;
	current: number;
	departed: number;
	adopted: number;
	transferredOut: number;
	euthanized: number;
	/**
	 * Dogs that came back after adoption. Reported but deliberately NOT scored — a return
	 * says something about the match we made or the adopter, not about the dog the
	 * sending shelter handed us.
	 */
	returned: number;
	/** Needed staff-only or manager-only handling, or carried a behaviour hold. */
	behaviorSupport: number;
	/** Carried a medical hold, recorded health problems, or a sick hold. */
	medicalSupport: number;
	/** Flagged for either reason — the denominator for the support signal. */
	needsSupport: number;
	medianDaysToAdoption: number | null;
	medianDaysWaitingNow: number | null;
	/** Current dogs waiting longer than LONG_STAY_DAYS. */
	longStayNow: number;
	confidence: Confidence;
	/** Null whenever the sample is too thin to say anything honest. */
	rating: Adoptability | null;
}

export interface PartnerAnalysis {
	rows: PartnerRow[];
	shelterMedianDaysToAdoption: number | null;
	totalDogs: number;
	departedDogs: number;
	/** Origins that matched no known partner, so nothing is silently dropped. */
	unmatchedOrigins: string[];
}

/**
 * The sources the survey asks about, in its own order. Every one gets a row even with
 * no dogs on record — "we have nothing on Rose/Elvia" is an answer, and silently
 * dropping the row would read as though the question had been skipped.
 */
export const SURVEY_PARTNERS = [
	'Rose/Elvia',
	'Brenham',
	'Owner surrenders',
	'Bi-Stone',
	'LA County / Paws for Life',
	'Utah shelters'
] as const;

/** The survey's own four-way vocabulary. */
export function adoptabilityLabel(rating: Adoptability | null): string {
	if (rating === 'low') return 'Low adoptability';
	if (rating === 'moderate') return 'Moderate adoptability';
	if (rating === 'high') return 'High adoptability';
	return 'Unsure';
}

export const LONG_STAY_DAYS = 90;

/** Below this many departed dogs, a partner gets numbers but no rating. */
export const MIN_SAMPLE_FOR_RATING = 5;

const PARTNER_RULES: { partner: string; test: RegExp }[] = [
	{ partner: 'Rose/Elvia', test: /\brose\b|\belvia\b/i },
	{ partner: 'Brenham', test: /brenham/i },
	{ partner: 'Bi-Stone', test: /bi[-\s]?stone/i },
	{ partner: 'LA County / Paws for Life', test: /paws\s*for\s*life|los\s*angeles|\bl\.?\s*a\.?\s*county\b/i },
	{ partner: 'Owner surrenders', test: /surrender/i }
];

// Utah senders, by state token or by the specific shelters that transfer to us.
const UTAH_TEST =
	/(^|[^a-z])(ut|utah)([^a-z]|$)|emery|tremonton|davis county|roosevelt|nuzzles|cache|logan|box elder|weber|uintah|duchesne|tooele|sanpete|sevier|carbon county|millard|juab|iron county|washington county|salt lake|provo|ogden|st\.?\s*george/i;

export function classifyOrigin(origin: string | null | undefined): string {
	const value = (origin ?? '').trim();
	if (!value) return 'Unrecorded';
	for (const rule of PARTNER_RULES) {
		if (rule.test.test(value)) return rule.partner;
	}
	if (UTAH_TEST.test(value)) return 'Utah shelters';
	return 'Other / unmatched';
}

/**
 * Dogs that took more than a standard kennel to place. Read off the flags staff set
 * while the dog was here — imperfect, since a dog can develop problems after arriving,
 * but it is the only record of what actually walked through the door.
 */
function hasBehaviorSupport(dog: Dog): boolean {
	const level = dog.handlingLevel;
	if (level === 'staff_only' || level === 'manager_only') return true;
	if (dog.dayTripIneligibleReason === 'behavior') return true;
	if (dog.dayTripManagerOnlyReason === 'behavior') return true;
	return Boolean(dog.warningNotes?.trim());
}

function hasMedicalSupport(dog: Dog): boolean {
	if (dog.dayTripIneligibleReason === 'medical') return true;
	if (dog.dayTripManagerOnlyReason === 'medical') return true;
	if (dog.sickHold) return true;
	return Boolean(dog.healthProblems?.trim());
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function daysBetween(from: DateValue | string | null | undefined, to: Date): number | null {
	const start = toDate(from);
	if (!start) return null;
	const days = Math.floor((to.getTime() - start.getTime()) / 86_400_000);
	return days >= 0 ? days : null;
}

function confidenceFor(departed: number): Confidence {
	if (departed === 0) return 'none';
	if (departed < MIN_SAMPLE_FOR_RATING) return 'low';
	if (departed < 15) return 'moderate';
	return 'good';
}

/**
 * Three signals. Two are outcomes, measured against how this shelter actually performs:
 * did the dog get adopted at all rather than moved on or put down, and did it take
 * longer than the shelter's own median. The third is the condition the dogs arrived in —
 * how many needed behavioural or medical support to be placeable at all.
 *
 * Returns are excluded on purpose: a dog coming back reflects the match and the adopter,
 * not the shelter that sent it.
 */
function rate(row: Omit<PartnerRow, 'rating' | 'confidence'>, shelterMedian: number | null): Adoptability | null {
	if (row.departed < MIN_SAMPLE_FOR_RATING) return null;
	const outcomes = row.adopted + row.transferredOut + row.euthanized;
	if (outcomes === 0) return null;

	const adoptionRate = row.adopted / outcomes;
	let score = 0;
	if (adoptionRate >= 0.85) score += 2;
	else if (adoptionRate >= 0.6) score += 1;
	else if (adoptionRate >= 0.4) score += 0;
	// Most dogs leaving by some route other than adoption is the strongest bad signal
	// there is, and it has to outweigh everything else on its own.
	else score -= 2;

	if (shelterMedian !== null && row.medianDaysToAdoption !== null) {
		const ratio = row.medianDaysToAdoption / shelterMedian;
		if (ratio <= 0.75) score += 2;
		else if (ratio <= 1.25) score += 1;
		else if (ratio <= 2) score += 0;
		// Past twice the shelter's median the penalty scales, even when the dogs do all
		// eventually go home — it's kennel weeks these dogs cost.
		else if (ratio <= 3) score -= 1;
		else score -= 2;
	}

	// Condition on arrival. Uses every dog on record, not just departed ones — a partner's
	// current kennel of hard cases counts as much as the ones already placed.
	if (row.total > 0) {
		const supportRate = row.needsSupport / row.total;
		if (supportRate <= 0.2) score += 1;
		else if (supportRate > 0.5) score -= 1;
	}

	if (score >= 4) return 'high';
	if (score >= 2) return 'moderate';
	return 'low';
}

export function analyzeTransferPartners(dogs: Dog[], today = new Date()): PartnerAnalysis {
	const groups = new Map<string, Dog[]>();
	const originsByPartner = new Map<string, Set<string>>();
	const unmatched = new Set<string>();

	for (const partner of SURVEY_PARTNERS) groups.set(partner, []);

	for (const dog of dogs) {
		const partner = classifyOrigin(dog.origin);
		if (!groups.has(partner)) groups.set(partner, []);
		groups.get(partner)!.push(dog);

		const raw = (dog.origin ?? '').trim();
		if (raw) {
			if (!originsByPartner.has(partner)) originsByPartner.set(partner, new Set());
			originsByPartner.get(partner)!.add(raw);
			if (partner === 'Other / unmatched') unmatched.add(raw);
		}
	}

	// The shelter's own median is the yardstick — an absolute day count would say more
	// about the season and the local market than about any partner.
	const allAdoptionDays: number[] = [];
	for (const dog of dogs) {
		if (dog.status !== 'adopted') continue;
		const days = adoptionDays(dog);
		if (days !== null) allAdoptionDays.push(days);
	}
	const shelterMedian = median(allAdoptionDays);

	const rows: PartnerRow[] = [];
	for (const [partner, list] of groups) {
		const current = list.filter((d) => d.status === 'active');
		const adopted = list.filter((d) => d.status === 'adopted');
		const transferredOut = list.filter((d) => d.status === 'transferred');
		const euthanized = list.filter((d) => d.status === 'euthanized');
		const departed = adopted.length + transferredOut.length + euthanized.length;

		const adoptionDaysList = adopted
			.map(adoptionDays)
			.filter((d): d is number => d !== null);
		const waitingDaysList = current
			.map((d) => daysBetween(d.intakeDate, today))
			.filter((d): d is number => d !== null);

		const base = {
			partner,
			origins: [...(originsByPartner.get(partner) ?? [])].sort(),
			total: list.length,
			current: current.length,
			departed,
			adopted: adopted.length,
			transferredOut: transferredOut.length,
			euthanized: euthanized.length,
			returned: list.filter((d) => (d.reentryDates?.length ?? 0) > 0).length,
			behaviorSupport: list.filter(hasBehaviorSupport).length,
			medicalSupport: list.filter(hasMedicalSupport).length,
			needsSupport: list.filter((d) => hasBehaviorSupport(d) || hasMedicalSupport(d)).length,
			medianDaysToAdoption: median(adoptionDaysList),
			medianDaysWaitingNow: median(waitingDaysList),
			longStayNow: waitingDaysList.filter((d) => d >= LONG_STAY_DAYS).length
		};

		rows.push({ ...base, confidence: confidenceFor(departed), rating: rate(base, shelterMedian) });
	}

	// Survey order first so the table lines up with the form being filled in; anything
	// else follows, largest first.
	const surveyIndex = (partner: string) => {
		const i = (SURVEY_PARTNERS as readonly string[]).indexOf(partner);
		return i === -1 ? Number.MAX_SAFE_INTEGER : i;
	};
	rows.sort(
		(a, b) =>
			surveyIndex(a.partner) - surveyIndex(b.partner) ||
			b.total - a.total ||
			a.partner.localeCompare(b.partner)
	);

	return {
		rows,
		shelterMedianDaysToAdoption: shelterMedian,
		totalDogs: dogs.length,
		departedDogs: allAdoptionDays.length,
		unmatchedOrigins: [...unmatched].sort()
	};
}

function adoptionDays(dog: Dog): number | null {
	const left = toDate(dog.leftShelterDate);
	if (!left) return null;
	return daysBetween(dog.intakeDate, left);
}
