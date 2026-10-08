import type { Dog } from '$lib/types';
import { toDate } from '$lib/utils/dates';

const DAY_MS = 86_400_000;

/** One adoption: how many days the dog was ours, from its latest intake to the day it left. */
export interface AdoptionStay {
	dog: Dog;
	adoptedOn: Date;
	days: number;
}

export interface TurnaroundSummary {
	count: number;
	medianDays: number | null;
	averageDays: number | null;
}

export interface TurnaroundWindow extends TurnaroundSummary {
	label: string;
}

export interface TurnaroundMonth extends TurnaroundSummary {
	/** First of the month, local time. */
	month: Date;
}

function startOfDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Every adopted dog with a usable stay. intakeDate is the latest entry, so a dog adopted,
 * returned and adopted again counts its last stay only. Foster time counts: the dog was
 * still ours. A departure before the intake belongs to an earlier stay and is left out.
 */
export function adoptionStays(dogs: Dog[]): AdoptionStay[] {
	const stays: AdoptionStay[] = [];
	for (const dog of dogs) {
		if (dog.status !== 'adopted') continue;
		const intake = toDate(dog.intakeDate);
		const left = toDate(dog.leftShelterDate ?? null);
		if (!intake || !left) continue;
		const days = Math.round((startOfDay(left).getTime() - startOfDay(intake).getTime()) / DAY_MS);
		if (days < 0) continue;
		stays.push({ dog, adoptedOn: left, days });
	}
	return stays.sort((a, b) => b.adoptedOn.getTime() - a.adoptedOn.getTime());
}

export function summarize(stays: AdoptionStay[]): TurnaroundSummary {
	if (stays.length === 0) return { count: 0, medianDays: null, averageDays: null };
	const days = stays.map((s) => s.days).sort((a, b) => a - b);
	const mid = Math.floor(days.length / 2);
	const median = days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
	const average = days.reduce((sum, d) => sum + d, 0) / days.length;
	return { count: days.length, medianDays: median, averageDays: average };
}

/** Rolling windows by adoption date, ending today. */
export function turnaroundWindows(stays: AdoptionStay[], now = new Date()): TurnaroundWindow[] {
	const today = startOfDay(now);
	const since = (days: number) => {
		const from = new Date(today);
		from.setDate(from.getDate() - days);
		return stays.filter((s) => s.adoptedOn >= from);
	};
	return [
		{ label: 'Last 30 days', ...summarize(since(30)) },
		{ label: 'Last 90 days', ...summarize(since(90)) },
		{ label: 'Last 12 months', ...summarize(since(365)) },
		{ label: 'All time', ...summarize(stays) }
	];
}

/** The last `months` calendar months, newest first, including the current one. */
export function turnaroundByMonth(stays: AdoptionStay[], now = new Date(), months = 12): TurnaroundMonth[] {
	const rows: TurnaroundMonth[] = [];
	for (let i = 0; i < months; i++) {
		const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const inMonth = stays.filter(
			(s) => s.adoptedOn.getFullYear() === month.getFullYear() && s.adoptedOn.getMonth() === month.getMonth()
		);
		rows.push({ month, ...summarize(inMonth) });
	}
	return rows;
}
