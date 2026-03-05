import type { DateValue, Dog } from '$lib/types';
import { toDate } from '$lib/utils/dates';

type PuppyBand = 'lt4' | 'm4to9' | 'm10to12';

const ADULT_CHART: Array<{ maxWeight: number; cups: number }> = [
	{ maxWeight: 5, cups: 0.25 },
	{ maxWeight: 10, cups: 0.5 },
	{ maxWeight: 20, cups: 0.75 },
	{ maxWeight: 30, cups: 1.25 },
	{ maxWeight: 40, cups: 1.5 },
	{ maxWeight: 50, cups: 1.5 },
	{ maxWeight: 60, cups: 1.75 },
	{ maxWeight: 70, cups: 2 },
	{ maxWeight: 80, cups: 2.25 },
	{ maxWeight: 90, cups: 2.5 },
	{ maxWeight: 100, cups: 2.75 }
];

const PUPPY_CHART: Array<{
	maxWeight: number;
	lt4: number;
	m4to9: number;
	m10to12: number;
}> = [
	{ maxWeight: 5, lt4: 0.5, m4to9: 0.5, m10to12: 1 / 3 },
	{ maxWeight: 10, lt4: 1, m4to9: 0.75, m10to12: 0.5 },
	{ maxWeight: 15, lt4: 1.25, m4to9: 1, m10to12: 0.75 },
	{ maxWeight: 20, lt4: 1.5, m4to9: 1.25, m10to12: 0.75 },
	{ maxWeight: 25, lt4: 1.75, m4to9: 1.5, m10to12: 1 },
	{ maxWeight: 30, lt4: 2, m4to9: 1.75, m10to12: 1.25 },
	{ maxWeight: 35, lt4: 2.25, m4to9: 2, m10to12: 1.5 },
	{ maxWeight: 40, lt4: 2.5, m4to9: 2, m10to12: 1.75 }
];

export function estimateFoodAmountPerMeal(input: {
	weightLbs: number | null | undefined;
	dateOfBirth?: DateValue | null;
	foodType?: string | null;
	now?: Date;
}): string {
	const weightLbs = normalizeWeightLbs(input.weightLbs);
	if (weightLbs === null) return '';

	const puppyBand = resolvePuppyBand(input.dateOfBirth, input.foodType, input.now);
	if (puppyBand) {
		const puppyCups = estimatePuppyCups(weightLbs, puppyBand);
		return formatCupAmount(puppyCups);
	}

	const adultCups = estimateAdultCups(weightLbs);
	return formatCupAmount(adultCups);
}

function normalizeWeightLbs(value: number | null | undefined): number | null {
	const asNumber = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(asNumber)) return null;
	if (asNumber <= 0) return null;
	return Math.round(asNumber * 10) / 10;
}

function resolvePuppyBand(dateOfBirth: DateValue | null | undefined, foodType: string | null | undefined, now?: Date): PuppyBand | null {
	const today = now ?? new Date();
	const dob = toDate(dateOfBirth ?? null);
	const foodTypeText = (foodType ?? '').toLowerCase();
	const isPuppyFood = foodTypeText.includes('puppy');

	if (dob) {
		const months = ageInMonths(dob, today);
		if (months <= 3) return 'lt4';
		if (months <= 9) return 'm4to9';
		if (months <= 12) return 'm10to12';
		if (months > 12) return null;
	}

	// If age is unknown but a puppy diet is explicitly selected, use mid puppy band.
	return isPuppyFood ? 'm4to9' : null;
}

function ageInMonths(dateOfBirth: Date, now: Date) {
	let months = (now.getFullYear() - dateOfBirth.getFullYear()) * 12;
	months += now.getMonth() - dateOfBirth.getMonth();
	if (now.getDate() < dateOfBirth.getDate()) months -= 1;
	return Math.max(0, months);
}

function estimateAdultCups(weightLbs: number) {
	const bucket = ADULT_CHART.find((row) => weightLbs <= row.maxWeight);
	if (bucket) return bucket.cups;

	const extraSteps = Math.ceil((weightLbs - 100) / 10);
	return 2.75 + Math.max(0, extraSteps) * 0.25;
}

function estimatePuppyCups(weightLbs: number, band: PuppyBand) {
	const bucket = PUPPY_CHART.find((row) => weightLbs <= row.maxWeight) ?? PUPPY_CHART[PUPPY_CHART.length - 1];
	const base = bucket?.[band] ?? 0;

	if (weightLbs <= 40) return base;

	// Chart note: 40+ adds 1/4 cup for every 5 lbs.
	const extraSteps = Math.ceil((weightLbs - 40) / 5);
	return base + Math.max(0, extraSteps) * 0.25;
}

function formatCupAmount(cups: number) {
	if (!Number.isFinite(cups) || cups <= 0) return '';

	const whole = Math.floor(cups);
	const fraction = Math.round((cups - whole) * 12) / 12;
	const fractionLabel = fractionToLabel(fraction);

	if (!fractionLabel) return `${whole} c`;
	if (whole === 0) return `${fractionLabel} c`;
	return `${whole} ${fractionLabel} c`;
}

function fractionToLabel(value: number) {
	if (Math.abs(value - 1 / 3) < 0.01) return '1/3';
	if (Math.abs(value - 0.25) < 0.01) return '1/4';
	if (Math.abs(value - 0.5) < 0.01) return '1/2';
	if (Math.abs(value - 0.75) < 0.01) return '3/4';
	return '';
}

// ─── Food type classification ───

function includesAny(text: string, keywords: string[]): boolean {
	return keywords.some((kw) => text.includes(kw));
}

export function isPuppyFood(dog: Dog): boolean {
	return includesAny((dog.foodType ?? '').trim().toLowerCase(), ['puppy']);
}

export function isOwnFood(dog: Dog): boolean {
	if (dog.hasOwnFood === true) return true;
	const merged = `${(dog.foodType ?? '').trim().toLowerCase()} ${(dog.dietaryNotes ?? '').trim().toLowerCase()}`;
	return includesAny(merged, ['own food', 'from home', 'home food', 'brought', 'personal food']);
}

export function isNormalFood(dog: Dog): boolean {
	return includesAny((dog.foodType ?? '').trim().toLowerCase(), ['normal']);
}

export function foodTypeTone(dog: Dog): 'own' | 'puppy' | 'normal' | 'special' {
	if (isOwnFood(dog)) return 'own';
	if (isPuppyFood(dog)) return 'puppy';
	if (isNormalFood(dog)) return 'normal';
	return 'special';
}

export function foodTypeInstruction(dog: Dog): string {
	if (isOwnFood(dog)) {
		if (dog.transitionToHills === true) return 'Own Food -> Transition to Hills';
		if (dog.transitionToHills === false) return 'Own Food (No Hills Transition)';
		return 'Own Food';
	}
	if (isPuppyFood(dog)) return 'Puppy Food';
	if (isNormalFood(dog)) return 'Normal Food';
	return dog.foodType?.trim() || 'Unknown Food';
}

export function foodTypeLabel(dog: Dog): string {
	if (isOwnFood(dog)) return 'Own Food';
	return dog.foodType?.trim() || 'Unknown';
}
