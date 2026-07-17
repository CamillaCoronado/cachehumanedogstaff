import type { Dog } from '$lib/types';
import { checkDayTripEligibility, daysSince, isPuppyAge, sinceReturn } from '$lib/utils/dates';
import {
	getBathStatus,
	getDayTripGapDays,
	isPlaygroupEligible,
	DAYTRIP_OVERDUE_DAYS,
	PLAYGROUP_OVERDUE_DAYS
} from '$lib/utils/attention';
import { getAdoptionAvailability } from '$lib/utils/adoption';
import { resolveDogHandlingLevel } from '$lib/utils/permissions';
import { compatibilityLabel, energyLabel, handlingLevelLabel, pottyLabel, sexLabel } from '$lib/utils/labels';

export type TripEligibility = ReturnType<typeof checkDayTripEligibility>;
export type CardActionTone = 'ready' | 'blocked' | 'info';
export type CardActionItem = {
	label: string;
	tone: CardActionTone;
	priority: number;
	action?: 'log_bath';
};

export function tripPillClass(status: Dog['dayTripStatus']) {
	if (status === 'eligible') return 'status-pill-green';
	if (status === 'difficult') return 'status-pill-yellow';
	return 'status-pill-red';
}

export function tripLabel(status: Dog['dayTripStatus'], notes: string | null | undefined, managerOnly: boolean) {
	if (status === 'eligible') return managerOnly ? 'Day Trip: Manager only' : 'Day Trip: Eligible';
	if (status === 'difficult') {
		const reason = notes?.trim() ?? '';
		const base = reason ? `Day Trip: Adults only - ${reason}` : 'Day Trip: Adults only';
		return managerOnly ? `${base} (manager only)` : base;
	}
	return 'Day Trip: Ineligible';
}

export function handlingPillClass(level: Dog['handlingLevel']) {
	if (level === 'manager_only') return 'status-pill-purple';
	if (level === 'staff_only') return 'status-pill-blue';
	return 'status-pill-green';
}

export function handlingLabel(level: Dog['handlingLevel']) {
	if (level === 'manager_only') return 'Handling: Manager only';
	if (level === 'staff_only') return 'Handling: Staff only';
	return 'Handling: Volunteer OK';
}

export function dogHandlingLevel(dog: Dog) {
	return resolveDogHandlingLevel(dog.handlingLevel);
}

export function adoptionLabel(dog: Dog) {
	const adoption = getAdoptionAvailability(dog);
	if (adoption.state === 'not_available') return 'Adoption: Not available';
	if (adoption.state === 'medical_hold') {
		return `Adoption: Not available (${adoption.missingMedicalRequirements.join(', ')})`;
	}
	if (adoption.state === 'handling_hold') {
		return adoption.holdReason
			? `Adoption: Blocked (${adoption.holdReason})`
			: 'Adoption: Blocked (handling plan)';
	}
	if (adoption.state === 'day_trip_hold') {
		return adoption.holdReason
			? `Adoption: Not available (${adoption.holdReason})`
			: 'Adoption: Not available (care hold)';
	}
	if (adoption.state === 'isolation_hold') return 'Adoption: Temporarily unavailable';
	return 'Adoption: Available';
}

export function adoptionPillClass(dog: Dog) {
	const adoption = getAdoptionAvailability(dog);
	if (adoption.state === 'available') return 'status-pill-green';
	if (adoption.state === 'handling_hold') return 'status-pill-yellow';
	if (adoption.state === 'day_trip_hold') return 'status-pill-yellow';
	if (adoption.state === 'isolation_hold') return 'status-pill-yellow';
	return 'status-pill-red';
}

export function missingEvaluations(dog: Dog) {
	const missing: string[] = [];
	if (dog.goodWithDogs === 'unknown') missing.push('dogs');
	if (dog.goodWithCats === 'unknown') missing.push('cats');
	if (dog.goodWithKids === 'unknown') missing.push('kids');
	if (dog.pottyTrained === 'unknown') missing.push('potty training');
	if (dog.energyLevel === 'unknown') missing.push('energy');
	if ((dog.goodOnLead ?? 'unknown') === 'unknown') missing.push('on-lead');
	if ((dog.crateTrained ?? 'unknown') === 'unknown') missing.push('crate');
	return missing;
}

export function pendingItems(
	dog: Dog,
	tripEligibility: TripEligibility,
	bathDue: boolean,
	lastPlaygroupDate: Date | null,
	today: Date
): CardActionItem[] {
	const items: CardActionItem[] = [];

	if (dog.isOutOnDayTrip) {
		items.push({
			label: 'Currently out on day trip: mark returned when back.',
			tone: 'info',
			priority: 100
		});
	} else {
		for (const reason of tripEligibility.reasons) {
			const normalized = reason.toLowerCase();
			if (normalized.includes('difficult')) continue;
			if (normalized.includes('must be vaccinated')) continue;
			if (normalized.includes('must be spayed/neutered')) continue;
			if (normalized.includes('blocked') || normalized.includes('hold')) continue;
			let priority = 50;
			if (normalized.includes('isolation')) priority = 95;
			else if (normalized.includes('must be vaccinated')) priority = 90;
			else if (normalized.includes('must be spayed/neutered')) priority = 85;
			else if (normalized.includes('must have intake date')) priority = 80;
			else if (normalized.includes('handling')) priority = 79;
			else if (normalized.includes('manager only')) priority = 76;
			else if (normalized.includes('behavior check')) priority = 75;
			const managerOnlyNotice = normalized.includes('manager only');
			const infoTone = managerOnlyNotice && tripEligibility.eligible;

			items.push({
				label: reason,
				tone: infoTone ? 'info' : 'blocked',
				priority
			});
		}
	}

	const effectiveHandlingLevel = dogHandlingLevel(dog);
	if (effectiveHandlingLevel === 'manager_only') {
		items.push({
			label: 'Handling level: manager-only.',
			tone: 'info',
			priority: 78
		});
	}

	if (!dog.inFoster && !dog.awaitingEvaluation && tripEligibility.eligible) {
		const dayTripGap = getDayTripGapDays(dog, today);
		if (dayTripGap === null) {
			items.push({ label: 'No day trip logged yet.', tone: 'info', priority: 68 });
		} else if (dayTripGap >= DAYTRIP_OVERDUE_DAYS) {
			items.push({ label: `${dayTripGap} days since last day trip — overdue.`, tone: 'info', priority: 66 });
		}
	}

	if (isPlaygroupEligible(dog, today)) {
		const playgroupGap = daysSince(sinceReturn(lastPlaygroupDate, dog.shelterSince ?? dog.intakeDate), today);
		if (playgroupGap === null) {
			items.push({ label: 'No playgroup logged yet.', tone: 'info', priority: 63 });
		} else if (playgroupGap >= PLAYGROUP_OVERDUE_DAYS) {
			items.push({ label: `${playgroupGap} days since last playgroup — overdue.`, tone: 'info', priority: 62 });
		}
	}

	// Puppies don't need evaluation — no "Needs evaluation" nag for them.
	const pendingEvaluation = isPuppyAge(dog.dateOfBirth, today) ? [] : missingEvaluations(dog);
	if (pendingEvaluation.length > 0) {
		items.push({
			label: `Needs evaluation: ${pendingEvaluation.join(', ')}`,
			tone: 'blocked',
			priority: 60
		});
	}

	if (bathDue) {
		const bathStatus = getBathStatus(dog, today);
		items.push({
			label: bathStatus.isNewIntake
				? 'Bath needed (new intake).'
				: bathStatus.overdueDays !== null && bathStatus.overdueDays > 0
					? `Bath overdue by ${bathStatus.overdueDays} day${bathStatus.overdueDays === 1 ? '' : 's'}.`
					: 'Bath is due.',
			tone: 'ready',
			priority: 59,
			action: 'log_bath'
		});
	}

	return items.sort((a, b) => b.priority - a.priority);
}

export function actionItemClass(tone: CardActionTone) {
	if (tone === 'ready') return 'next-action-ready';
	if (tone === 'blocked') return 'next-action-blocked';
	return 'next-action-info';
}

export function handlingColorClass(level: Dog['handlingLevel']): string {
	if (level === 'manager_only') return 'card-pill-red';
	if (level === 'staff_only') return 'card-pill-yellow';
	return 'card-pill-green';
}

export function adoptionColorClass(dog: Dog): string {
	const adoption = getAdoptionAvailability(dog);
	if (adoption.state === 'available') return 'card-pill-green';
	return 'card-pill-red';
}

export function tripColorClass(status: Dog['dayTripStatus']): string {
	if (status === 'eligible') return 'card-pill-green';
	if (status === 'difficult') return 'card-pill-yellow';
	return 'card-pill-red';
}

export function toSearchText(dog: Dog) {
	return [
		dog.name,
		dog.breed,
		sexLabel(dog.sex),
		dog.origin,
		dog.idealHome,
		pottyLabel(dog.pottyTrained),
		compatibilityLabel(dog.goodWithDogs),
		compatibilityLabel(dog.goodWithCats),
		compatibilityLabel(dog.goodWithKids),
		handlingLevelLabel(dogHandlingLevel(dog)),
		energyLabel(dog.energyLevel)
	]
		.join(' ')
		.toLowerCase();
}
