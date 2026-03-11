import type {
	Compatibility,
	DayTripStatus,
	DogHandlingLevel,
	DogSex,
	EnergyLevel,
	PottyTrainedStatus
} from '$lib/types';

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

export function dayTripLabel(status: DayTripStatus | null | undefined): string {
	if (status === 'eligible') return 'Eligible';
	if (status === 'difficult') return 'Adults only';
	return 'Ineligible';
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
