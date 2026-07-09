import { randomUUID } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { ParsedAction, StaffMatch } from './types';
import { currentShift } from './types';
import { formatPhoneNumber } from '$lib/utils/phone';

// Writes mirror the client data layer's stored shapes exactly (data/dogs.ts
// serializers: ISO-string dates, uuid ids) so the app reads them like any
// other log. Everything is attributed to the matched staff profile.

export async function applyActions(
	db: Firestore,
	actions: ParsedAction[],
	staff: StaffMatch,
	now: Date
): Promise<void> {
	for (const action of actions) {
		switch (action.type) {
			case 'feeding': {
				const id = randomUUID();
				await db.collection('dogs').doc(action.dogId).collection('feedingLogs').doc(id).set({
					id,
					date: now.toISOString(),
					mealTime: action.mealTime,
					amountEaten: action.amountEaten,
					notes: action.notes ?? null,
					loggedBy: staff.uid,
					loggedByName: staff.displayName,
					createdAt: now.toISOString()
				});
				break;
			}
			case 'dog_note': {
				const id = randomUUID();
				await db.collection('dogs').doc(action.dogId).collection('behavioralNotes').doc(id).set({
					id,
					note: action.note,
					createdAt: now.toISOString(),
					loggedBy: staff.uid,
					loggedByName: staff.displayName
				});
				break;
			}
			case 'trip_return': {
				// Same as the board's "Mark Returned" (setDogTripStatus false).
				await db.collection('dogs').doc(action.dogId).set(
					{ isOutOnDayTrip: false, currentDayTripStartedAt: null },
					{ merge: true }
				);
				if (action.note?.trim()) {
					const id = randomUUID();
					await db.collection('dogs').doc(action.dogId).collection('behavioralNotes').doc(id).set({
						id,
						note: `Day trip: ${action.note.trim()}`,
						createdAt: now.toISOString(),
						loggedBy: staff.uid,
						loggedByName: staff.displayName
					});
				}
				break;
			}
			case 'handoff_note': {
				// Append to the current shift's handoff note (data/handoff.ts shape).
				const date = now.toISOString().slice(0, 10);
				const shift = currentShift(now);
				const ref = db.collection('shiftHandoffs').doc(`${date}-${shift}`);
				const snap = await ref.get();
				const existing = snap.exists ? ((snap.data()?.note as string) ?? '') : '';
				const line = `${staff.displayName} (phone): ${action.note}`;
				await ref.set(
					{
						id: `${date}-${shift}`,
						date,
						shift,
						note: existing.trim() ? `${existing}\n${line}` : line,
						updatedBy: staff.displayName,
						updatedAt: now.toISOString()
					},
					{ merge: true }
				);
				break;
			}
		}
	}
}

/** Queue an unparseable message for the in-app review list. Nothing is lost. */
export async function queueForReview(
	db: Firestore,
	message: { from: string; channel: string; text: string },
	staff: StaffMatch,
	reason: string,
	now: Date
): Promise<void> {
	await db.collection('phoneInbox').add({
		status: 'needs_review',
		reason,
		text: message.text,
		channel: message.channel,
		fromName: staff.displayName,
		fromPhone: formatPhoneNumber(message.from),
		staffUid: staff.uid,
		receivedAt: now.toISOString()
	});
}
