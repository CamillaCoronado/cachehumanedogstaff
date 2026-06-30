import { startOfDay } from 'date-fns';
import { bathEligible, checkDayTripEligibility, daysSince, isSameCalendarDay, sinceReturn, toDate } from '$lib/utils/dates';
import type { Dog, PlaygroupSession } from '$lib/types';

export function isDayTripEligible(dog: Dog, sheetColors: Record<string, string> = {}): boolean {
	if (dog.isOutOnDayTrip) return false;
	const key = dog.name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
	if (sheetColors[key] === 'red') return false;
	return checkDayTripEligibility(
		dog.intakeDate, dog.isVaccinated, dog.isFixed, dog.dayTripStatus,
		dog.isolationStatus, dog.dayTripIneligibleReason, dog.dayTripManagerOnly,
		dog.dayTripManagerOnlyReason, dog.dayTripNotes, dog.handlingLevel,
		dog.surgeryDate, dog.surgeryRestDays, dog.awaitingEvaluation,
		null, new Date(), dog.dateOfBirth, dog.vaccineCount, dog.vaccinesOutstanding,
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

export function isPlaygroupEligible(dog: Dog, today: Date): boolean {
	if (dog.goodWithDogs !== 'yes') return false;
	if (!dog.isFixed) return false;
	if (dog.isolationStatus !== 'none') return false;
	if (dog.awaitingEvaluation) return false;

	const ageWeeks = dogAgeWeeks(dog, today);
	if (ageWeeks !== null && ageWeeks < 26) return false;

	if (isSurgeryResting(dog, today)) return false;

	const availableSince = dog.shelterSince ?? dog.intakeDate;
	const availableMs = toDate(availableSince)?.getTime() ?? 0;
	const readyDate = toDate(dog.playgroupReadyDate) ?? new Date(availableMs + 7 * 86_400_000);
	return today >= readyDate;
}

// ─── Day Trips ───────────────────────────────────────────────────────────────

export interface DayTripAttentionItem {
	dog: Dog;
	days: number;
}

export function getOverdueDayTripDogs(dogs: Dog[], today: Date): DayTripAttentionItem[] {
	const items: DayTripAttentionItem[] = [];
	for (const dog of dogs) {
		if (dog.inFoster) continue;
		if (dog.dayTripStatus === 'ineligible') continue;
		if (dog.isolationStatus !== 'none') continue;
		if (dog.isOutOnDayTrip) continue;
		if (isSurgeryResting(dog, today)) continue;

		const sinceReturnDays = getDayTripGapDays(dog, today);
		const daysAtShelter = daysSince(dog.shelterSince ?? dog.intakeDate, today) ?? 0;
		const overdue = sinceReturnDays !== null ? sinceReturnDays >= DAYTRIP_OVERDUE_DAYS : daysAtShelter >= DAYTRIP_OVERDUE_DAYS;

		if (overdue) {
			items.push({ dog, days: sinceReturnDays ?? daysAtShelter });
		}
	}
	return items;
}

// ─── Playgroups ───────────────────────────────────────────────────────────────

export interface PlaygroupAttentionItem {
	dog: Dog;
	days: number;
}

export function getOverduePlaygroupDogs(
	dogs: Dog[],
	sessions: PlaygroupSession[],
	today: Date
): PlaygroupAttentionItem[] {
	const lastPgMap = buildLastPlaygroupMap(sessions);

	const items: PlaygroupAttentionItem[] = [];
	for (const dog of dogs) {
		if (!isPlaygroupEligible(dog, today)) continue;

		const availableSince = dog.shelterSince ?? dog.intakeDate;
		const availableMs = toDate(availableSince)?.getTime() ?? 0;
		const readyDate = toDate(dog.playgroupReadyDate) ?? new Date(availableMs + 7 * 86_400_000);

		const lastDate = lastPgMap[dog.id] ?? null;
		const effectiveLastMs = lastDate !== null && lastDate.getTime() >= availableMs ? lastDate.getTime() : null;
		const pgDays = effectiveLastMs !== null ? (daysSince(new Date(effectiveLastMs), today) ?? null) : null;
		const readyDays = daysSince(readyDate, today) ?? 0;
		const days = pgDays ?? readyDays;
		if (days >= PLAYGROUP_OVERDUE_DAYS) {
			items.push({ dog, days });
		}
	}
	return items;
}
