import { differenceInDays, differenceInMonths, differenceInYears, format, getDay, isSameDay, startOfDay } from 'date-fns';
import type {
	DateValue,
	DayTripIneligibleReason,
	DayTripStatus,
	Dog,
	DogHandlingLevel,
	IsolationStatus,
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

export function normalizeDay(value: DateValue | string | null | undefined) {
	const date = toDate(value);
	return date ? startOfDay(date) : null;
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
	surgeryDate: DateValue | string | null | undefined,
	surgeryRestDays: number | null | undefined,
	awaitingEvaluation: boolean | null | undefined = null,
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
	const effectiveHandlingLevel = resolveDogHandlingLevel(handlingLevel, dayTripManagerOnly);
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
		isolationStatus !== 'none' || manuallyBlocked || requiresManagerOnly || blockedByHandlingRole || blockedBySurgery || isSurgeryDay || Boolean(awaitingEvaluation);
	const eligible = !(blockedByRequirements || blockedByStatus);

	let status: DayTripStatus = 'ineligible';
	if (awaitingEvaluation) {
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

export function dogStripeColor(
	dog: Dog,
	sheetColors?: Record<string, 'green' | 'yellow' | 'red'>
): 'green' | 'yellow' | 'red' {
	if (sheetColors) {
		const name = dog.name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
		const sheetColor = sheetColors[name];
		if (sheetColor) return sheetColor;
	}
	const level = resolveDogHandlingLevel(dog.handlingLevel, dog.dayTripManagerOnly);
	if (dog.isolationStatus !== 'none') return 'red';
	if (level === 'manager_only' || level === 'staff_only') return 'red';
	if (dog.awaitingEvaluation) return 'red';
	if (dog.dayTripStatus === 'difficult') return 'yellow';
	return 'green';
}
