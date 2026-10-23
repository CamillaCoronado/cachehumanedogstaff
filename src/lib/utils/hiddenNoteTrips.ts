import { toDate, toDateString } from '$lib/utils/dates';
import { parseDayTripNotes, type ParsedTrip } from '$lib/utils/tripNotesParser';
import type { DayTripLog } from '$lib/types';

// Deterministic id for a trip imported from notes/spreadsheet, keyed on the trip day.
// Re-importing the same day overwrites the same row instead of creating a duplicate,
// so concurrent imports across devices (and the server sync) can never double up.
export function importedTripId(date: Date): string {
	return `imp-${toDateString(date)?.slice(0, 10) ?? 'unknown'}`;
}

/** The dog fields the hidden-note import reads, so the server can pass raw docs. */
export interface HiddenNoteDog {
	id: string;
	status?: string | null;
	permanentFoster?: boolean | null;
	inFoster?: boolean | null;
	isIncoming?: boolean | null;
	hiddenComments?: string | null;
}

type ExistingTrip = Pick<
	DayTripLog,
	| 'id'
	| 'dogId'
	| 'startedAt'
	| 'tripNotes'
	| 'reactionToDogs'
	| 'reactionToStrangers'
	| 'reactionToCats'
	| 'reactionToKids'
	| 'reactionToLeash'
	| 'reactionToCarRides'
	| 'reactionToToys'
>;

export interface HiddenNoteTripPlan {
	creates: { dogId: string; trip: ParsedTrip }[];
	patches: { dogId: string; tripId: string; trip: ParsedTrip }[];
}

const DATED_NOTE_BLOCK = /Day Trip Notes\s+\d{1,2}\/\d{1,2}\s*:/i;

/**
 * Only real, in-shelter dogs, and only when an actual dated note block is present —
 * a loose "day trip notes" mention (no date) would otherwise be re-selected on every
 * sync and never clear.
 */
export function hasHiddenTripNotes(dog: HiddenNoteDog): boolean {
	return (
		dog.status === 'active' &&
		!dog.permanentFoster &&
		!dog.inFoster &&
		!dog.isIncoming &&
		DATED_NOTE_BLOCK.test(dog.hiddenComments ?? '')
	);
}

/**
 * What the "Day Trip Notes M/D:" blocks in ASM hidden comments add to the trip logs:
 * a new trip for a day with none, or notes and ratings on that day's trip when it has
 * none yet. Shared by the day-trips page and the ASM sync so both import the same way.
 */
export function planHiddenNoteTrips(dogs: HiddenNoteDog[], logs: ExistingTrip[]): HiddenNoteTripPlan {
	const plan: HiddenNoteTripPlan = { creates: [], patches: [] };
	for (const dog of dogs.filter(hasHiddenTripNotes)) {
		for (const trip of parseDayTripNotes(dog.hiddenComments!)) {
			const tripDay = trip.date.toDateString();
			const existing = logs.find(
				(l) => l.dogId === dog.id && toDate(l.startedAt)?.toDateString() === tripDay
			);
			if (!existing) {
				plan.creates.push({ dogId: dog.id, trip });
				continue;
			}
			// Patch only if notes/ratings are still empty
			const empty =
				!existing.tripNotes &&
				!existing.reactionToDogs && !existing.reactionToStrangers &&
				!existing.reactionToCats && !existing.reactionToKids &&
				!existing.reactionToLeash && !existing.reactionToCarRides &&
				!existing.reactionToToys;
			if (empty) plan.patches.push({ dogId: dog.id, tripId: existing.id, trip });
		}
	}
	return plan;
}
