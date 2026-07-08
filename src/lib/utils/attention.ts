import { startOfDay } from 'date-fns';
import { bathEligible, checkDayTripEligibility, daysSince, dogStripeColor, isSameCalendarDay, sinceReturn, toDate } from '$lib/utils/dates';
import type { Dog, PlaygroupSession } from '$lib/types';

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
		dog.dayTripPuppyOverride
	).eligible;
}

// ─── Dogs to Test ────────────────────────────────────────────────────────────
// Active shelter dogs marked unknown for dog compatibility with no playgroup
// history at all (sessions from any stay, including before foster, count).

export function getCautionDogs(dogs: Dog[], sessions: PlaygroupSession[]): Dog[] {
	// Build a map of dogId → most recent session date (ms)
	const lastSessionMs: Record<string, number> = {};
	for (const s of sessions) {
		const t = toDate(s.date)?.getTime();
		if (!t) continue;
		for (const id of s.dogIds) {
			if (!lastSessionMs[id] || t > lastSessionMs[id]) lastSessionMs[id] = t;
		}
	}

	return dogs.filter((dog) => {
		if (dog.isolationStatus !== 'none') return false;
		if (dog.goodWithDogs !== 'unknown') return false;

		return lastSessionMs[dog.id] === undefined;
	});
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

	let effectiveBathDate: Dog['lastBathDate'] | string | null;
	if (dog.shelterSince) {
		const returnMs = toDate(dog.shelterSince)?.getTime() ?? 0;
		const bathMs = toDate(dog.lastBathDate)?.getTime() ?? 0;
		effectiveBathDate = bathMs > returnMs ? dog.lastBathDate : dog.shelterSince;
	} else {
		const intakeMs = toDate(dog.intakeDate)?.getTime() ?? 0;
		const bathMs = toDate(dog.lastBathDate)?.getTime() ?? 0;
		const bathCountsForStay =
			dog.lastBathDate != null &&
			(bathMs >= intakeMs || isSameCalendarDay(dog.lastBathDate, dog.intakeDate));
		effectiveBathDate = bathCountsForStay ? dog.lastBathDate : null;
	}

	const days = daysSince(effectiveBathDate, today);
	const isNewIntake = !effectiveBathDate;
	const daysSinceArrival = daysSince(dog.shelterSince ?? dog.intakeDate, today) ?? 0;

	if (isNewIntake) return { isDue: true, isNewIntake: true, overdueDays: null, daysSinceArrival };
	if (days !== null && days >= BATH_OVERDUE_DAYS) {
		return { isDue: true, isNewIntake: false, overdueDays: days - BATH_OVERDUE_DAYS, daysSinceArrival };
	}
	return absent;
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
	const effectiveSince = dog.shelterSince ?? dog.intakeDate;
	return daysSince(sinceReturn(dog.lastDayTripDate, effectiveSince), today);
}

export function buildLastPlaygroupMap(sessions: PlaygroupSession[]): Record<string, Date> {
	const map: Record<string, Date> = {};
	for (const s of sessions) {
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
	const isPuppyAge = ageWeeks !== null && ageWeeks < 26;
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

	const availableSince = dog.shelterSince ?? dog.intakeDate;
	const availableMs = toDate(availableSince)?.getTime() ?? 0;
	const readyDate = toDate(dog.playgroupReadyDate) ?? new Date(availableMs + 7 * 86_400_000);
	return today >= readyDate;
}

// ─── Enrichment ──────────────────────────────────────────────────────────────
// Enrichment = day trip, playgroup, or yard time; any one of them resets the
// clock. The clock runs from the dog's (re)arrival at the shelter — foster and
// incoming dogs are excluded, so their clock effectively restarts when they
// land on the floor. Dogs on medical rest, in isolation, or manager-only keep
// their clock running but stay hidden until the restriction lifts.

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
		if (dog.inFoster || dog.isIncoming) continue;
		if (dog.isOutOnDayTrip) continue;
		if (dog.isolationStatus !== 'none') continue;
		if (isSurgeryResting(dog, today)) continue;
		if (dog.handlingLevel === 'manager_only') continue;

		const availableSince = dog.shelterSince ?? dog.intakeDate;
		const availableMs = toDate(availableSince)?.getTime() ?? 0;

		const activityDates = [toDate(dog.lastDayTripDate), lastPgMap[dog.id] ?? null, toDate(dog.lastYardDate)];
		const lastEnrichmentMs = activityDates.reduce((latest, date) => {
			if (!date || date.getTime() < availableMs) return latest;
			return Math.max(latest, date.getTime());
		}, availableMs);

		const days = daysSince(new Date(lastEnrichmentMs), today) ?? 0;
		if (days >= ENRICHMENT_OVERDUE_DAYS) {
			items.push({ dog, days });
		}
	}
	return items;
}
