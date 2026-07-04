import type {
	Compatibility,
	DayTripStatus,
	Dog,
	DogHandlingLevel,
	DogSex,
	EnergyLevel,
	PottyTrainedStatus
} from '$lib/types';
import { daysSince, formatDate, toDate } from '$lib/utils/dates';

export function energyLabel(value: EnergyLevel | null | undefined): string {
	if (value === 'very_high') return 'Very high';
	if (value === 'high') return 'High';
	if (value === 'medium') return 'Medium';
	if (value === 'low') return 'Low';
	return 'Unknown';
}

export function compatibilityLabel(value: Compatibility | null | undefined): string {
	if (value === 'yes') return 'Yes';
	if (value === 'no') return 'No';
	return 'Unknown';
}

export function pottyLabel(value: PottyTrainedStatus | null | undefined): string {
	if (value === 'yes') return 'Yes';
	if (value === 'no') return 'No';
	if (value === 'working_on_it') return 'Working on it';
	return 'Unknown';
}

export function sexLabel(value: DogSex | null | undefined): string {
	if (value === 'male') return 'Male';
	if (value === 'female') return 'Female';
	return 'Unknown';
}

export function handlingLevelLabel(level: DogHandlingLevel | null | undefined): string {
	if (level === 'manager_only') return 'Manager only';
	if (level === 'staff_only') return 'Staff only';
	return 'Volunteer';
}

/** Returns trimmed string or null if empty/invalid. Does NOT lowercase. */
export function normalizeText(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const lower = trimmed.toLowerCase();
	if (lower === 'undefined' || lower === 'null') return null;
	return trimmed;
}

export function shelterTimeLabel(entryDate: Dog['intakeDate'], today: Date = new Date()) {
	const days = daysSince(entryDate, today);
	if (days === null) return 'Unknown';
	if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
	const weeks = Math.floor(days / 7);
	return `${weeks} week${weeks === 1 ? '' : 's'} (${days} days)`;
}

export function stoolColor(type: number) {
	if (type >= 3 && type <= 4) return 'bg-emerald-100 text-emerald-700';
	if (type === 1 || type === 2 || type === 5) return 'bg-yellow-100 text-yellow-700';
	return 'bg-rose-100 text-rose-700';
}

export function stoolLabel(type: number) {
	const labels = {
		1: 'Separate hard lumps',
		2: 'Lumpy sausage',
		3: 'Cracked sausage',
		4: 'Smooth sausage',
		5: 'Soft blobs',
		6: 'Mushy pieces',
		7: 'Watery liquid'
	};
	return labels[type as keyof typeof labels] ?? 'Unknown';
}

export function reentryDatesLabel(reentryDates: Dog['reentryDates']) {
	if (!Array.isArray(reentryDates) || reentryDates.length === 0) return 'None';
	const normalized = reentryDates
		.map((date) => toDate(date))
		.filter((date): date is Date => Boolean(date))
		.sort((a, b) => a.getTime() - b.getTime());
	if (normalized.length === 0) return 'None';
	return normalized.map((date) => formatDate(date)).join(', ');
}
