import { doc, writeBatch, getDocs, collection } from 'firebase/firestore';
import { db } from '$lib/firebase/config';

export type SyncChange = {
	id: string;
	name: string;
	isNew: boolean;
	fields: string[]; // human-readable field labels that changed
};

export type SyncResult = {
	changes: SyncChange[];
	archived: number;
};

const FIELD_LABELS: Record<string, string> = {
	name: 'Name',
	breed: 'Breed',
	sex: 'Sex',
	markings: 'Markings',
	description: 'Notes',
	healthProblems: 'Health',
	isMicrochipped: 'Microchip',
	microchipDate: 'Microchip date',
	isFixed: 'Fixed',
	fixedDate: 'Fixed date',
	isVaccinated: 'Vaccinated',
	vaccinatedDate: 'Vaccine date',
	weightLbs: 'Weight',
	dateOfBirth: 'DOB',
	intakeDate: 'Intake date',
	originalIntakeDate: 'Original intake',
	goodWithDogs: 'Good w/ dogs',
	goodWithCats: 'Good w/ cats',
	goodWithKids: 'Good w/ kids',
	goodWithElderly: 'Good w/ elderly',
	goodOnLead: 'Good on lead',
	goodTraveller: 'Good traveller',
	crateTrained: 'Crate trained',
	pottyTrained: 'Potty trained',
	energyLevel: 'Energy',
	photoUrl: 'Photo',
	inFoster: 'Foster',
	status: 'Status',
	asmShelterCode: 'Shelter code'
};

// Raw shape returned by ASM API (ALL_CAPS field names)
interface AsmAnimal {
	ID: number;
	ANIMALNAME: string;
	SPECIESNAME: string;
	BREEDNAME: string;
	SEXNAME: string;
	DISPLAYLOCATIONNAME: string;
	SHELTERCODE: string;
	ANIMALCOMMENTS: string;
	MARKINGS: string;
	HEALTHPROBLEMS: string;
	// Microchip
	IDENTICHIPPED: number;
	IDENTICHIPNUMBER: string;
	IDENTICHIPDATE: string | null;
	// Fixed/neutered: 0 = unknown, 1 = yes, 2 = no
	NEUTERED: number;
	NEUTEREDDATE: string | null;
	// Vaccinations
	VACCGIVENCOUNT: number;
	VACCRABIESDATE: string | null;
	// Compatibility: 0 = yes, 1 = no, 2 = unknown
	ISGOODWITHDOGS: number;
	ISGOODWITHCATS: number;
	ISGOODWITHCHILDREN: number;
	ISGOODWITHELDERLY: number;
	ISGOODONLEAD: number;
	ISGOODTRAVELLER: number;
	ISCRATETRAINED: number;
	ISHOUSETRAINED: number;
	// Energy level: 0 = unknown, 1 = low, 2 = medium, 3 = high, 4 = very high
	ENERGYLEVEL: number;
	// Size / weight
	WEIGHT: number;
	// Dates
	DATEOFBIRTH: string | null;
	DATEBROUGHTIN: string | null;
	MOSTRECENTENTRYDATE: string | null;
	// Photos
	PHOTOURLS: string[];
	// 1 = permanent foster (will not return to shelter)
	HASPERMANENTFOSTER: number;
	// Non-zero = animal has left shelter. 2 = foster, 1 = adoption, 3 = transfer, etc.
	ACTIVEMOVEMENTTYPE: number;
	DECEASEDDATE: string | null;
	[key: string]: unknown;
}

function normalizeSex(sexName: string): 'male' | 'female' | 'unknown' {
	const s = (sexName ?? '').toLowerCase();
	if (s === 'male') return 'male';
	if (s === 'female') return 'female';
	return 'unknown';
}

// ASM compatibility fields: 0 = yes, 1 = no, 2 = unknown
function normalizeCompat(value: number | undefined): 'yes' | 'no' | 'unknown' {
	if (value === 0) return 'yes';
	if (value === 1) return 'no';
	return 'unknown';
}

// ASM house trained same scale as compat; app has no 'working_on_it' equivalent from ASM
function normalizeHouseTrained(value: number | undefined): 'yes' | 'no' | 'working_on_it' | 'unknown' {
	if (value === 0) return 'yes';
	if (value === 1) return 'no';
	return 'unknown';
}

// ASM energy: 0 = unknown, 1 = low, 2 = medium, 3 = high, 4 = very high
function normalizeEnergy(value: number | undefined): 'low' | 'medium' | 'high' | 'very_high' | 'unknown' {
	if (value === 1) return 'low';
	if (value === 2) return 'medium';
	if (value === 3) return 'high';
	if (value === 4) return 'very_high';
	return 'unknown';
}

function asmToStoredFields(animal: AsmAnimal, now: string) {
	const inFoster = animal.ACTIVEMOVEMENTTYPE === 2;
	const isPermanentFoster = animal.HASPERMANENTFOSTER === 1;
	const photoUrl =
		Array.isArray(animal.PHOTOURLS) && animal.PHOTOURLS.length > 0
			? animal.PHOTOURLS[0]
			: null;

	return {
		name: animal.ANIMALNAME ?? '',
		breed: animal.BREEDNAME ?? '',
		sex: normalizeSex(animal.SEXNAME),
		// outdoorKennelAssignment intentionally omitted — managed by app only
		markings: animal.MARKINGS ?? '',
		description: animal.ANIMALCOMMENTS ?? '',
		healthProblems: animal.HEALTHPROBLEMS ?? '',
		isMicrochipped: animal.IDENTICHIPPED === 1,
		microchipDate: animal.IDENTICHIPDATE || null,
		isFixed: animal.NEUTERED === 1,
		fixedDate: animal.NEUTEREDDATE || null,
		isVaccinated: (animal.VACCGIVENCOUNT ?? 0) > 0,
		vaccinatedDate: animal.VACCRABIESDATE || null,
		weightLbs: typeof animal.WEIGHT === 'number' && animal.WEIGHT > 0 ? animal.WEIGHT : null,
		dateOfBirth: animal.DATEOFBIRTH || now,
		intakeDate: animal.MOSTRECENTENTRYDATE || animal.DATEBROUGHTIN || now,
		originalIntakeDate: animal.DATEBROUGHTIN || now,
		goodWithDogs: normalizeCompat(animal.ISGOODWITHDOGS),
		goodWithCats: normalizeCompat(animal.ISGOODWITHCATS),
		goodWithKids: normalizeCompat(animal.ISGOODWITHCHILDREN),
		goodWithElderly: normalizeCompat(animal.ISGOODWITHELDERLY),
		goodOnLead: normalizeCompat(animal.ISGOODONLEAD),
		goodTraveller: normalizeCompat(animal.ISGOODTRAVELLER),
		crateTrained: normalizeCompat(animal.ISCRATETRAINED),
		pottyTrained: normalizeHouseTrained(animal.ISHOUSETRAINED),
		energyLevel: normalizeEnergy(animal.ENERGYLEVEL),
		photoUrl,
		inFoster,
		permanentFoster: isPermanentFoster,
		// Permanent fosters won't return to shelter — archive them
		status: isPermanentFoster ? 'adopted' : 'active',
		asmId: animal.ID,
		asmShelterCode: animal.SHELTERCODE ?? '',
		_lastSyncedAt: now
	};
}

function defaultStoredFields(now: string) {
	return {
		reentryDates: [],
		leftShelterDate: null,
		foodType: '',
		foodAmount: '',
		dietaryNotes: '',
		hasOwnFood: false,
		transitionToHills: null,
		origin: 'ASM',
		outdoorKennelAssignment: '',
		hiddenComments: '',
		warningNotes: '',
		holdNotes: '',
		idealHome: '',
		lastBathDate: null,
		lastBathBy: null,
		lastDayTripDate: null,
		isOutOnDayTrip: false,
		currentDayTripStartedAt: null,
		surgeryDate: null,
		dayTripStatus: 'eligible',
		dayTripIneligibleReason: null,
		dayTripManagerOnly: false,
		dayTripManagerOnlyReason: null,
		dayTripNotes: null,
		handlingLevel: 'volunteer',
		isolationStatus: 'none',
		isolationStartDate: null,
		createdAt: now,
		updatedAt: now
	};
}

/**
 * Syncs dogs from ASM into the Firestore `dogs` collection.
 *
 * - Uses ASM `ID` as the Firestore document ID.
 * - `merge: true` preserves any app-added fields (handling level, bath dates, etc.).
 * - For brand-new dogs, sensible defaults are written so the app can render them immediately.
 * - Skips unchanged dogs — only writes to Firestore if an ASM field actually changed.
 * - Batches writes in chunks of 499 to stay under Firestore's 500-op limit.
 * - Automatically archives (marks as 'adopted') any ASM-synced dogs that no longer
 *   appear in the ASM response (i.e. were adopted, transferred, or deceased).
 *
 * Returns a SyncResult describing what was added, changed, or archived.
 */
export async function syncAnimalsFromASM(): Promise<SyncResult> {
	if (!db) throw new Error('Firestore not available');

	// 1. Fetch from ASM via server-side proxy (avoids CORS)
	const res = await fetch('/api/asm');
	if (!res.ok) {
		let detail = '';
		try { detail = (await res.json()).message ?? ''; } catch { /* ignore */ }
		throw new Error(`ASM proxy error ${res.status}${detail ? `: ${detail}` : ''}`);
	}
	const allAnimals: AsmAnimal[] = await res.json();

	// 2. Filter: dogs on shelter or in foster (not adopted/transferred/deceased)
	const dogs = allAnimals.filter(
		(a) =>
			(a.SPECIESNAME ?? '').toLowerCase() === 'dog' &&
			(!a.ACTIVEMOVEMENTTYPE || a.ACTIVEMOVEMENTTYPE === 2) &&
			!a.DECEASEDDATE
	);

	// 3. Fetch existing docs to diff against
	const snapshot = await getDocs(collection(db, 'dogs'));
	const existingDocs = new Map(snapshot.docs.map((d) => [d.id, d.data()]));

	const now = new Date().toISOString();
	const BATCH_SIZE = 499;

	// 4. Determine which dogs need writing (new or changed ASM fields)
	type PendingWrite = { animal: AsmAnimal; isNew: boolean; changedFields: string[] };
	const pending: PendingWrite[] = [];

	for (const animal of dogs) {
		const docId = String(animal.ID);
		const existing = existingDocs.get(docId);

		if (!existing) {
			pending.push({ animal, isNew: true, changedFields: [] });
		} else {
			// Compare ASM-sourced fields only (exclude _lastSyncedAt — it always changes)
			const { _lastSyncedAt: _ignored, ...comparable } = asmToStoredFields(animal, now);
			const changedFields = (Object.entries(comparable) as [string, unknown][])
				.filter(([k, v]) => existing[k] !== v)
				.map(([k]) => FIELD_LABELS[k] ?? k);
			if (changedFields.length > 0) pending.push({ animal, isNew: false, changedFields });
		}
	}

	// 5. Write only changed/new dogs in batches
	for (let i = 0; i < pending.length; i += BATCH_SIZE) {
		const batch = writeBatch(db);
		for (const { animal, isNew } of pending.slice(i, i + BATCH_SIZE)) {
			const docId = String(animal.ID);
			const ref = doc(db, 'dogs', docId);
			const asmFields = asmToStoredFields(animal, now);
			if (isNew) {
				batch.set(ref, { id: docId, ...defaultStoredFields(now), ...asmFields }, { merge: true });
			} else {
				batch.set(ref, asmFields, { merge: true });
			}
		}
		await batch.commit();
	}

	const currentAsmIds = new Set(dogs.map((a) => a.ID));
	const archived = await markStaleAsmDogsArchived(currentAsmIds);

	return {
		changes: pending.map(({ animal, isNew, changedFields }) => ({
			id: String(animal.ID),
			name: animal.ANIMALNAME ?? `Dog ${animal.ID}`,
			isNew,
			fields: changedFields
		})),
		archived
	};
}

/**
 * Marks ASM-synced dogs as archived ('adopted') if they no longer appear in the latest
 * ASM response. Only affects docs that have an `asmId` field (i.e. were synced from ASM).
 * Safe to call after syncAnimalsFromASM().
 */
export async function markStaleAsmDogsArchived(currentAsmIds: Set<number>): Promise<number> {
	if (!db) throw new Error('Firestore not available');

	const snapshot = await getDocs(collection(db, 'dogs'));
	const staleDocs = snapshot.docs.filter((d) => {
		const asmId = d.data().asmId as number | undefined;
		return asmId !== undefined && !currentAsmIds.has(asmId);
	});

	if (staleDocs.length === 0) return 0;

	const BATCH_SIZE = 499;
	for (let i = 0; i < staleDocs.length; i += BATCH_SIZE) {
		const batch = writeBatch(db);
		for (const staleDoc of staleDocs.slice(i, i + BATCH_SIZE)) {
			batch.set(staleDoc.ref, {
				status: 'adopted',
				outdoorKennelAssignment: '',
				isOutOnDayTrip: false,
				currentDayTripStartedAt: null,
				_lastSyncedAt: new Date().toISOString()
			}, { merge: true });
		}
		await batch.commit();
	}

	return staleDocs.length;
}
