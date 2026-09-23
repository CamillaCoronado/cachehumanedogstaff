import type { Dog, UserRole } from '$lib/types';
import { checkDayTripEligibility, daysSince, sinceReturn } from '$lib/utils/dates';
import {
	clockStart,
	enrichmentOverdueDays,
	getBathStatus,
	getDayTripGapDays,
	isBathDue,
	isPlaygroupEligible,
	needsDogTest,
	DAYTRIP_OVERDUE_DAYS,
	PLAYGROUP_OVERDUE_DAYS
} from '$lib/utils/attention';

/**
 * Every rule for what a dog needs doing, in one place. The dog card and the dashboard's
 * Needs attention list both read from here, so a dog is flagged on one exactly when it
 * is flagged on the other. Add a rule here and both pick it up.
 */

export type TripEligibility = ReturnType<typeof checkDayTripEligibility>;

/** Day-trip eligibility for this dog as `role` sees it — handling rules depend on the viewer. */
export function tripEligibilityFor(dog: Dog, role: UserRole | null | undefined, today: Date): TripEligibility {
	return checkDayTripEligibility(
		dog.intakeDate,
		dog.isVaccinated,
		dog.isFixed,
		dog.dayTripStatus,
		dog.isolationStatus,
		dog.dayTripIneligibleReason,
		dog.dayTripManagerOnlyReason,
		dog.dayTripNotes,
		dog.handlingLevel,
		dog.surgeryDate,
		dog.surgeryRestDays,
		dog.awaitingEvaluation,
		role,
		today,
		dog.dateOfBirth,
		dog.vaccineCount,
		dog.vaccinesOutstanding,
		dog.dayTripPuppyOverride,
		dog.sickHold
	);
}

export type AttentionKind = 'bath' | 'enrichment' | 'daytrip' | 'playgroup' | 'dogtest';

export interface AttentionFlag {
	kind: AttentionKind;
	/** Full sentence, as the dog card shows it. */
	label: string;
	/** Short tag, as the Needs attention list shows it. */
	short: string;
	/** For ordering: how long it has been waiting. */
	days: number;
	/** Card ordering; higher shows first. */
	priority: number;
	tone: 'ready' | 'blocked' | 'info';
	action?: 'log_bath';
}

export interface AttentionContext {
	today: Date;
	/** Most recent non-cancelled playgroup, from any stay. */
	lastPlaygroupDate: Date | null;
	/** Day-trip eligibility as the viewer sees it (handling rules depend on role). */
	tripEligibility: TripEligibility;
}

/**
 * Traits not yet recorded. Shown on the dog's profile for reference only — the one
 * evaluation the shelter asks for is the dog test, which is its own flag below.
 */
export function missingEvaluations(dog: Dog) {
	const missing: string[] = [];
	if (dog.goodWithDogs === 'unknown') missing.push('dogs');
	if (dog.goodWithCats === 'unknown') missing.push('cats');
	if (dog.goodWithKids === 'unknown') missing.push('kids');
	if (dog.pottyTrained === 'unknown') missing.push('potty training');
	if (dog.energyLevel === 'unknown') missing.push('energy');
	if ((dog.goodOnLead ?? 'unknown') === 'unknown') missing.push('on-lead');
	if ((dog.crateTrained ?? 'unknown') === 'unknown') missing.push('crate');
	return missing;
}

const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export function dogAttention(dog: Dog, ctx: AttentionContext): AttentionFlag[] {
	const { today, lastPlaygroupDate, tripEligibility } = ctx;
	const flags: AttentionFlag[] = [];
	// Foster dogs are cared for elsewhere, and isolation dogs by the clinic: neither is
	// on the shelter's to-do list. Incoming dogs are — transfers arrive through Incoming.
	if (dog.status !== 'active' || dog.inFoster || dog.permanentFoster) return flags;
	if (dog.isolationStatus !== 'none') return flags;

	// Days since the clocks started: reaching the floor, or back from foster.
	const arrivedDays = daysSince(clockStart(dog), today) ?? 0;

	if (isBathDue(dog, today)) {
		const bath = getBathStatus(dog, today);
		const overdue = bath.overdueDays ?? 0;
		flags.push({
			kind: 'bath',
			label: bath.isNewIntake
				? 'Bath needed (new intake).'
				: overdue > 0
					? `Bath overdue by ${dayWord(overdue)}.`
					: 'Bath is due.',
			short: bath.isNewIntake ? `bath · new intake · ${bath.daysSinceArrival}d` : `bath · ${overdue}d overdue`,
			days: bath.isNewIntake ? bath.daysSinceArrival : overdue,
			priority: 59,
			tone: 'ready',
			action: 'log_bath'
		});
	}

	const enrichment = enrichmentOverdueDays(dog, lastPlaygroupDate, today);
	if (enrichment !== null) {
		flags.push({
			kind: 'enrichment',
			label: `No day trip, playgroup or yard time in ${dayWord(enrichment)}.`,
			short: `no enrichment · ${enrichment}d`,
			days: enrichment,
			priority: 67,
			tone: 'info'
		});
	}

	if (!dog.isOutOnDayTrip && !dog.awaitingEvaluation && tripEligibility.eligible) {
		const gap = getDayTripGapDays(dog, today);
		if (gap === null) {
			flags.push({ kind: 'daytrip', label: 'No day trip logged yet.', short: 'no day trip yet', days: arrivedDays, priority: 68, tone: 'info' });
		} else if (gap >= DAYTRIP_OVERDUE_DAYS) {
			flags.push({ kind: 'daytrip', label: `${gap} days since last day trip — overdue.`, short: `day trip · ${gap}d`, days: gap, priority: 66, tone: 'info' });
		}
	}

	if (isPlaygroupEligible(dog, today)) {
		const gap = daysSince(sinceReturn(lastPlaygroupDate, clockStart(dog)), today);
		if (gap === null) {
			flags.push({ kind: 'playgroup', label: 'No playgroup logged yet.', short: 'no playgroup yet', days: arrivedDays, priority: 63, tone: 'info' });
		} else if (gap >= PLAYGROUP_OVERDUE_DAYS) {
			flags.push({ kind: 'playgroup', label: `${gap} days since last playgroup — overdue.`, short: `playgroup · ${gap}d`, days: gap, priority: 62, tone: 'info' });
		}
	}

	if (needsDogTest(dog, lastPlaygroupDate !== null, today)) {
		flags.push({
			kind: 'dogtest',
			label: 'Needs a dog compatibility test — never been in a playgroup.',
			short: `test compatibility · ${arrivedDays}d`,
			days: arrivedDays,
			priority: 61,
			tone: 'blocked'
		});
	}

	// Cats, kids, potty training, energy and the rest are not asked for: the dog test
	// above is the only evaluation the shelter requires.

	return flags;
}
