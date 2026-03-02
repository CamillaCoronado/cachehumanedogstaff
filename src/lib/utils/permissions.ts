import type { UserProfile, UserRole } from '$lib/types';

export function canEditDogs(role: UserRole | null | undefined) {
	return role === 'admin' || role === 'manager';
}

export function roleLabel(role: UserRole | null | undefined) {
	return role ?? 'staff';
}

export function resolveRole(profile: UserProfile | null | undefined, fallbackRole: UserRole) {
	return profile?.role ?? fallbackRole;
}
