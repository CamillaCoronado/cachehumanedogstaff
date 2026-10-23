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
	adultFoodTransitionStart?: DateValue | null;
	now?: Date;
}): string {
	const weightLbs = normalizeWeightLbs(input.weightLbs);
	if (weightLbs === null) return '';

	const stage = adultFoodStage(input, input.now);
	if (stage?.kind === 'adult') return formatCupAmount(estimateAdultCups(weightLbs));
	if (stage?.kind === 'suggested') return formatCupAmount(estimatePuppyCups(weightLbs, 'm10to12'));
	if (stage?.kind === 'mixing') {
		const puppyCups = estimatePuppyCups(weightLbs, 'm10to12');
		const adultCups = estimateAdultCups(weightLbs);
		return formatCupAmount(puppyCups + stage.adultShare * (adultCups - puppyCups));
	}

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
	const last = ADULT_CHART[ADULT_CHART.length - 1];
	// Past the chart: 1/4 cup per 10 lbs, prorated by the pound.
	if (weightLbs > last.maxWeight) return last.cups + ((weightLbs - last.maxWeight) / 10) * 0.25;
	return interpolateChart(ADULT_CHART, weightLbs, (row) => row.cups);
}

function estimatePuppyCups(weightLbs: number, band: PuppyBand) {
	const last = PUPPY_CHART[PUPPY_CHART.length - 1];
	// Chart note: 40+ adds 1/4 cup for every 5 lbs, prorated by the pound.
	if (weightLbs > last.maxWeight) return last[band] + ((weightLbs - last.maxWeight) / 5) * 0.25;
	return interpolateChart(PUPPY_CHART, weightLbs, (row) => row[band]);
}

// Weights between chart rows get a proportional amount instead of the next
// row up (which overfed in-between dogs by about 1/4 cup).
function interpolateChart<T extends { maxWeight: number }>(chart: T[], weightLbs: number, cupsOf: (row: T) => number) {
	const upperIndex = chart.findIndex((row) => weightLbs <= row.maxWeight);
	if (upperIndex <= 0) return cupsOf(chart[0]);
	const lower = chart[upperIndex - 1];
	const upper = chart[upperIndex];
	const t = (weightLbs - lower.maxWeight) / (upper.maxWeight - lower.maxWeight);
	return cupsOf(lower) + t * (cupsOf(upper) - cupsOf(lower));
}

function formatCupAmount(cups: number) {
	if (!Number.isFinite(cups) || cups <= 0) return '';
	// Chart values stay exact (1/3 c); anything calculated rounds to the
	// nearest 1/4 c scoop, halfway cases rounding down.
	const twelfths = Math.round(cups * 12) / 12;
	cups = isLabeledFraction(twelfths - Math.floor(twelfths)) ? twelfths : Math.max(0.25, Math.ceil(cups * 4 - 0.5) / 4);

	const whole = Math.floor(cups);
	const fraction = Math.round((cups - whole) * 12) / 12;
	const fractionLabel = fractionToLabel(fraction);

	if (!fractionLabel) return `${whole} c`;
	if (whole === 0) return `${fractionLabel} c`;
	return `${whole} ${fractionLabel} c`;
}

function isLabeledFraction(value: number) {
	return Math.abs(value) < 0.01 || fractionToLabel(value) !== '';
}

function fractionToLabel(value: number) {
	if (Math.abs(value - 1 / 3) < 0.01) return '1/3';
	if (Math.abs(value - 0.25) < 0.01) return '1/4';
	if (Math.abs(value - 0.5) < 0.01) return '1/2';
	if (Math.abs(value - 0.75) < 0.01) return '3/4';
	return '';
}

// ─── Puppy → adult food transition ───

// Daily adult share for the standard 7-day switch; day 7 on is all adult food.
const ADULT_TRANSITION_SCHEDULE = [0.25, 0.25, 0.5, 0.5, 0.75, 0.75];
const ADULT_TRANSITION_SUGGEST_MONTHS = 11;
// Normal-food dogs past this age with no transition on record already went
// adult under the old automatic 12-month switch; don't re-suggest for them.
const ADULT_TRANSITION_SUGGEST_UNTIL_MONTHS = 13;

export type AdultFoodStage =
	| { kind: 'puppy' }
	| { kind: 'suggested' }
	| { kind: 'mixing'; day: number; adultShare: number }
	| { kind: 'adult' };

/**
 * Where a dog is in moving from puppy to adult food. From 11 months the app
 * only suggests the transition; it starts when staff accept it (stamping
 * adultFoodTransitionStart). Null for special diets (No Fish etc.).
 */
export function adultFoodStage(
	dog: { foodType?: string | null; dateOfBirth?: DateValue | null; adultFoodTransitionStart?: DateValue | null },
	day: Date = new Date()
): AdultFoodStage | null {
	const t = (dog.foodType ?? '').trim().toLowerCase();
	const dob = toDate(dog.dateOfBirth ?? null);
	const months = dob ? ageInMonths(dob, day) : null;

	if (t === 'puppy') {
		return months !== null && months >= ADULT_TRANSITION_SUGGEST_MONTHS ? { kind: 'suggested' } : { kind: 'puppy' };
	}
	if (t !== '' && t !== 'normal') return null;

	const start = toDate(dog.adultFoodTransitionStart ?? null);
	if (start) {
		const dayKey = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
		const startKey = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
		const daysIn = Math.max(0, Math.round((dayKey - startKey) / 86_400_000));
		if (daysIn < ADULT_TRANSITION_SCHEDULE.length) {
			return { kind: 'mixing', day: daysIn + 1, adultShare: ADULT_TRANSITION_SCHEDULE[daysIn] };
		}
		return { kind: 'adult' };
	}

	if (months === null) return { kind: 'adult' };
	if (months < ADULT_TRANSITION_SUGGEST_MONTHS) return { kind: 'puppy' };
	if (months < ADULT_TRANSITION_SUGGEST_UNTIL_MONTHS) return { kind: 'suggested' };
	return { kind: 'adult' };
}

function adultTransitionMixLabel(adultShare: number) {
	if (adultShare <= 0.25) return '3/4 Puppy + 1/4 Adult';
	if (adultShare <= 0.5) return '1/2 Puppy + 1/2 Adult';
	return '1/4 Puppy + 3/4 Adult';
}

// ─── Food type classification ───

export function isPuppyFood(dog: Dog, day: Date = new Date()): boolean {
	const kind = adultFoodStage(dog, day)?.kind;
	return kind === 'puppy' || kind === 'suggested';
}

export function isOwnFood(dog: Dog): boolean {
	return dog.hasOwnFood === true;
}

export function isNormalFood(dog: Dog): boolean {
	const t = (dog.foodType ?? '').trim().toLowerCase();
	return t === 'normal' || t === '';
}

export function foodTypeTone(dog: Dog, day: Date = new Date()): 'own' | 'puppy' | 'normal' | 'special' {
	if (isOwnFood(dog)) return 'own';
	if (isPuppyFood(dog, day) || adultFoodStage(dog, day)?.kind === 'mixing') return 'puppy';
	if (isNormalFood(dog)) return 'normal';
	return 'special';
}

export function foodTypeInstruction(dog: Dog, day: Date = new Date()): string {
	if (isOwnFood(dog)) {
		if (dog.transitionToHills === true) return 'Own Food -> Transition to Hills';
		if (dog.transitionToHills === false) return 'Own Food (No Hills Transition)';
		return 'Own Food';
	}
	const stage = adultFoodStage(dog, day);
	if (stage?.kind === 'mixing') return `${adultTransitionMixLabel(stage.adultShare)} (day ${stage.day}/7)`;
	if (isPuppyFood(dog, day)) return 'Puppy Food';
	if (isNormalFood(dog)) return 'Normal Food';
	return dog.foodType?.trim() || 'Unknown Food';
}

export function foodTypeLabel(dog: Dog, day: Date = new Date()): string {
	if (isOwnFood(dog)) return 'Own Food';
	const stage = adultFoodStage(dog, day);
	if (stage?.kind === 'mixing') return `Puppy→Adult ${Math.round(stage.adultShare * 100)}%`;
	return dog.foodType?.trim() || 'Unknown';
}

const abnormalTypes = new Set([1, 2, 5, 6, 7]);

export function foodAmountLabel(dog: Dog) {
	const value = dog.foodAmount?.trim();
	if (value) return value;
	const estimated = estimateFoodAmountPerMeal({
		weightLbs: dog.weightLbs,
		dateOfBirth: dog.dateOfBirth,
		foodType: dog.foodType,
		adultFoodTransitionStart: dog.adultFoodTransitionStart
	});
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

/**
 * FortiFlora runs from its start date for fortifloraDays days; no day count means
 * it runs until someone clears it on the Medical page.
 */
export function isFortifloraActive(dog: Dog, day: Date = new Date()): boolean {
	const start = toDate(dog.fortifloraDate ?? null);
	if (!start) return false;
	const dayKey = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
	const startKey = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
	const daysIn = Math.round((dayKey - startKey) / 86_400_000);
	if (daysIn < 0) return false;
	const total = dog.fortifloraDays;
	return !total || total <= 0 || daysIn < total;
}

export function specialFeedingReasons(dog: Dog, meal?: MealTime, day: Date = new Date()) {
	const reasons: string[] = [];
	const allergies = dog.allergyTypes ?? [];
	if (allergies.length > 0) reasons.push(`Allergy: ${allergies.join(', ')}`);
	if (isOwnFood(dog)) reasons.push('Own Food');
	if (dog.hasOwnFood && dog.transitionToHills === true) reasons.push('→ Transition to Hills');
	if (dog.hasOwnFood && dog.transitionToHills === false) reasons.push('No Hills Transition');
	if (!isOwnFood(dog)) {
		const stage = adultFoodStage(dog, day);
		if (stage?.kind === 'mixing') reasons.push(`Puppy → adult food, day ${stage.day}/7`);
	}
	if (dog.foodType === 'No Fish') reasons.push('No Fish');
	if (dog.foodType === 'No Chicken') reasons.push('No Chicken');
	if (dog.satinBalls) reasons.push('Satin Balls');
	if (dog.hasSupplements) reasons.push('Supplements');
	if (meal !== 'second' && isFortifloraActive(dog, day)) {
		const ft = dog.fortifloraTime ?? 'both';
		const forThisMeal = !meal || ft === 'both' || ft === meal;
		if (forThisMeal) reasons.push(ft === 'both' ? 'FortiFlora' : `FortiFlora (${ft.toUpperCase()})`);
	}
	return reasons;
}

export function isSpecialFeeding(dog: Dog, meal?: MealTime, day?: Date) {
	return specialFeedingReasons(dog, meal, day).length > 0;
}

const MEAL_ORDER: Record<MealTime, number> = { am: 0, pm: 1, second: 2 };

/**
 * Vet-ordered fast: true when the given day + meal falls on or before the
 * dog's fast-until date + meal. "Fast tonight and tomorrow morning" is stored
 * as tomorrow's date with meal 'am', so tonight's PM/2nd and tomorrow's AM all
 * block while tomorrow's PM is back to normal.
 */
export function isFastingMeal(dog: Dog, day: Date, meal: MealTime): boolean {
	const until = toDate(dog.fastUntilDate ?? null);
	if (!until) return false;
	const dayKey = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
	const untilKey = new Date(until.getFullYear(), until.getMonth(), until.getDate()).getTime();
	if (dayKey > untilKey) return false;
	if (dayKey < untilKey) return true;
	return MEAL_ORDER[meal] <= MEAL_ORDER[dog.fastUntilMeal ?? 'second'];
}

export function fastingLabel(dog: Dog): string {
	const reason = dog.fastReason?.trim();
	return reason ? `Fasting — ${reason}` : 'Fasting — do not feed';
}

/**
 * Appetite-risk flag: returns a label when the dog's most recent meal was
 * refused ('none') or barely eaten ('little'), null otherwise.
 *
 * Pass `currentMeal` to ignore the log for the meal being worked right now —
 * a refusal logged this shift should surface as "didn't eat last meal" on the
 * NEXT shift, not the one that just recorded it.
 */
export function appetiteRiskLabel(
	logs: FeedingLog[],
	currentMeal?: { day: Date; mealTime: MealTime }
): string | null {
	const candidates = currentMeal
		? logs.filter(
				(log) => !(log.mealTime === currentMeal.mealTime && isSameCalendarDay(log.date, currentMeal.day))
			)
		: logs;
	if (candidates.length === 0) return null;
	const latest = [...candidates].sort((a, b) => {
		const dateDiff = (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0);
		if (dateDiff !== 0) return dateDiff;
		return (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0);
	})[0];
	if (latest.amountEaten === 'none') return "Didn't eat last meal";
	if (latest.amountEaten === 'little') return 'Ate little last meal';
	return null;
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
