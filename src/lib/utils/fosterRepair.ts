import type { Dog } from '$lib/types';
import { toDate } from '$lib/utils/dates';

/** A transfer usually reaches the floor within this long of arriving in Incoming. */
const INCOMING_EXIT_MAX_DAYS = 14;

export interface FosterRepairCandidate {
	dog: Dog;
	/** The shelterSince a foster return overwrote — becomes fosterReturnedAt. */
	returnedAt: Date;
	/** A recorded move into foster before it, rather than a guess from the dates. */
	confident: boolean;
	reason: string;
}

const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Dogs whose shelterSince was reset by coming back from foster, before foster returns got
 * their own stamp. The fix moves that date to fosterReturnedAt and clears shelterSince,
 * so the length of stay counts from intake again.
 *
 * Confident when a sync recorded the dog going to foster before its shelterSince. A
 * guess when there is no such record but shelterSince is well after intake — later than
 * a transfer normally leaves Incoming. Either way a person confirms before anything
 * is written.
 */
export function fosterRepairCandidates(
	dogs: Dog[],
	fosterEvents: { dogIds: string[]; createdAt: Date }[]
): FosterRepairCandidate[] {
	const wentToFoster = new Map<string, Date[]>();
	for (const e of fosterEvents) {
		for (const id of e.dogIds) wentToFoster.set(id, [...(wentToFoster.get(id) ?? []), e.createdAt]);
	}

	const out: FosterRepairCandidate[] = [];
	for (const dog of dogs) {
		if (dog.status !== 'active' || dog.fosterReturnedAt) continue;
		const since = toDate(dog.shelterSince ?? null);
		if (!since) continue;

		const before = (wentToFoster.get(dog.id) ?? []).filter((d) => d.getTime() < since.getTime());
		if (before.length > 0) {
			const last = before.reduce((a, b) => (b > a ? b : a));
			out.push({ dog, returnedAt: since, confident: true, reason: `went to foster ${fmt(last)}, back ${fmt(since)}` });
			continue;
		}

		const intake = toDate(dog.intakeDate ?? null);
		if (!intake) continue;
		const days = Math.round((since.getTime() - intake.getTime()) / 86_400_000);
		if (days > INCOMING_EXIT_MAX_DAYS) {
			out.push({
				dog,
				returnedAt: since,
				confident: false,
				reason: `stay restarted ${fmt(since)}, ${days} days after intake — no foster on record, check it`
			});
		}
	}
	return out.sort((a, b) => Number(b.confident) - Number(a.confident) || a.dog.name.localeCompare(b.dog.name));
}
