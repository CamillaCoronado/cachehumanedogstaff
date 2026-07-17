import { differenceInDays, differenceInMonths, differenceInYears, format, getDay, isSameDay, startOfDay } from 'date-fns';
import type {
	DateValue,
	DayTripIneligibleReason,
	DayTripStatus,
	Dog,
	DogHandlingLevel,
	IsolationStatus,
	TripColorReason,
	UserRole
} from '$lib/types';
import { handlingRestrictionReason, resolveDogHandlingLevel } from '$lib/utils/permissions';

const MIN_DAYS_AFTER_SURGERY_FOR_BATH = 10;

export function toDate(value: DateValue | string | null | undefined): Date | null {
	if (!value) return null;
	if (value instanceof Date) return value;
	if (typeof value === 'string') {
		// Date-only strings (YYYY-MM-DD) must be parsed as local midnight, not UTC midnight,
		// otherwise timezone offsets shift the date by one day in US timezones.
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			const [y, m, d] = value.split('-').map(Number);
			return new Date(y, m - 1, d);
		}
		// ISO strings previously saved as UTC midnight (T00:00:00) represent date-only values;
		// extract the date portion and parse as local midnight to avoid the same off-by-one.
		const utcMidnight = value.match(/^(\d{4})-(\d{2})-(\d{2})T00:00:00/);
		if (utcMidnight) {
			return new Date(Number(utcMidnight[1]), Number(utcMidnight[2]) - 1, Number(utcMidnight[3]));
		}
		return new Date(value);
	}
	if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
		return (value as { toDate: () => Date }).toDate();
	}
	return null;
}

export function toDateString(value: DateValue | string | null | undefined) {
	const date = toDate(value);
	return date ? date.toISOString() : null;
}

export function formatDate(value: DateValue | string | null | undefined, fallback = '—') {
	const date = toDate(value);
	return date ? format(date, 'MMM d, yyyy') : fallback;
}

export function formatDateTime(value: DateValue | string | null | undefined, fallback = '—') {
	const date = toDate(value);
	return date ? format(date, 'MMM d, yyyy h:mm a') : fallback;
}

// Returns null if the activity date predates shelterSince (dog was away and starts fresh on return).
export function sinceReturn(
	activityDate: DateValue | string | null | undefined,
	shelterSince: DateValue | string | null | undefined
): DateValue | string | null {
	if (!activityDate) return null;
	if (!shelterSince) return activityDate as DateValue | string;
	const a = toDate(activityDate);
	const s = toDate(shelterSince);
	if (!a || !s) return activityDate as DateValue | string;
	return a >= s ? (activityDate as DateValue | string) : null;
}

export function daysSince(value: DateValue | string | null | undefined, now = new Date()) {
	const date = toDate(value);
	if (!date) return null;
	return Math.max(0, differenceInDays(startOfDay(now), startOfDay(date)));
}

export function formatAge(value: DateValue | string | null | undefined, now = new Date()) {
	const date = toDate(value);
	if (!date) return '—';
	const start = startOfDay(date);
	const end = startOfDay(now);
	const years = Math.max(0, differenceInYears(end, start));
	if (years < 1) {
		const months = Math.max(0, differenceInMonths(end, start));
		return `${months} mos`;
	}
	return `${years} yrs`;
}

export function isMondayOrThursday(value: DateValue | string | null | undefined) {
	const date = toDate(value);
	if (!date) return false;
	const day = getDay(date);
	return day === 1 || day === 4;
}

export function isSameCalendarDay(a: DateValue | string | null | undefined, b: DateValue | string | null | undefined) {
	const dateA = toDate(a);
	const dateB = toDate(b);
	if (!dateA || !dateB) return false;
	return isSameDay(dateA, dateB);
}

export function isSurgeryToday(surgeryDate: DateValue | string | null | undefined, today = new Date()) {
	if (!surgeryDate) return false;
	return isSameCalendarDay(surgeryDate, today) && isMondayOrThursday(today);
}

export function bathEligible(surgeryDate: DateValue | string | null | undefined, today = new Date()) {
	if (!surgeryDate) return true;
	const date = toDate(surgeryDate);
	if (!date) return true;
	const days = differenceInDays(startOfDay(today), startOfDay(date));
	if (days < 0) return true;
	return days >= MIN_DAYS_AFTER_SURGERY_FOR_BATH;
}

export interface DayTripEligibility {
	eligible: boolean;
	status: DayTripStatus;
	reasons: string[];
}

// Puppy day-trip gate: a dog under PUPPY_MAX_AGE_MONTHS old is not day-trip eligible
// until it has been at the shelter at least PUPPY_MIN_DAYS_AT_SHELTER days.
export const PUPPY_MAX_AGE_MONTHS = 6;
export const PUPPY_MIN_DAYS_AT_SHELTER = 30;

// Puppies don't need a behavioral evaluation, so the awaitingEvaluation flag
// is never set for dogs under this age (and is cleared by the sync if present).
export function isPuppyAge(dateOfBirth: DateValue | string | null | undefined, today = new Date()): boolean {
	const dob = toDate(dateOfBirth);
	return dob !== null && differenceInMonths(today, dob) < PUPPY_MAX_AGE_MONTHS;
}

export function checkDayTripEligibility(
	intakeDate: DateValue | string | null | undefined,
	isVaccinated: boolean,
	isFixed: boolean,
	dayTripStatus: DayTripStatus,
	isolationStatus: IsolationStatus,
	dayTripIneligibleReason: DayTripIneligibleReason | null | undefined,
	dayTripManagerOnlyReason: DayTripIneligibleReason | null | undefined,
	dayTripNotes: string | null,
	handlingLevel: DogHandlingLevel | null | undefined,
	surgeryDate: DateValue | string | null | undefined,
	surgeryRestDays: number | null | undefined,
	awaitingEvaluation: boolean | null | undefined = null,
	actorRole: UserRole | null | undefined = null,
	today = new Date(),
	dateOfBirth: DateValue | string | null | undefined = null,
	vaccineCount: number | null | undefined = null,
	vaccinesOutstanding: number | null | undefined = null,
	puppyDayTripOverride: boolean | null | undefined = null
): DayTripEligibility {
	const reasons: string[] = [];
	const trimmedTripNotes = dayTripNotes?.trim() ?? '';
	const hasTripReason = trimmedTripNotes.length > 0;
	const ineligibleReason = dayTripIneligibleReason ?? 'other';
	const managerOnlyReason = dayTripManagerOnlyReason ?? 'other';
	const effectiveHandlingLevel = resolveDogHandlingLevel(handlingLevel);
	const requiresManagerOnly = effectiveHandlingLevel === 'manager_only';
	const manuallyBlocked = dayTripStatus === 'ineligible' && isolationStatus === 'none' && !requiresManagerOnly;
	const roleRestrictionReason = handlingRestrictionReason(effectiveHandlingLevel, actorRole);
	const blockedByHandlingRole = Boolean(roleRestrictionReason);

	const surgeryDateObj = toDate(surgeryDate);
	const surgeryDaysAgo = surgeryDateObj
		? differenceInDays(startOfDay(today), startOfDay(surgeryDateObj))
		: null;
	const restDays = surgeryRestDays ?? 0;
	const blockedBySurgery =
		surgeryDaysAgo !== null && surgeryDaysAgo >= 0 && surgeryDaysAgo < restDays;
	const isSurgeryDay = surgeryDaysAgo === 0 && restDays === 0;

	if (awaitingEvaluation) {
		reasons.push('Awaiting evaluation');
	}

	if (isSurgeryDay) {
		reasons.push('Surgery today — no day trips');
	} else if (blockedBySurgery) {
		const daysLeft = restDays - surgeryDaysAgo!;
		reasons.push(`Post-surgery rest — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`);
	}

	if (isolationStatus !== 'none') {
		reasons.push('In isolation');
	}

	if (roleRestrictionReason) {
		reasons.push(roleRestrictionReason);
	}

	if (!isVaccinated) {
		reasons.push('Must be vaccinated');
	}

	// A dog with vaccines on record but still-outstanding (overdue/scheduled) shots in
	// ASM isn't fully covered yet — block day trips until the outstanding count is 0.
	// (Replaces the old "given count" heuristic, which inflated with non-core vaccines.)
	const hasOutstandingVaccines = isVaccinated && (vaccinesOutstanding ?? 0) > 0;
	if (hasOutstandingVaccines) {
		reasons.push('Vaccinations due');
	}

	// Puppies (under 6 months) are not day-trip eligible until they've been with us a
	// while (30+ days). If we can't tell how long they've been here, stay conservative
	// and block. Older dogs are unaffected.
	const isPuppy = isPuppyAge(dateOfBirth, today);
	const intakeDateObj = toDate(intakeDate);
	const daysWithUs = intakeDateObj ? differenceInDays(startOfDay(today), startOfDay(intakeDateObj)) : null;
	// 30-day rule is the default for under-6-month puppies, but a manager can override
	// it per-dog (puppyDayTripOverride) to allow a specific young puppy out early.
	const puppyTooNew =
		isPuppy && (daysWithUs === null || daysWithUs < PUPPY_MIN_DAYS_AT_SHELTER) && !puppyDayTripOverride;
	if (puppyTooNew) {
		reasons.push(`Puppy — needs ${PUPPY_MIN_DAYS_AT_SHELTER}+ days at the shelter before day trips`);
	}

	if (!isFixed) {
		reasons.push('Must be spayed/neutered');
	}

	if (manuallyBlocked) {
		if (ineligibleReason === 'behavior') {
			reasons.push(hasTripReason ? `Behavior hold: ${trimmedTripNotes}` : 'Behavior hold');
		} else if (ineligibleReason === 'medical') {
			reasons.push(hasTripReason ? `Medical hold: ${trimmedTripNotes}` : 'Medical hold');
		} else {
			reasons.push(hasTripReason ? `Day trips blocked: ${trimmedTripNotes}` : 'Day trips blocked');
		}
	}

	if (requiresManagerOnly && isolationStatus === 'none') {
		if (managerOnlyReason === 'behavior') {
			reasons.push(
				hasTripReason
					? `Manager only due to behavior: ${trimmedTripNotes}`
					: 'Manager only due to behavior'
			);
		} else if (managerOnlyReason === 'medical') {
			reasons.push(
				hasTripReason
					? `Manager only for medical needs: ${trimmedTripNotes}`
					: 'Manager only for medical needs'
			);
		} else {
			reasons.push(hasTripReason ? `Manager only: ${trimmedTripNotes}` : 'Manager only');
		}
	}

	if (dayTripStatus === 'difficult' && isolationStatus === 'none') {
		reasons.push(hasTripReason ? `Difficult: ${trimmedTripNotes}` : 'Difficult dog - adults only');
	}

	void vaccineCount;
	const blockedByRequirements = !isVaccinated || !isFixed || hasOutstandingVaccines;
	const blockedByStatus =
		isolationStatus !== 'none' || manuallyBlocked || requiresManagerOnly || blockedByHandlingRole || blockedBySurgery || isSurgeryDay || Boolean(awaitingEvaluation) || puppyTooNew;
	const eligible = !(blockedByRequirements || blockedByStatus);

	let status: DayTripStatus = 'ineligible';
	if (awaitingEvaluation) {
		status = 'ineligible';
	} else if (puppyTooNew) {
		status = 'ineligible';
	} else if (isolationStatus !== 'none') {
		status = 'ineligible';
	} else if (manuallyBlocked) {
		status = 'ineligible';
	} else if (requiresManagerOnly) {
		status = 'ineligible';
	} else if (blockedByHandlingRole) {
		status = 'ineligible';
	} else if (dayTripStatus === 'difficult') {
		status = 'difficult';
	} else if (isVaccinated && isFixed) {
		status = 'eligible';
	}

	void today;
	return { eligible, status, reasons };
}

// Whether a dog falls under the puppy day-trip age/time gate (under 6 months AND with us
// less than 30 days), ignoring any override. Used to decide whether to show the
// "allow day trips" override action.
export function isUnderageForDayTrips(dog: Dog, today = new Date()): boolean {
	const dob = toDate(dog.dateOfBirth);
	if (dob === null || differenceInMonths(today, dob) >= PUPPY_MAX_AGE_MONTHS) return false;
	const intake = toDate(dog.intakeDate);
	const daysWithUs = intake ? differenceInDays(startOfDay(today), startOfDay(intake)) : null;
	return daysWithUs === null || daysWithUs < PUPPY_MIN_DAYS_AT_SHELTER;
}

// Reasons a manager can attach when setting a dog's day-trip color, mirroring the factors
// the color is otherwise calculated from.
export const TRIP_COLOR_REASONS: { value: TripColorReason; label: string }[] = [
	{ value: 'behavior', label: 'Behavior' },
	{ value: 'medical', label: 'Medical' },
	{ value: 'isolation', label: 'Isolation' },
	{ value: 'awaiting_eval', label: 'Awaiting evaluation' },
	{ value: 'manager_only', label: 'Manager only' },
	{ value: 'staff_only', label: 'Staff only' },
	{ value: 'difficult', label: 'Difficult (adults only)' },
	{ value: 'other', label: 'Other' }
];

export function tripColorReasonLabel(reason: TripColorReason | null | undefined): string | null {
	return TRIP_COLOR_REASONS.find((r) => r.value === reason)?.label ?? null;
}

// The reason a dog is its color — derived from what's already on the profile (mirrors the
// factors dogStripeColor uses), or the manager's picked reason when the profile doesn't
// explain it. Returns null for a green/eligible dog with nothing on record.
export function dogColorReason(dog: Dog): TripColorReason | null {
	if (dog.manualTripColorReason) return dog.manualTripColorReason;
	const level = resolveDogHandlingLevel(dog.handlingLevel);
	if (dog.isolationStatus !== 'none') return 'isolation';
	if (level === 'manager_only') {
		if (dog.dayTripManagerOnlyReason === 'behavior') return 'behavior';
		if (dog.dayTripManagerOnlyReason === 'medical') return 'medical';
		return 'manager_only';
	}
	if (level === 'staff_only') return 'staff_only';
	if (dog.awaitingEvaluation) return 'awaiting_eval';
	if (dog.dayTripStatus === 'difficult') return 'difficult';
	if (dog.dayTripStatus === 'ineligible') {
		if (dog.dayTripIneligibleReason === 'behavior') return 'behavior';
		if (dog.dayTripIneligibleReason === 'medical') return 'medical';
		return 'other';
	}
	return null;
}

export function dogStripeColor(dog: Dog): 'green' | 'yellow' | 'red' {
	// Single source of truth: the dog's own color (set manually or synced from the sheet).
	if (dog.manualTripColor) return dog.manualTripColor;
	// Otherwise, a computed default from the dog's status.
	const level = resolveDogHandlingLevel(dog.handlingLevel);
	if (dog.isolationStatus !== 'none') return 'red';
	if (level === 'manager_only' || level === 'staff_only') return 'red';
	if (dog.awaitingEvaluation) return 'red';
	if (dog.dayTripStatus === 'difficult') return 'yellow';
	return 'green';
}
