import type { Volunteer } from '$lib/types';
import { db } from '$lib/firebase/config';
import { collection, doc, getDocs, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import type { VolunteerSheetRow } from '../../routes/api/sheets/volunteers/+server';

const COLLECTION = 'volunteers';

function emailToId(email: string): string {
	return email.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
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

	const validRows = rows.filter((r) => r.email || r.name);

	// Firestore batch limit is 500 writes
	for (let i = 0; i < validRows.length; i += 500) {
		const batch = writeBatch(db);
		for (const row of validRows.slice(i, i + 500)) {
			const id = emailToId(row.email || row.name);
			const ref = doc(db, COLLECTION, id);
			const volunteer: Omit<Volunteer, 'orientationDate'> & { orientationDate?: string | null } = {
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
				orientationStatus: row.orientationStatus,
				isEstablished: row.isEstablished,
				internalNotes: '',
				lastSyncedAt: now,
				createdAt: now,
				updatedAt: now
			};
			// Only sync orientationDate from sheet when it's present — preserve manually-set dates otherwise
			if (row.orientationDate) volunteer.orientationDate = row.orientationDate;
			// merge:true preserves internalNotes, orientationDate (when not overridden), and createdAt
			batch.set(ref, volunteer, { merge: true });
			count++;
		}
		await batch.commit();
	}

	return count;
}

export async function updateVolunteerStatus(id: string, status: import('$lib/types').VolunteerOrientationStatus): Promise<void> {
	if (!db) return;
	await updateDoc(doc(db, COLLECTION, id), {
		orientationStatus: status,
		updatedAt: new Date()
	});
}

export async function updateOrientationDate(id: string, date: string): Promise<void> {
	if (!db) return;
	await updateDoc(doc(db, COLLECTION, id), {
		orientationDate: date || null,
		updatedAt: new Date()
	});
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
