import { startOfDay } from 'date-fns';
import { bathEligible, checkDayTripEligibility, daysSince, dogStripeColor, isSameCalendarDay, sinceReturn, toDate } from '$lib/utils/dates';
import type { Dog, PlaygroupSession } from '$lib/types';

// A dog under this age is a puppy: presumed good with dogs/cats/kids (no
// compatibility test needed) and subject to puppy playgroup rules instead.
export const PUPPY_AGE_WEEKS = 26;

export function isDayTripEligible(dog: Dog, today = new Date()): boolean {
	if (dog.isOutOnDayTrip) return false;
	// A red dog (its single source-of-truth color) is never eligible.
	if (dogStripeColor(dog) === 'red') return false;
	return checkDayTripEligibility(
		dog.intakeDate, dog.isVaccinated, dog.isFixed, dog.dayTripStatus,
		dog.isolationStatus, dog.dayTripIneligibleReason,
		dog.dayTripManagerOnlyReason, dog.dayTripNotes, dog.handlingLevel,
		dog.surgeryDate, dog.surgeryRestDays, dog.awaitingEvaluation,
		null, today, dog.dateOfBirth, dog.vaccineCount, dog.vaccinesOutstanding,
		dog.dayTripPuppyOverride, dog.sickHold
	).eligible;
}

// ─── Dogs to Test ────────────────────────────────────────────────────────────
// Active shelter dogs marked unknown for dog compatibility with no playgroup
// history at all (sessions from any stay, including before foster, count).
// Puppies are exempt — they're presumed good with dogs/cats/kids and don't
// need a compatibility test.

export function getCautionDogs(dogs: Dog[], sessions: PlaygroupSession[], today = new Date()): Dog[] {
	// Build a map of dogId → most recent session date (ms). A cancelled session
	// means no play actually happened, so it shouldn't count as an assessment.
	const lastSessionMs: Record<string, number> = {};
	for (const s of sessions) {
		if (s.outcome === 'cancelled') continue;
		const t = toDate(s.date)?.getTime();
		if (!t) continue;
		for (const id of s.dogIds) {
			if (!lastSessionMs[id] || t > lastSessionMs[id]) lastSessionMs[id] = t;
		}
	}

	return dogs.filter((dog) => needsDogTest(dog, lastSessionMs[dog.id] !== undefined, today));
}

/** Unknown with other dogs and never in a playgroup — puppies exempt. */
export function needsDogTest(dog: Dog, hasPlayed: boolean, today = new Date()): boolean {
	if (dog.isolationStatus !== 'none') return false;
	if (dog.goodWithDogs !== 'unknown') return false;
	const ageWeeks = dogAgeWeeks(dog, today);
	if (ageWeeks !== null && ageWeeks < PUPPY_AGE_WEEKS) return false;
	return !hasPlayed;
}

// ─── Thresholds ──────────────────────────────────────────────────────────────

export const BATH_OVERDUE_DAYS = 30;
export const DAYTRIP_OVERDUE_DAYS = 14;
export const PLAYGROUP_OVERDUE_DAYS = 14;

// ─── Bath ────────────────────────────────────────────────────────────────────

export interface BathStatus {
	isDue: boolean;
	isNewIntake: boolean;
	overdueDays: number | null;
	daysSinceArrival: number;
}

export function getBathStatus(dog: Dog, today: Date): BathStatus {
	const absent = { isDue: false, isNewIntake: false, overdueDays: null, daysSinceArrival: 0 };
	if (!bathEligible(dog.surgeryDate, today)) return absent;

	// A real bath counts if it was given this stay (on or after intake — including while
	// the dog was still in Incoming). Moving off Incoming is not a bath; coming back from
	// foster is, since fosters bathe the dogs. The later of the two is the last bath.
	const intakeMs = toDate(dog.intakeDate)?.getTime() ?? 0;
	const bathMs = toDate(dog.lastBathDate)?.getTime() ?? 0;
	const bathCountsForStay =
		dog.lastBathDate != null &&
		(bathMs >= intakeMs || isSameCalendarDay(dog.lastBathDate, dog.intakeDate));
	const realBath = bathCountsForStay ? dog.lastBathDate : null;
	const fosterReturn = fosterReturnDate(dog);
	const fosterMs = toDate(fosterReturn)?.getTime() ?? null;
	const effectiveBathDate: Dog['lastBathDate'] | string | null =
		fosterMs !== null && (!realBath || fosterMs > bathMs) ? fosterReturn : realBath;

	const days = daysSince(effectiveBathDate, today);
	const isNewIntake = !effectiveBathDate;
	const daysSinceArrival = daysSince(dog.shelterSince ?? dog.intakeDate, today) ?? 0;

	if (isNewIntake) return { isDue: true, isNewIntake: true, overdueDays: null, daysSinceArrival };
	if (days !== null && days >= BATH_OVERDUE_DAYS) {
		return { isDue: true, isNewIntake: false, overdueDays: days - BATH_OVERDUE_DAYS, daysSinceArrival };
	}
	return absent;
}

/**
 * When the dog last came back from foster, if it did. Older returns re-stamped
 * shelterSince instead; the Admin page's repair moves those into fosterReturnedAt.
 */
export function fosterReturnDate(dog: Dog): Dog['fosterReturnedAt'] | string | null {
	return dog.fosterReturnedAt ?? null;
}

/**
 * Where the enrichment, day trip and playgroup clocks start: reaching the floor (or
 * intake), or coming back from foster, whichever is later. Length of stay is not this —
 * it stays shelterSince ?? intakeDate, which a stay in foster does not reset.
 */
export function clockStart(dog: Dog): Dog['intakeDate'] | string | null {
	const stay = dog.shelterSince ?? dog.intakeDate ?? null;
	const back = dog.fosterReturnedAt ?? null;
	if (!back) return stay;
	if (!stay) return back;
	return (toDate(back)?.getTime() ?? 0) > (toDate(stay)?.getTime() ?? 0) ? back : stay;
}

export interface BathAttentionItem {
	dog: Dog;
	days: number;
	isNewIntake: boolean;
}

export function getBathAttentionDogs(dogs: Dog[], today: Date): BathAttentionItem[] {
	const items: BathAttentionItem[] = [];
	for (const dog of dogs) {
		const status = getBathStatus(dog, today);
		if (!status.isDue) continue;
		items.push({
			dog,
			days: status.isNewIntake ? status.daysSinceArrival : (status.overdueDays ?? 0),
			isNewIntake: status.isNewIntake
		});
	}
	return items;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

export function getDayTripGapDays(dog: Dog, today: Date): number | null {
	return daysSince(sinceReturn(dog.lastDayTripDate, clockStart(dog)), today);
}

export function buildLastPlaygroupMap(sessions: PlaygroupSession[]): Record<string, Date> {
	const map: Record<string, Date> = {};
	for (const s of sessions) {
		// A cancelled session means the dog didn't actually get playgroup time —
		// it shouldn't reset the enrichment clock.
		if (s.outcome === 'cancelled') continue;
		const d = toDate(s.date);
		if (!d) continue;
		for (const id of s.dogIds) {
			if (!map[id] || d.getTime() > map[id].getTime()) map[id] = d;
		}
	}
	return map;
}

export function isBathDue(dog: Dog, today: Date): boolean {
	if (dog.inFoster) return false;
	return getBathStatus(dog, today).isDue;
}

export function isSurgeryResting(dog: Dog, today: Date): boolean {
	const surgeryDateObj = toDate(dog.surgeryDate);
	const surgeryDaysAgo = surgeryDateObj
		? Math.round((today.getTime() - startOfDay(surgeryDateObj).getTime()) / 86_400_000)
		: null;
	if (surgeryDaysAgo !== null && surgeryDaysAgo >= 0 && surgeryDaysAgo < (dog.surgeryRestDays ?? 0)) return true;
	if (dog.dayTripStatus === 'ineligible' && dog.dayTripIneligibleReason === 'medical') return true;
	return false;
}

export function dogAgeWeeks(dog: Dog, today: Date): number | null {
	const dob = toDate(dog.dateOfBirth);
	if (!dob) return null;
	return Math.floor((today.getTime() - dob.getTime()) / (7 * 86_400_000));
}

// Puppy playgroup vaccination gate: 2+ vaccine rounds AND last shot at least
// 14 days ago (parvo immunity window).
export function isPuppyVaccinated(dog: Dog): boolean {
	if (dog.vaccineCount < 2) return false;
	const vaccDate = toDate(dog.vaccinatedDate);
	if (!vaccDate) return false;
	return Math.floor((Date.now() - vaccDate.getTime()) / 86_400_000) >= 14;
}

export function isPlaygroupEligible(dog: Dog, today: Date): boolean {
	const ageWeeks = dogAgeWeeks(dog, today);
	const isPuppyAge = ageWeeks !== null && ageWeeks < PUPPY_AGE_WEEKS;
	// Adults need a confirmed 'yes'; puppies can play (with each other or with
	// puppy-experienced adults) as long as they're not marked 'no'.
	if (dog.goodWithDogs === 'no') return false;
	if (dog.goodWithDogs !== 'yes' && !isPuppyAge) return false;
	if (!isPuppyAge && !dog.isFixed) return false;
	if (dog.isolationStatus !== 'none') return false;
	if (dog.awaitingEvaluation) return false;

	// Puppies join playgroups once 12+ weeks old and through the vaccination window.
	if (isPuppyAge && (ageWeeks < 12 || !isPuppyVaccinated(dog))) return false;

	if (isSurgeryResting(dog, today)) return false;

	const availableSince = clockStart(dog);
	const availableMs = toDate(availableSince)?.getTime() ?? 0;
	const readyDate = toDate(dog.playgroupReadyDate) ?? new Date(availableMs + 7 * 86_400_000);
	return today >= readyDate;
}

// ─── Enrichment ──────────────────────────────────────────────────────────────
// Enrichment = day trip, playgroup, or yard time; any one of them resets the
// clock. The clock runs from the dog's (re)arrival at the shelter — foster and
// incoming dogs are excluded, so their clock effectively restarts when they
// land on the floor. Dogs on medical rest, manager-only, in isolation, or on a
// sick hold are hidden (the clock is paused): they can't get enrichment, so they
// aren't flagged. Coming off an isolation/sick hold stamps enrichmentResetDate,
// which becomes the new clock baseline — so held time never counts against them.

export const ENRICHMENT_OVERDUE_DAYS = 7;

export interface EnrichmentAttentionItem {
	dog: Dog;
	days: number;
}

export function getOverdueEnrichmentDogs(
	dogs: Dog[],
	sessions: PlaygroupSession[],
	today: Date
): EnrichmentAttentionItem[] {
	const lastPgMap = buildLastPlaygroupMap(sessions);

	const items: EnrichmentAttentionItem[] = [];
	for (const dog of dogs) {
		const days = enrichmentOverdueDays(dog, lastPgMap[dog.id] ?? null, today);
		if (days !== null) items.push({ dog, days });
	}
	return items;
}

/**
 * Days since the dog's last day trip, playgroup or yard time, when that is past the
 * enrichment threshold; null when it is not due or the dog cannot go out.
 */
export function enrichmentOverdueDays(dog: Dog, lastPlaygroupDate: Date | null, today: Date): number | null {
	// Incoming dogs count: transfers come in through ASM's Incoming location.
	if (dog.inFoster) return null;
	if (dog.isOutOnDayTrip) return null;
	if (dog.isolationStatus !== 'none') return null;
	if (dog.sickHold) return null;
	if (isSurgeryResting(dog, today)) return null;
	if (dog.handlingLevel === 'manager_only') return null;

	const availableSince = clockStart(dog);
	const availableMs = toDate(availableSince)?.getTime() ?? 0;
	// Coming off an isolation/sick hold reset the clock — ignore anything before it.
	const resetMs = toDate(dog.enrichmentResetDate)?.getTime() ?? 0;
	const baselineMs = Math.max(availableMs, resetMs);

	const activityDates = [toDate(dog.lastDayTripDate), lastPlaygroupDate, toDate(dog.lastYardDate)];
	const lastEnrichmentMs = activityDates.reduce((latest, date) => {
		if (!date || date.getTime() < baselineMs) return latest;
		return Math.max(latest, date.getTime());
	}, baselineMs);

	const days = daysSince(new Date(lastEnrichmentMs), today) ?? 0;
	return days >= ENRICHMENT_OVERDUE_DAYS ? days : null;
}
