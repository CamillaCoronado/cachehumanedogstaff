import type { Volunteer } from '$lib/types';
import { db } from '$lib/firebase/config';
import { collection, doc, getDocs, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import type { VolunteerSheetRow } from '../../routes/api/sheets/volunteers/+server';
import type { IHVSheetRow } from '../../routes/api/sheets/volunteers-ihv/+server';

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

export async function clearAllVolunteers(): Promise<number> {
	if (!db) return 0;
	const snap = await getDocs(collection(db, COLLECTION));
	let deleted = 0;
	for (let i = 0; i < snap.docs.length; i += 500) {
		const batch = writeBatch(db);
		for (const d of snap.docs.slice(i, i + 500)) {
			batch.delete(d.ref);
			deleted++;
		}
		await batch.commit();
	}
	return deleted;
}

export async function listVolunteers(): Promise<Volunteer[]> {
	if (!db) return [];
	const snap = await getDocs(collection(db, COLLECTION));
	return snap.docs.map((d) => d.data() as Volunteer);
}

/**
 * Ids whose orientationStatus was last set from inside the app. The sheet is the source
 * of truth for everything else, but it has no idea who actually turned up today — that
 * gets recorded at the front desk, and a sync must not overwrite it.
 */
async function appManagedStatusIds(): Promise<Set<string>> {
	if (!db) return new Set();
	const snap = await getDocs(collection(db, COLLECTION));
	return new Set(
		snap.docs.filter((d) => (d.data() as Volunteer).statusSetInApp === true).map((d) => d.id)
	);
}

export async function syncVolunteers(rows: VolunteerSheetRow[]): Promise<number> {
	if (!db) return 0;
	const now = new Date();
	let count = 0;
	const appManaged = await appManagedStatusIds();

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
				volunteerType: 'dtv',
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
			// Same guard for status: once the front desk has set it, the sheet stops winning.
			if (appManaged.has(id)) delete (volunteer as Partial<Volunteer>).orientationStatus;
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
		// Claim this volunteer's status for the app so the next sheet sync leaves it alone.
		statusSetInApp: true,
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

export async function updateVolunteerEstablished(id: string, established: boolean): Promise<void> {
	if (!db) return;
	await updateDoc(doc(db, COLLECTION, id), { isEstablished: established, updatedAt: new Date() });
}

export async function deleteVolunteer(id: string): Promise<void> {
	if (!db) return;
	await deleteDoc(doc(db, COLLECTION, id));
}

export async function syncIHVVolunteers(rows: IHVSheetRow[]): Promise<number> {
	if (!db) return 0;
	const now = new Date();
	let count = 0;
	const appManaged = await appManagedStatusIds();

	for (let i = 0; i < rows.length; i += 500) {
		const batch = writeBatch(db);
		for (const row of rows.slice(i, i + 500)) {
			if (!row.name && !row.email) continue;
			const idBase = row.email ? row.email.toLowerCase().replace(/[^a-z0-9]/g, '_') : row.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
			const id = `ihv_${idBase}`;
			const ref = doc(db, COLLECTION, id);

			const today = new Date().toISOString().split('T')[0];
			const isUpcomingDate = Boolean(row.orientationDate && row.orientationDate >= today);
			const orientationStatus: Volunteer['orientationStatus'] = row.isNonActive
				? 'answered_no'
				: row.noShowed
					? 'no_showed'
					: row.isEstablished
						? 'pending'
						: isUpcomingDate
							? 'scheduled'
							: 'pending';

			const record: Partial<Volunteer> = {
				id,
				name: row.name,
				email: row.email,
				phone: row.phone || null,
				volunteerType: 'ihv',
				submittedAt: null,
				hasDriversLicense: false,
				is18Plus: false,
				dogExperience: '',
				adventurePlans: '',
				photosOk: false,
				leashCommitment: false,
				orientationStatus,
				isEstablished: row.isEstablished,
				isNonActive: row.isNonActive,
				trainingSteps: row.trainingSteps,
				sheetNotes: row.sheetNotes || null,
				internalNotes: '',
				lastSyncedAt: now,
				createdAt: now,
				updatedAt: now
			};
			// Only keep orientation date if upcoming — explicitly null out past/stale dates
			(record as Record<string, unknown>).orientationDate =
				(!row.isEstablished && isUpcomingDate) ? row.orientationDate : null;
			if (appManaged.has(id)) delete record.orientationStatus;
			batch.set(ref, record, { merge: true });
			count++;
		}
		await batch.commit();
	}
	return count;
}
