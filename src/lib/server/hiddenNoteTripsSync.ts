import { getAdminDb } from '$lib/firebase/admin';
import { toDate } from '$lib/utils/dates';
import { hasHiddenTripNotes, importedTripId, planHiddenNoteTrips, type HiddenNoteDog } from '$lib/utils/hiddenNoteTrips';
import type { DayTripLog } from '$lib/types';

export interface HiddenNoteTripsResult {
	created: number;
	patched: number;
}

/**
 * The day-trips page's hidden-note import, run with every ASM sync so trips written
 * into ASM hidden comments land without anyone opening Day Trips. Same plan, same
 * deterministic ids, so the page's own import of the same notes is a no-op.
 */
export async function syncHiddenNoteTrips(): Promise<HiddenNoteTripsResult> {
	const db = getAdminDb();
	const snap = await db.collection('dogs').where('status', '==', 'active').get();
	const dogs = snap.docs
		.map((d) => ({ ...(d.data() as Omit<HiddenNoteDog, 'id'>), id: d.id }))
		.filter(hasHiddenTripNotes);
	if (dogs.length === 0) return { created: 0, patched: 0 };

	// Only the dogs with notes, so this stays a handful of small reads.
	const logs = (
		await Promise.all(
			dogs.map(async (dog) => {
				const trips = await db.collection('dogs').doc(dog.id).collection('dayTripLogs').get();
				return trips.docs.map((t) => ({ ...(t.data() as DayTripLog), id: t.id, dogId: dog.id }));
			})
		)
	).flat();

	const { creates, patches } = planHiddenNoteTrips(dogs, logs);
	if (creates.length + patches.length === 0) return { created: 0, patched: 0 };

	const now = new Date().toISOString();
	const batch = db.batch();
	const tripsRef = (dogId: string) => db.collection('dogs').doc(dogId).collection('dayTripLogs');
	for (const { dogId, tripId, trip } of patches) {
		batch.set(
			tripsRef(dogId).doc(tripId),
			{
				tripNotes: trip.tripNotes || null,
				reactionToDogs: trip.reactionToDogs,
				reactionToStrangers: trip.reactionToStrangers,
				reactionToCats: trip.reactionToCats,
				reactionToKids: trip.reactionToKids,
				reactionToLeash: trip.reactionToLeash,
				reactionToCarRides: trip.reactionToCarRides,
				reactionToToys: trip.reactionToToys
			},
			{ merge: true }
		);
	}
	// Same stored shape logManualTrip writes from the page.
	const latestByDog = new Map<string, Date>();
	for (const log of logs) {
		const d = toDate(log.endedAt) ?? toDate(log.startedAt);
		const prev = latestByDog.get(log.dogId);
		if (d && (!prev || d > prev)) latestByDog.set(log.dogId, d);
	}
	for (const { dogId, trip } of creates) {
		// The parser makes local midnight, which on the server is UTC midnight: the evening
		// before in Utah. Noon UTC is early morning the same day there.
		const day = new Date(Date.UTC(trip.date.getFullYear(), trip.date.getMonth(), trip.date.getDate(), 12));
		const id = importedTripId(day);
		const at = day.toISOString();
		batch.set(tripsRef(dogId).doc(id), {
			id,
			dogId,
			startedAt: at,
			endedAt: at,
			startedBy: 'asm-sync',
			startedByName: 'ASM hidden notes',
			endedBy: 'asm-sync',
			endedByName: 'ASM hidden notes',
			startNotes: null,
			endNotes: null,
			volunteerName: null,
			reactionToDogs: trip.reactionToDogs ?? null,
			reactionToStrangers: trip.reactionToStrangers ?? null,
			reactionToCats: trip.reactionToCats ?? null,
			reactionToKids: trip.reactionToKids ?? null,
			reactionToLeash: trip.reactionToLeash ?? null,
			reactionToCarRides: trip.reactionToCarRides ?? null,
			reactionToToys: trip.reactionToToys ?? null,
			tripNotes: trip.tripNotes || null,
			source: 'staff',
			createdAt: now,
			updatedAt: now
		});
		const prev = latestByDog.get(dogId);
		if (!prev || day > prev) latestByDog.set(dogId, day);
	}
	// A new trip can move the dog's last day trip forward; the page recomputes it the same way.
	for (const dogId of new Set(creates.map((c) => c.dogId))) {
		const latest = latestByDog.get(dogId);
		if (latest) batch.set(db.collection('dogs').doc(dogId), { lastDayTripDate: latest.toISOString() }, { merge: true });
	}
	await batch.commit();
	return { created: creates.length, patched: patches.length };
}
