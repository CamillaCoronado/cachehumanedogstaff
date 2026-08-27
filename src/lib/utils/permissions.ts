import type { DogHandlingLevel, UserProfile, UserRole } from '$lib/types';

export function canEditDogs(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'manager' || role === 'coordinator';
}

export function canAccessPlaygroups(_role: UserRole | null | undefined) {
	return true;
}

/**
 * Volunteers see only what a member of the public sees on the adoption site: name,
 * photo, breed, age, sex, temperament and write-up. Everything else — medical, kennel
 * assignments, behavioral notes, holds, warnings, day trips, feeding, cleaning — is
 * internal.
 *
 * NOTE: this is a UI-level restriction only. Firestore rules cannot filter fields
 * within a document, so an approved volunteer can still fetch the full dog record
 * through the SDK. Closing that properly needs a public mirror collection.
 */
export function canViewInternalDogInfo(role: UserRole | null | undefined) {
	return role !== 'volunteer';
}

export function canEditPlaygroups(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'manager' || role === 'coordinator' || role === 'staff';
}

export function canAccessDayTrips(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'manager' || role === 'coordinator';
}

export function canEditDayTrips(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'coordinator';
}

export function canSetDayTripColor(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'manager' || role === 'coordinator';
}

export function canAccessVolunteers(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'manager' || role === 'coordinator';
}

export function canEditVolunteers(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'coordinator';
}

export function resolveRole(profile: UserProfile | null | undefined, fallbackRole: UserRole) {
	return profile?.role ?? fallbackRole;
}

const roleRank: Record<UserRole, number> = {
	volunteer: 0,
	staff: 1,
	coordinator: 2,
	manager: 2,
	admin: 3
};

const handlingRank: Record<DogHandlingLevel, number> = {
	volunteer: 0,
	staff_only: 1,
	manager_only: 2
};

export function resolveDogHandlingLevel(
	handlingLevel: DogHandlingLevel | null | undefined
): DogHandlingLevel {
	return handlingLevel ?? 'volunteer';
}

export function canHandleDog(
	role: UserRole | null | undefined,
	handlingLevel: DogHandlingLevel | null | undefined
) {
	const normalizedRole = role ?? 'volunteer';
	const normalizedHandling = resolveDogHandlingLevel(handlingLevel);
	return roleRank[normalizedRole] >= handlingRank[normalizedHandling];
}

export function handlingRequirementLabel(level: DogHandlingLevel | null | undefined) {
	if (level === 'manager_only') return 'manager';
	if (level === 'staff_only') return 'staff';
	return 'volunteer';
}


export function handlingRestrictionReason(
	level: DogHandlingLevel | null | undefined,
	role: UserRole | null | undefined
) {
	if (canHandleDog(role, level)) return null;
	const required = handlingRequirementLabel(level);
	const actor = role ?? 'volunteer';
	if (required === 'manager') return `Manager-only handling (current role: ${actor})`;
	if (required === 'staff') return `Staff-only handling (current role: ${actor})`;
	return null;
}
