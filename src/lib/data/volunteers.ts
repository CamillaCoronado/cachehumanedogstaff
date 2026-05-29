import type { Volunteer } from '$lib/types';
import { db } from '$lib/firebase/config';
import { collection, doc, getDocs, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import type { VolunteerSheetRow } from '../../routes/api/sheets/volunteers/+server';

const COLLECTION = 'volunteers';

function emailToId(email: string): string {
	return email.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
}

function normalizeIdentityPart(value: string): string {
	return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function volunteerNameEmailKey(row: VolunteerSheetRow): string {
	return `${normalizeIdentityPart(row.name)}|${normalizeIdentityPart(row.email)}`;
}

function volunteerRowToId(row: VolunteerSheetRow, sharedEmailDifferentNameEmails: Set<string>): string {
	const email = normalizeIdentityPart(row.email);
	if (row.sourceSheet === 'Established DTVs') {
		if (!email && row.sourceRow) return `established_dtv_row_${row.sourceRow}`;
		if (email && sharedEmailDifferentNameEmails.has(email)) return `established_dtv_${emailToId(row.email)}_${emailToId(row.name)}`;
	}
	if (row.email) return emailToId(row.email);
	return emailToId(row.name);
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

	const validRows: VolunteerSheetRow[] = [];
	const seenIds = new Map<string, VolunteerSheetRow>();
	const namesByEmail = new Map<string, Set<string>>();
	for (const row of rows) {
		const email = normalizeIdentityPart(row.email);
		if (!email) continue;
		const names = namesByEmail.get(email) ?? new Set<string>();
		names.add(normalizeIdentityPart(row.name));
		namesByEmail.set(email, names);
	}
	const sharedEmailDifferentNameEmails = new Set(
		[...namesByEmail.entries()]
			.filter(([, names]) => names.size > 1)
			.map(([email]) => email)
	);

	for (const row of rows) {
		if (!row.email && !row.name) {
			console.warn('[DTV sheet sync] skipped row before Firestore write', {
				reason: 'missing name and email',
				sourceSheet: row.sourceSheet,
				sourceRow: row.sourceRow
			});
			continue;
		}

		const id = volunteerRowToId(row, sharedEmailDifferentNameEmails);
		const existingRow = seenIds.get(id);
		if (existingRow && volunteerNameEmailKey(row) === volunteerNameEmailKey(existingRow) && (row.isEstablished || existingRow.isEstablished)) {
			console.warn('[DTV sheet sync] duplicate DTV row will overwrite the same volunteer document', {
				documentId: id,
				current: {
					name: row.name,
					email: row.email,
					isEstablished: row.isEstablished,
					sourceSheet: row.sourceSheet,
					sourceRow: row.sourceRow
				},
				firstSeen: {
					name: existingRow.name,
					email: existingRow.email,
					isEstablished: existingRow.isEstablished,
					sourceSheet: existingRow.sourceSheet,
					sourceRow: existingRow.sourceRow
				}
			});
		}
		if (!existingRow) {
			seenIds.set(id, row);
		}

		validRows.push(row);
	}

	// Firestore batch limit is 500 writes
	for (let i = 0; i < validRows.length; i += 500) {
		const batch = writeBatch(db);
		for (const row of validRows.slice(i, i + 500)) {
			const id = volunteerRowToId(row, sharedEmailDifferentNameEmails);
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
