import { differenceInDays, differenceInMonths, differenceInYears, format, getDay, isSameDay, startOfDay } from 'date-fns';
import type {
	DateValue,
	DayTripIneligibleReason,
	DayTripStatus,
	DogHandlingLevel,
	IsolationStatus,
	UserRole
} from '$lib/types';
import { handlingRestrictionReason, resolveDogHandlingLevel } from '$lib/utils/permissions';

const MIN_DAYS_AFTER_SURGERY_FOR_BATH = 10;

export function toDate(value: DateValue | string | null | undefined): Date | null {
	if (!value) return null;
	if (value instanceof Date) return value;
	if (typeof value === 'string') return new Date(value);
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

export function normalizeDay(value: DateValue | string | null | undefined) {
	const date = toDate(value);
	return date ? startOfDay(date) : null;
}

export function daysSince(value: DateValue | string | null | undefined, now = new Date()) {
	const date = toDate(value);
	if (!date) return null;
	return Math.max(0, differenceInDays(startOfDay(now), startOfDay(date)));
}

export function ageInYears(value: DateValue | string | null | undefined, now = new Date()) {
	const date = toDate(value);
	if (!date) return null;
	const days = differenceInDays(startOfDay(now), startOfDay(date));
	return Math.max(0, Math.floor(days / 365));
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

export function checkDayTripEligibility(
	intakeDate: DateValue | string | null | undefined,
	isVaccinated: boolean,
	isFixed: boolean,
	dayTripStatus: DayTripStatus,
	isolationStatus: IsolationStatus,
	dayTripIneligibleReason: DayTripIneligibleReason | null | undefined,
	dayTripManagerOnly: boolean | null | undefined,
	dayTripManagerOnlyReason: DayTripIneligibleReason | null | undefined,
	dayTripNotes: string | null,
	handlingLevel: DogHandlingLevel | null | undefined,
	actorRole: UserRole | null | undefined = null,
	today = new Date()
): DayTripEligibility {
	const reasons: string[] = [];
	const trimmedTripNotes = dayTripNotes?.trim() ?? '';
	const hasTripReason = trimmedTripNotes.length > 0;
	const ineligibleReason = dayTripIneligibleReason ?? 'other';
	const managerOnlyReason = dayTripManagerOnlyReason ?? 'other';
	const requiresManagerOnly = dayTripManagerOnly === true;
	const manuallyBlocked = dayTripStatus === 'ineligible' && isolationStatus === 'none' && !requiresManagerOnly;
	const effectiveHandlingLevel = resolveDogHandlingLevel(
		handlingLevel,
		dayTripManagerOnly,
		isolationStatus
	);
	const roleRestrictionReason = handlingRestrictionReason(effectiveHandlingLevel, actorRole);
	const blockedByHandlingRole = Boolean(roleRestrictionReason);

	if (isolationStatus === 'sick') {
		reasons.push('In isolation: Sick');
	} else if (isolationStatus === 'bite_quarantine') {
		reasons.push('In isolation: Bite quarantine');
	}

	if (roleRestrictionReason) {
		reasons.push(roleRestrictionReason);
	}

	if (!isVaccinated) {
		reasons.push('Must be vaccinated');
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

	void intakeDate;
	const blockedByRequirements = !isVaccinated || !isFixed;
	const blockedByStatus =
		isolationStatus !== 'none' || manuallyBlocked || requiresManagerOnly || blockedByHandlingRole;
	const eligible = !(blockedByRequirements || blockedByStatus);

	let status: DayTripStatus = 'ineligible';
	if (isolationStatus !== 'none') {
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
