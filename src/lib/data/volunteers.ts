import type { Volunteer, VolunteerOrientationStatus } from '$lib/types';
import { db } from '$lib/firebase/config';
import { collection, doc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { VolunteerSheetRow } from '../../routes/api/sheets/volunteers/+server';

const COLLECTION = 'volunteers';

function emailToId(email: string): string {
	return email.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
}

function statusFromSheetRow(row: VolunteerSheetRow): VolunteerOrientationStatus {
	if (row.answeredNo) return 'disqualified';
	if (row.noShowed) return 'no_showed';
	if (row.waiverSigned) return 'completed';
	if (row.scheduled) return 'scheduled';
	if (row.emailed) return 'emailed';
	return 'pending';
}

export async function listVolunteers(): Promise<Volunteer[]> {
	if (!db) return [];
	const snap = await getDocs(collection(db, COLLECTION));
	return snap.docs.map((d) => d.data() as Volunteer);
}

export async function syncVolunteers(rows: VolunteerSheetRow[]): Promise<number> {
	if (!db) return 0;
	const now = new Date();
	let count = 0;

	for (const row of rows) {
		if (!row.email && !row.name) continue;
		const id = emailToId(row.email || row.name);
		const ref = doc(db, COLLECTION, id);

		const volunteer: Volunteer = {
			id,
			name: row.name,
			email: row.email,
			submittedAt: row.submittedAt,
			hasDriversLicense: row.hasDriversLicense,
			is18Plus: row.is18Plus,
			dogExperience: row.dogExperience,
			adventurePlans: row.adventurePlans,
			photosOk: row.photosOk,
			leashCommitment: row.leashCommitment,
			orientationStatus: statusFromSheetRow(row),
			waiverSigned: row.waiverSigned,
			internalNotes: '',
			lastSyncedAt: now,
			createdAt: now,
			updatedAt: now
		};

		// Preserve internalNotes and createdAt if record already exists
		await setDoc(ref, volunteer, { merge: true });
		count++;
	}

	return count;
}

export async function updateVolunteerNotes(id: string, notes: string): Promise<void> {
	if (!db) return;
	await updateDoc(doc(db, COLLECTION, id), {
		internalNotes: notes,
		updatedAt: new Date()
	});
}

export async function deleteVolunteer(id: string): Promise<void> {
	if (!db) return;
	await deleteDoc(doc(db, COLLECTION, id));
}
