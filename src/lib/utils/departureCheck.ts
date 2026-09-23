import type { Dog } from '$lib/types';
import { toDate } from '$lib/utils/dates';

/** What ASM says happened to an animal: its last movement, or its death. */
export interface AsmDeparture {
	/** Not found in ASM by id or shelter code. */
	found: boolean;
	/** ASM movement type; null when there is none (still on the shelter). */
	movementType: number | null;
	/** YYYY-MM-DD of that movement, if any. */
	movementDate: string | null;
	/** YYYY-MM-DD of death, if any — outranks any movement. */
	deceasedDate: string | null;
}

const MOVEMENT_LABELS: Record<number, string> = {
	1: 'adopted',
	2: 'in foster',
	3: 'transferred',
	4: 'escaped',
	5: 'reclaimed by owner',
	6: 'stolen',
	7: 'released',
	8: 'moved to retailer'
};

export type DepartureCheck =
	| { kind: 'ok' }
	| { kind: 'not-found' }
	/** ASM shows the dog on the shelter or in foster, but the app has it archived. */
	| { kind: 'still-here'; label: string }
	| { kind: 'fix'; status: Dog['status']; date: string; reason: string };

const localDay = (value: Dog['leftShelterDate']) => {
	const d = toDate(value ?? null);
	return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
};

/**
 * Compares an archived dog with ASM. A death wins; otherwise the last movement decides
 * the outcome (adopted or transferred — others keep the app's status, which has nothing
 * closer) and its date is the departure date. Anything that differs is a fix.
 */
export function checkDeparture(dog: Dog, asm: AsmDeparture): DepartureCheck {
	if (!asm.found) return { kind: 'not-found' };

	let status: Dog['status'] = dog.status;
	let date: string | null;
	let what: string;
	if (asm.deceasedDate) {
		status = 'euthanized';
		date = asm.deceasedDate;
		what = 'deceased';
	} else if (asm.movementType === null || asm.movementType === 0 || asm.movementType === 2) {
		return { kind: 'still-here', label: asm.movementType === 2 ? 'in foster' : 'on the shelter' };
	} else {
		if (asm.movementType === 1) status = 'adopted';
		if (asm.movementType === 3) status = 'transferred';
		date = asm.movementDate;
		what = MOVEMENT_LABELS[asm.movementType] ?? `movement ${asm.movementType}`;
	}
	if (!date) return { kind: 'ok' };

	const currentDay = localDay(dog.leftShelterDate);
	if (status === dog.status && currentDay === date) return { kind: 'ok' };

	const parts: string[] = [];
	if (status !== dog.status) parts.push(`${dog.status} → ${status}`);
	if (currentDay !== date) parts.push(`${currentDay ?? 'no date'} → ${date}`);
	return { kind: 'fix', status, date, reason: `ASM: ${what}. ${parts.join(', ')}` };
}
