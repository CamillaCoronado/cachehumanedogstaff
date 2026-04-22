import type { Dog } from '$lib/types';
import { toDate } from '$lib/utils/dates';
import { resolveDogHandlingLevel } from '$lib/utils/permissions';

export type AdoptionAvailabilityState =
	| 'available'
	| 'medical_hold'
	| 'isolation_hold'
	| 'handling_hold'
	| 'day_trip_hold'
	| 'not_available';

export interface AdoptionAvailability {
	available: boolean;
	state: AdoptionAvailabilityState;
	missingMedicalRequirements: string[];
	holdReason: string | null;
}

export function getEffectiveAdoptionDate(
	dog: Pick<Dog, 'status' | 'leftShelterDate' | 'updatedAt' | 'createdAt' | 'asmId' | 'asmShelterCode'>
): Date | null {
	const explicit = toDate(dog.leftShelterDate);
	if (explicit) return explicit;
	if (dog.status !== 'adopted') return null;
	if (typeof dog.asmId === 'number' || Boolean(dog.asmShelterCode?.trim())) return null;

	const updatedAt = toDate(dog.updatedAt);
	if (!updatedAt) return null;

	const createdAt = toDate(dog.createdAt);
	if (createdAt && updatedAt.getTime() === createdAt.getTime()) return null;

	return updatedAt;
}

export function missingAdoptionMedicalRequirements(
	dog: Pick<Dog, 'isMicrochipped' | 'isVaccinated' | 'isFixed'>
): string[] {
	const missing: string[] = [];
	if (!dog.isMicrochipped) missing.push('microchip');
	if (!dog.isVaccinated) missing.push('vaccines');
	if (!dog.isFixed) missing.push('spay/neuter');
	return missing;
}

export function getAdoptionAvailability(
	dog: Pick<
		Dog,
		| 'status'
		| 'isolationStatus'
		| 'isMicrochipped'
		| 'isVaccinated'
		| 'isFixed'
		| 'dayTripStatus'
		| 'dayTripIneligibleReason'
		| 'dayTripManagerOnly'
		| 'dayTripManagerOnlyReason'
		| 'dayTripNotes'
		| 'handlingLevel'
	>
): AdoptionAvailability {
	const missingMedicalRequirements = missingAdoptionMedicalRequirements(dog);
	const note = dog.dayTripNotes?.trim() ?? '';
	const withNote = (label: string) => (note ? `${label}: ${note}` : label);
	const effectiveHandlingLevel = resolveDogHandlingLevel(
		dog.handlingLevel,
		dog.dayTripManagerOnly,
		dog.isolationStatus
	);

	if (dog.status === 'adopted') {
		return {
			available: false,
			state: 'not_available',
			missingMedicalRequirements,
			holdReason: 'already adopted'
		};
	}

	if (missingMedicalRequirements.length > 0) {
		return {
			available: false,
			state: 'medical_hold',
			missingMedicalRequirements,
			holdReason: null
		};
	}

	if (dog.isolationStatus !== 'none') {
		return {
			available: false,
			state: 'isolation_hold',
			missingMedicalRequirements: [],
			holdReason: dog.isolationStatus === 'sick' ? 'sick isolation' : 'bite quarantine'
		};
	}

	if (effectiveHandlingLevel === 'manager_only') {
		const managerOnlyReason = dog.dayTripManagerOnlyReason ?? 'other';
		const holdReason =
			dog.dayTripManagerOnly === true
				? managerOnlyReason === 'behavior'
					? withNote('manager-only behavior hold')
					: managerOnlyReason === 'medical'
						? withNote('manager-only medical hold')
						: withNote('manager-only care hold')
				: 'manager-only handling plan';
		return {
			available: false,
			state: 'handling_hold',
			missingMedicalRequirements: [],
			holdReason
		};
	}

	if (effectiveHandlingLevel === 'staff_only') {
		return {
			available: false,
			state: 'handling_hold',
			missingMedicalRequirements: [],
			holdReason: 'staff-only handling plan'
		};
	}

	if (dog.dayTripStatus === 'ineligible' && dog.isolationStatus === 'none') {
		const reason = dog.dayTripIneligibleReason ?? 'other';
		const holdReason =
			reason === 'behavior'
				? withNote('behavior hold')
				: reason === 'medical'
					? withNote('medical hold')
					: withNote('care hold');
		return {
			available: false,
			state: 'day_trip_hold',
			missingMedicalRequirements: [],
			holdReason
		};
	}

	return {
		available: true,
		state: 'available',
		missingMedicalRequirements: [],
		holdReason: null
	};
}
