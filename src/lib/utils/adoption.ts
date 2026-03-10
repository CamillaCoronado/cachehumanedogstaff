import type { Dog } from '$lib/types';

export type AdoptionAvailabilityState = 'available' | 'medical_hold' | 'isolation_hold' | 'not_available';

export interface AdoptionAvailability {
	available: boolean;
	state: AdoptionAvailabilityState;
	missingMedicalRequirements: string[];
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
	dog: Pick<Dog, 'status' | 'isolationStatus' | 'isMicrochipped' | 'isVaccinated' | 'isFixed'>
): AdoptionAvailability {
	const missingMedicalRequirements = missingAdoptionMedicalRequirements(dog);

	if (dog.status === 'adopted') {
		return {
			available: false,
			state: 'not_available',
			missingMedicalRequirements
		};
	}

	if (missingMedicalRequirements.length > 0) {
		return {
			available: false,
			state: 'medical_hold',
			missingMedicalRequirements
		};
	}

	if (dog.isolationStatus !== 'none') {
		return {
			available: false,
			state: 'isolation_hold',
			missingMedicalRequirements: []
		};
	}

	return {
		available: true,
		state: 'available',
		missingMedicalRequirements: []
	};
}
