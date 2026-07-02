import { listAllDayTripLogs, updateDog, logManualTrip, patchDayTripLog, importedTripId, syncSheetColorsToDogs } from '$lib/data/dogs';
import { listVolunteers } from '$lib/data/volunteers';
import { ensureDogsLoaded, refreshDogs, patchDogInStore } from '$lib/stores/dogs';
import { toDate } from '$lib/utils/dates';
import { parseDayTripNotes } from '$lib/utils/tripNotesParser';
import type { DayTripLog, Dog, Volunteer } from '$lib/types';

export interface DayTripData {
	logs: DayTripLog[];
	volunteers: Volunteer[];
}

/**
 * Loads everything the day-trips page needs (dogs, all trip logs, volunteers) and applies
 * the two sheet-driven side effects: syncing DT-sheet colors into each dog's single color
 * field, and the one-time awaitingEvaluation auto-clear. Dogs flow through the shared
 * dog store ($lib/stores/dogs) — read them from `$dogs`; both side effects are patched
 * into the store. UI concerns (loading flags, toasts) stay in the page.
 */
export async function loadDayTripData(forceDogs = true): Promise<DayTripData> {
	const [dogRows, logs, colorsRes, volunteers] = await Promise.all([
		forceDogs ? refreshDogs() : ensureDogsLoaded(),
		listAllDayTripLogs(),
		fetch('/api/sheets/dog-colors').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
		listVolunteers()
	]);

	// Sync sheet colors into each dog's single color field — only when the sheet value
	// actually changed, so a manual color persists until the sheet next changes.
	const sheet = colorsRes as Record<string, 'green' | 'yellow' | 'red'>;
	const colorChanges = await syncSheetColorsToDogs(dogRows, sheet);

	// Auto-clear awaitingEvaluation once, the first time a dog appears on the DT
	// Numbers sheet with a color. `evaluationAutoCleared` guards it so a later
	// MANUAL re-check of awaitingEvaluation is respected and not cleared again.
	const evaluated = dogRows.filter((d) => {
		if (!d.awaitingEvaluation || d.evaluationAutoCleared) return false;
		const key = d.name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
		return Boolean(sheet[key]);
	});
	if (evaluated.length > 0) {
		await Promise.all(evaluated.map((d) => updateDog(d.id, { awaitingEvaluation: false, evaluationAutoCleared: true })));
	}

	// Apply both the color sync and the eval auto-clear to the shared store so
	// every page sees them.
	for (const [id, color] of colorChanges) {
		patchDogInStore(id, { manualTripColor: color, lastSheetColor: color });
	}
	for (const d of evaluated) {
		patchDogInStore(d.id, { awaitingEvaluation: false, evaluationAutoCleared: true });
	}

	return { logs, volunteers };
}

export interface AutoImportResult {
	totalNew: number;
	totalPatched: number;
}

/**
 * Imports "Day Trip Notes M/D:" blocks from ASM hidden comments into trip logs.
 * Idempotent (importedTripId) and patch-guarded. Throws on write failure — callers
 * own toasts and refreshing.
 *
 * NOTE: we intentionally do NOT strip the notes out of hiddenComments. ASM owns
 * hiddenComments and re-pushes the full ASM value (notes included) on every sync,
 * so persisting a stripped copy just created an endless write-fight (every ASM sync
 * re-flagged "Hidden comments changed") and could destroy not-yet-logged recent
 * notes. The dog detail page strips the notes for display only.
 */
export async function autoImportTripsFromHiddenNotes(dogs: Dog[], logs: DayTripLog[]): Promise<AutoImportResult> {
	// Only sync real, in-shelter dogs, and only when an actual dated note block
	// is present — a loose "day trip notes" mention (no date) would otherwise be
	// re-selected on every sync and never clear.
	const dogsWithNotes = dogs.filter(
		(d) =>
			d.status === 'active' &&
			!d.permanentFoster &&
			!d.inFoster &&
			!d.isIncoming &&
			/Day Trip Notes\s+\d{1,2}\/\d{1,2}\s*:/i.test(d.hiddenComments ?? '')
	);

	let totalNew = 0;
	let totalPatched = 0;
	for (const dog of dogsWithNotes) {
		const parsed = parseDayTripNotes(dog.hiddenComments!);

		for (const trip of parsed) {
			const tripDay = trip.date.toDateString();
			const existing = logs.find(
				(l) => l.dogId === dog.id && toDate(l.startedAt)?.toDateString() === tripDay
			);

			if (existing) {
				// Patch only if notes/ratings are still empty
				const needsPatch =
					!existing.tripNotes &&
					!existing.reactionToDogs && !existing.reactionToStrangers &&
					!existing.reactionToCats && !existing.reactionToKids &&
					!existing.reactionToLeash && !existing.reactionToCarRides &&
					!existing.reactionToToys;
				if (!needsPatch) continue;
				await patchDayTripLog(dog.id, existing.id, {
					tripNotes: trip.tripNotes || null,
					reactionToDogs: trip.reactionToDogs,
					reactionToStrangers: trip.reactionToStrangers,
					reactionToCats: trip.reactionToCats,
					reactionToKids: trip.reactionToKids,
					reactionToLeash: trip.reactionToLeash,
					reactionToCarRides: trip.reactionToCarRides,
					reactionToToys: trip.reactionToToys
				});
				totalPatched++;
			} else {
				await logManualTrip(dog.id, {
					logId: importedTripId(trip.date),
					startedAt: trip.date,
					endedAt: trip.date,
					volunteerName: null,
					reactionToDogs: trip.reactionToDogs,
					reactionToStrangers: trip.reactionToStrangers,
					reactionToCats: trip.reactionToCats,
					reactionToKids: trip.reactionToKids,
					reactionToLeash: trip.reactionToLeash,
					reactionToCarRides: trip.reactionToCarRides,
					reactionToToys: trip.reactionToToys,
					tripNotes: trip.tripNotes,
					source: 'staff'
				}, null);
				totalNew++;
			}
		}
	}

	return { totalNew, totalPatched };
}
