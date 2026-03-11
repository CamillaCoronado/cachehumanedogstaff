import type { DogHandlingLevel, IsolationStatus, UserProfile, UserRole } from '$lib/types';

export function canEditDogs(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'manager';
}

export function roleLabel(role: UserRole | null | undefined) {
	return role ?? 'staff';
}

export function resolveRole(profile: UserProfile | null | undefined, fallbackRole: UserRole) {
	return profile?.role ?? fallbackRole;
}

const roleRank: Record<UserRole, number> = {
	volunteer: 0,
	staff: 1,
	manager: 2,
	admin: 3
};

const handlingRank: Record<DogHandlingLevel, number> = {
	volunteer: 0,
	staff_only: 1,
	manager_only: 2
};

export function resolveDogHandlingLevel(
	handlingLevel: DogHandlingLevel | null | undefined,
	dayTripManagerOnly: boolean | null | undefined = false,
	isolationStatus: IsolationStatus | null | undefined = 'none'
): DogHandlingLevel {
	if (isolationStatus !== 'none') return 'manager_only';
	if (dayTripManagerOnly === true) return 'manager_only';
	return handlingLevel ?? 'volunteer';
}

export function canHandleDog(
	role: UserRole | null | undefined,
	handlingLevel: DogHandlingLevel | null | undefined,
	isolationStatus: IsolationStatus | null | undefined = 'none'
) {
	const normalizedRole = role ?? 'volunteer';
	const normalizedHandling = resolveDogHandlingLevel(handlingLevel, false, isolationStatus);
	return roleRank[normalizedRole] >= handlingRank[normalizedHandling];
}

export function handlingRequirementLabel(level: DogHandlingLevel | null | undefined) {
	if (level === 'manager_only') return 'manager';
	if (level === 'staff_only') return 'staff';
	return 'volunteer';
}

export function handlingRestrictionReason(
	level: DogHandlingLevel | null | undefined,
	role: UserRole | null | undefined,
	isolationStatus: IsolationStatus | null | undefined = 'none'
) {
	if (canHandleDog(role, level, isolationStatus)) return null;
	const required = handlingRequirementLabel(level);
	const actor = role ?? 'volunteer';
	if (required === 'manager') return `Manager-only handling (current role: ${actor})`;
	if (required === 'staff') return `Staff-only handling (current role: ${actor})`;
	return null;
}
