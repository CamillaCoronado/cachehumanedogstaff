import type { DateValue, Dog, FeedingLog, MealTime, StoolLog } from '$lib/types';
import { isSameCalendarDay, toDate } from '$lib/utils/dates';

type PuppyBand = 'lt4' | 'm4to9' | 'm10to12';

// Source: the shelter's laminated "Serving Sizes" wall chart (per-meal amounts,
// based on the dog's ideal weight). Verified against a photo of the chart
// 2026-06-12. Note these are the shelter's own per-meal conversions and do not
// match Hill's published per-day tables exactly — the wall chart is authoritative.
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
	{ maxWeight: 20, lt4: 1.5, m4to9: 1.25, m10to12: 1 },
	{ maxWeight: 25, lt4: 1.75, m4to9: 1.5, m10to12: 1.25 },
	{ maxWeight: 30, lt4: 2, m4to9: 1.75, m10to12: 1.5 },
	{ maxWeight: 35, lt4: 2.25, m4to9: 2, m10to12: 1.75 },
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
		if (months < 12) return 'm10to12';
		return null;
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

export function isPuppyFood(dog: Dog): boolean {
	const t = (dog.foodType ?? '').trim().toLowerCase();
	if (t === 'puppy') return true;
	if (t === '' || t === 'normal') {
		const dob = toDate(dog.dateOfBirth ?? null);
		if (dob) return ageInMonths(dob, new Date()) < 12;
	}
	return false;
}

export function isOwnFood(dog: Dog): boolean {
	return dog.hasOwnFood === true;
}

export function isNormalFood(dog: Dog): boolean {
	const t = (dog.foodType ?? '').trim().toLowerCase();
	return t === 'normal' || t === '';
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

const abnormalTypes = new Set([1, 2, 5, 6, 7]);

export function foodAmountLabel(dog: Dog) {
	const value = dog.foodAmount?.trim();
	if (value) return value;
	const estimated = estimateFoodAmountPerMeal({ weightLbs: dog.weightLbs, dateOfBirth: dog.dateOfBirth, foodType: dog.foodType });
	return estimated || '—';
}

export function secondMealAmountLabel(dog: Dog) {
	return dog.secondMealAmount?.trim() || foodAmountLabel(dog);
}

export function feedingFlags(dog: Dog) {
	const flags: string[] = [];
	if ((dog.allergyTypes ?? []).length > 0) flags.push('Allergy');
	if (dog.hasSupplements) flags.push('Supplements');
	return flags;
}

export function specialFeedingReasons(dog: Dog, meal?: MealTime) {
	const reasons: string[] = [];
	const allergies = dog.allergyTypes ?? [];
	if (allergies.length > 0) reasons.push(`Allergy: ${allergies.join(', ')}`);
	if (isOwnFood(dog)) reasons.push('Own Food');
	if (dog.hasOwnFood && dog.transitionToHills === true) reasons.push('→ Transition to Hills');
	if (dog.hasOwnFood && dog.transitionToHills === false) reasons.push('No Hills Transition');
	if (dog.foodType === 'No Fish') reasons.push('No Fish');
	if (dog.foodType === 'No Chicken') reasons.push('No Chicken');
	if (dog.satinBalls) reasons.push('Satin Balls');
	if (dog.hasSupplements) reasons.push('Supplements');
	if (dog.fortifloraDate && meal !== 'second') {
		const ft = dog.fortifloraTime ?? 'both';
		const forThisMeal = !meal || ft === 'both' || ft === meal;
		if (forThisMeal) reasons.push(ft === 'both' ? 'FortiFlora' : `FortiFlora (${ft.toUpperCase()})`);
	}
	return reasons;
}

export function isSpecialFeeding(dog: Dog) {
	return specialFeedingReasons(dog).length > 0;
}

export function foodSummary(dog: Dog) {
	return `${foodAmountLabel(dog)} • ${foodTypeLabel(dog)}`;
}

export function getFedMap(list: Dog[], logs: Record<string, FeedingLog[]>, day: Date, meal: MealTime) {
	const map: Record<string, FeedingLog | null> = {};
	for (const dog of list) {
		const entries = logs[dog.id] ?? [];
		map[dog.id] = entries.find((log) => log.mealTime === meal && isSameCalendarDay(log.date, day)) ?? null;
	}
	return map;
}

export type FeedingHistoryEntry = {
	id: string;
	dogName: string;
	date: FeedingLog['date'];
	mealTime: FeedingLog['mealTime'];
	amountEaten: FeedingLog['amountEaten'];
	notes: FeedingLog['notes'];
	loggedByName: FeedingLog['loggedByName'];
	sortTime: number;
};

function toMillis(value: unknown) {
	if (value instanceof Date) return value.getTime();
	if (value && typeof value === 'object' && 'toDate' in value) {
		const candidate = (value as { toDate?: () => Date }).toDate;
		if (typeof candidate === 'function') {
			const asDate = candidate();
			return asDate instanceof Date ? asDate.getTime() : 0;
		}
	}
	return 0;
}

export function getFeedingHistoryEntries(list: Dog[], logs: Record<string, FeedingLog[]>) {
	const entries: FeedingHistoryEntry[] = [];
	for (const dog of list) {
		for (const log of logs[dog.id] ?? []) {
			entries.push({
				id: log.id,
				dogName: dog.name,
				date: log.date,
				mealTime: log.mealTime,
				amountEaten: log.amountEaten,
				notes: log.notes,
				loggedByName: log.loggedByName,
				sortTime: toMillis(log.createdAt) || toMillis(log.date)
			});
		}
	}
	return entries.sort((a, b) => b.sortTime - a.sortTime);
}

export function getAbnormalCount(list: Dog[], logs: Record<string, StoolLog[]>, day: Date) {
	let count = 0;
	for (const dog of list) {
		const entries = logs[dog.id] ?? [];
		for (const log of entries) {
			if (isSameCalendarDay(log.timestamp, day) && abnormalTypes.has(log.stoolType)) {
				count += 1;
			}
		}
	}
	return count;
}
