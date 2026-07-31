import { doc, writeBatch, getDocs, collection } from 'firebase/firestore';
import { db } from '$lib/firebase/config';
import { isPuppyAge } from '$lib/utils/dates';
import { readJson, writeJson } from '$lib/utils/storage';

export type SyncChange = {
	id: string;
	name: string;
	isNew: boolean;
	isArchived: boolean;      // adopted
	isTransferredOut: boolean;
	isEuthanized: boolean;
	fields: string[]; // human-readable field labels that changed
};

export type SyncResult = {
	changes: SyncChange[];
};

export type ArchiveOutcome = 'adopted' | 'transferred' | 'euthanized';

const FIELD_LABELS: Record<string, string> = {
	name: 'Name',
	breed: 'Breed',
	color: 'Color',
	sex: 'Sex',
	markings: 'Markings',
	description: 'Notes',
	hiddenComments: 'Hidden comments',
	entryReason: 'Entry reason',
	warningNotes: 'Warning',
	healthProblems: 'Health',
	isMicrochipped: 'Microchip',
	microchipDate: 'Microchip date',
	isFixed: 'Fixed',
	fixedDate: 'Fixed date',
	isVaccinated: 'Vaccinated',
	vaccineCount: 'Vaccine count',
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
	isolationStatus: 'Isolation',
	status: 'Status',
	asmShelterCode: 'Shelter code',
	origin: 'Origin'
};

// Long-form or opaque fields where showing the value isn't useful
const TEXT_ONLY_FIELDS = new Set([
	'description', 'hiddenComments', 'entryReason', 'warningNotes', 'markings', 'healthProblems', 'origin',
	'microchipDate', 'fixedDate', 'vaccinatedDate', 'dateOfBirth',
	'intakeDate', 'originalIntakeDate', 'photoUrl', 'asmShelterCode'
]);

function formatSyncValue(key: string, value: unknown): string | null {
	if (TEXT_ONLY_FIELDS.has(key)) return null;
	if (value === null || value === undefined) return null;
	if (typeof value === 'boolean') return value ? 'yes' : 'no';
	if (key === 'energyLevel') return String(value).replace('_', ' ');
	if (key === 'weightLbs') return `${value} lbs`;
	if (key === 'vaccineCount') return String(value);
	if (typeof value === 'string' && value.length <= 20) return value;
	if (typeof value === 'number') return String(value);
	return null;
}

// Raw shape returned by ASM API (ALL_CAPS field names)
interface AsmAnimal {
	ID: number;
	ANIMALNAME: string;
	SPECIESNAME: string;
	BREEDNAME: string;
	BASECOLOURNAME: string;
	SEXNAME: string;
	DISPLAYLOCATIONNAME: string;
	SHELTERCODE: string;
	ANIMALCOMMENTS: string;
	HIDDENANIMALDETAILS: string;
	POPUPWARNING: string;
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
	VACCOUTSTANDINGCOUNT: number;
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
	WEBSITEIMAGECOUNT?: number | null;
	WEBSITEMEDIANAME?: string | null;
	WEBSITEMEDIADATE?: string | null;
	// 1 = permanent foster (will not return to shelter)
	HASPERMANENTFOSTER: number;
	// Non-zero = animal has left shelter. 2 = foster, 1 = adoption, 3 = transfer, etc.
	ACTIVEMOVEMENTTYPE: number;
	ACTIVEMOVEMENTDATE: string | null;
	DECEASEDDATE: string | null;
	BROUGHTINBYOWNERNAME: string | null;
	BROUGHTINBYOWNERCOUNTY: string | null;
	ORIGINALOWNERNAME: string | null;
	// 1 = transferred in from another organization
	ISTRANSFER: number;
	// "Transfer In", "Owner Surrender", "Stray", etc.
	ENTRYTYPENAME: string | null;
	// Free text on the intake: why the animal came in — for re-surrendered/returned dogs
	// this is where staff record why they were returned.
	REASONFORENTRY: string | null;
	[key: string]: unknown;
}

// Strip time/timezone from ASM date strings so format differences don't trigger false changes.
// ASM may return "2024-01-15T00:00:00", "2024-01-15T00:00:00.000Z", "2024/01/15", etc.
function normalizeDateStr(val: string | null | undefined): string | null {
	if (!val) return null;
	const m = val.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
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
	const locationName = (animal.DISPLAYLOCATIONNAME ?? '').toLowerCase();
	const isIncoming = locationName.includes('incoming');
	const isolationStatus: 'none' | 'iso' =
		locationName.includes('iso') ? 'iso' : 'none';
	const photoUrl =
		Array.isArray(animal.PHOTOURLS) && animal.PHOTOURLS.length > 0
			? animal.PHOTOURLS[0]
			: null;

	return {
		name: animal.ANIMALNAME ?? '',
		breed: animal.BREEDNAME ?? '',
		color: animal.BASECOLOURNAME ?? '',
		sex: normalizeSex(animal.SEXNAME),
		// outdoorKennelAssignment intentionally omitted — managed by app only
		markings: animal.MARKINGS ?? '',
		description: animal.ANIMALCOMMENTS ?? '',
		hiddenComments: animal.HIDDENANIMALDETAILS ?? '',
		entryReason: (animal.REASONFORENTRY ?? '').trim(),
		warningNotes: animal.POPUPWARNING ?? '',
		healthProblems: animal.HEALTHPROBLEMS ?? '',
		isMicrochipped: animal.IDENTICHIPPED === 1,
		microchipDate: normalizeDateStr(animal.IDENTICHIPDATE),
		isFixed: animal.NEUTERED === 1,
		fixedDate: normalizeDateStr(animal.NEUTEREDDATE),
		isVaccinated: (animal.VACCGIVENCOUNT ?? 0) > 0,
		vaccineCount: animal.VACCGIVENCOUNT ?? 0,
		vaccinesOutstanding: animal.VACCOUTSTANDINGCOUNT ?? 0,
		vaccinatedDate: normalizeDateStr(animal.VACCRABIESDATE),
		weightLbs: typeof animal.WEIGHT === 'number' && animal.WEIGHT > 0 ? animal.WEIGHT : null,
		dateOfBirth: normalizeDateStr(animal.DATEOFBIRTH),
		intakeDate: normalizeDateStr(animal.MOSTRECENTENTRYDATE || animal.DATEBROUGHTIN),
		originalIntakeDate: normalizeDateStr(animal.DATEBROUGHTIN),
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
		origin: (() => {
			if (animal.ISTRANSFER === 1) {
				const name = animal.BROUGHTINBYOWNERNAME || animal.ORIGINALOWNERNAME || 'Transfer';
				const state = animal.BROUGHTINBYOWNERCOUNTY;
				return state ? `${name}, ${state}` : name;
			}
			return animal.ENTRYTYPENAME || 'Unknown';
		})(),
		inFoster,
		inFosterSince: (inFoster || isPermanentFoster) ? normalizeDateStr(animal.ACTIVEMOVEMENTDATE) : null,
		isIncoming,
		isolationStatus,
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
		satinBalls: false,
		hasSupplements: false,
		hasSecondMeal: false,
		secondMealAmount: '',
		origin: '',
		outdoorKennelAssignment: '',
		insideKennelAssignment: '',
		hiddenComments: '',
		warningNotes: '',
		holdNotes: '',
		idealHome: '',
		lastBathDate: null,
		lastBathBy: null,
		lastDayTripDate: null,
		isOutOnDayTrip: false,
		currentDayTripStartedAt: null,
		awaitingEvaluation: true,
		surgeryDate: null,
		fortifloraDate: null,
		fortifloraDays: null,
		dayTripStatus: 'eligible',
		dayTripIneligibleReason: null,
		dayTripManagerOnlyReason: null,
		dayTripNotes: null,
		handlingLevel: 'volunteer',
		isolationUntilDate: null,
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
		// 503 = credentials not configured (local dev), 502 = ASM unreachable — skip silently
		if (res.status === 502 || res.status === 503) {
			return { changes: [] };
		}
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

	// Detect new arrivals by comparing current ASM dog IDs to what was seen on the last sync.
	// Add any newly seen dogs to changes as isNew:true so they get saved to localStorage
	// and the overlay keeps firing until the user explicitly closes it.
	const KNOWN_DOG_IDS_KEY = 'asm_known_dog_ids';
	const knownSet = new Set(readJson<string[]>(KNOWN_DOG_IDS_KEY, []));
	const newlyArrivedAnimals = dogs.filter(d => !knownSet.has(String(d.ID)));
	// Update known IDs now — overlay persistence handled by overlayAcked in STORAGE_KEY
	writeJson(KNOWN_DOG_IDS_KEY, dogs.map(d => String(d.ID)));

	// 4. Determine which dogs need writing (new or changed ASM fields)
	type PendingWrite = { animal: AsmAnimal; isNew: boolean; changedFields: string[] };
	const pending: PendingWrite[] = [];

	// Photos uploaded through the app (Firebase Storage URLs) always beat ASM's
	// photo, and ASM having no photo must never clear one the shelter uploaded.
	function applyPhotoPrecedence<T extends { photoUrl: string | null }>(
		fields: T,
		existing: Record<string, unknown> | undefined
	): T {
		const existingUrl = typeof existing?.photoUrl === 'string' ? existing.photoUrl : null;
		if (existingUrl && (existingUrl.includes('firebasestorage') || fields.photoUrl === null)) {
			fields.photoUrl = existingUrl;
		}
		return fields;
	}

	for (const animal of dogs) {
		const docId = String(animal.ID);
		const existing = existingDocs.get(docId);

		if (!existing) {
			pending.push({ animal, isNew: true, changedFields: [] });
		} else {
			// Compare ASM-sourced fields only (exclude _lastSyncedAt — it always changes)
			const { _lastSyncedAt: _ignored, ...comparable } = applyPhotoPrecedence(
				asmToStoredFields(animal, now),
				existing
			);
			const DATE_FIELDS = new Set(['dateOfBirth', 'intakeDate', 'originalIntakeDate', 'microchipDate', 'fixedDate', 'vaccinatedDate', 'inFosterSince']);
			const changedFields = (Object.entries(comparable) as [string, unknown][])
				.filter(([k, v]) => {
					const stored = existing[k];
					if (DATE_FIELDS.has(k)) {
						// Normalize both sides — existing may be in old full-timestamp format
						return normalizeDateStr(stored as string) !== normalizeDateStr(v as string);
					}
					return stored !== v;
				})
				.map(([k, v]) => {
					const label = FIELD_LABELS[k] ?? k;
					const formatted = formatSyncValue(k, v);
					return formatted !== null ? `${label} (${formatted})` : label;
				});
			if (changedFields.length > 0) pending.push({ animal, isNew: false, changedFields });
		}
	}

	// 5. Write only changed/new dogs in batches
	for (let i = 0; i < pending.length; i += BATCH_SIZE) {
		const batch = writeBatch(db);
		for (const { animal, isNew } of pending.slice(i, i + BATCH_SIZE)) {
			const docId = String(animal.ID);
			const ref = doc(db, 'dogs', docId);
			const asmFields = applyPhotoPrecedence(asmToStoredFields(animal, now), existingDocs.get(docId));
			// Puppies don't need evaluation — never flag them.
			const isPuppy = isPuppyAge(asmFields.dateOfBirth);
			if (isNew) {
				const defaults = defaultStoredFields(now);
				if (isPuppy) defaults.awaitingEvaluation = false;
				batch.set(ref, { id: docId, ...defaults, ...asmFields }, { merge: true });
			} else {
				const existing = existingDocs.get(docId);
				const returningFromFoster = existing?.inFoster === true && asmFields.inFoster === false;
				// Moving off Incoming also (re)starts the dog's shelter clock, so bath and
				// enrichment overdue windows count from when the dog hit the floor.
				const leavingIncoming = existing?.isIncoming === true && asmFields.isIncoming === false;
				const intakeMs = asmFields.intakeDate ? new Date(asmFields.intakeDate).getTime() : 0;
				const recentIntake = intakeMs > 0 && Date.now() - intakeMs < 7 * 86_400_000;
				const needsEvalFlag = existing?.awaitingEvaluation === undefined && recentIntake && !isPuppy;
				const extra = {
					...(returningFromFoster || leavingIncoming ? { shelterSince: now } : {}),
					...(needsEvalFlag ? { awaitingEvaluation: true } : {})
				};
				batch.set(ref, Object.keys(extra).length ? { ...asmFields, ...extra } : asmFields, { merge: true });
			}
		}
		await batch.commit();
	}

	// Backfill awaitingEvaluation for existing dogs with recent intake where the
	// field was never set — puppies excluded, they don't need evaluation. Also
	// clear the flag on any puppy that was flagged before the exemption existed.
	const evalBackfill: { id: string; flag: boolean }[] = [];
	for (const [docId, data] of existingDocs) {
		if (data.status === 'adopted') continue;
		const isPuppy = isPuppyAge(data.dateOfBirth as string | null | undefined);
		if (isPuppy) {
			if (data.awaitingEvaluation === true) evalBackfill.push({ id: docId, flag: false });
			continue;
		}
		if (data.awaitingEvaluation !== undefined) continue;
		const intakeMs = data.intakeDate ? new Date(data.intakeDate).getTime() : 0;
		if (intakeMs > 0 && Date.now() - intakeMs < 7 * 86_400_000) {
			evalBackfill.push({ id: docId, flag: true });
		}
	}
	for (let i = 0; i < evalBackfill.length; i += BATCH_SIZE) {
		const batch = writeBatch(db);
		for (const { id, flag } of evalBackfill.slice(i, i + BATCH_SIZE)) {
			batch.set(doc(db, 'dogs', id), { awaitingEvaluation: flag }, { merge: true });
		}
		await batch.commit();
	}

	const currentAsmIds = new Set(dogs.map((a) => a.ID));

	// Fetch recent adoptions/transfers directly from ASM — this is the authoritative source
	// since json_shelter_animals only returns currently active animals.
	const shelterCodeOutcomes = new Map<string, ArchiveOutcome>();
	const movementDateByShelterCode = new Map<string, string>();

	const KNOWN_ADOPTIONS_KEY = 'asm_known_adoption_ids';
	let newAdoptionIds: string[] = [];

	try {
		const recentRes = await fetch('/api/asm/recent-adoptions?days=14');
		if (recentRes.ok) {
			const recentAdoptions: { id: string; shelterCode: string; adoptedAt: string }[] = await recentRes.json();

			// Compare to previously known adoption IDs to find NEW ones
			const knownSet = new Set(readJson<string[]>(KNOWN_ADOPTIONS_KEY, []));
			newAdoptionIds = recentAdoptions.map(a => a.id).filter(id => !knownSet.has(id));

			// Update stored known IDs
			writeJson(KNOWN_ADOPTIONS_KEY, recentAdoptions.map(a => a.id));

			// Only build outcomes for NEW adoptions
			for (const a of recentAdoptions.filter(a => newAdoptionIds.includes(a.id))) {
				if (a.shelterCode) {
					shelterCodeOutcomes.set(a.shelterCode, 'adopted');
					if (a.adoptedAt) movementDateByShelterCode.set(a.shelterCode, a.adoptedAt);
				}
			}
		}
	} catch { /* ignore */ }

	// Deceased dogs still present in the ASM payload: archive as euthanized, with
	// the deceased date as the movement date. This must win over the adoptions
	// feed so a passed dog is never mislabeled "adopted".
	for (const a of allAnimals) {
		if (!a.DECEASEDDATE) continue;
		if ((a.SPECIESNAME ?? '').toLowerCase() !== 'dog') continue;
		if (!a.SHELTERCODE) continue;
		shelterCodeOutcomes.set(a.SHELTERCODE, 'euthanized');
		const deceased = normalizeDateStr(a.DECEASEDDATE);
		if (deceased) movementDateByShelterCode.set(a.SHELTERCODE, deceased);
	}

	const archived = await markStaleAsmDogsArchived(currentAsmIds, shelterCodeOutcomes, movementDateByShelterCode);

	const archivedChanges: SyncChange[] = archived.map(({ id, name, outcome }) => ({
		id,
		name,
		isNew: false,
		isArchived: outcome === 'adopted',
		isTransferredOut: outcome === 'transferred',
		isEuthanized: outcome === 'euthanized',
		fields: []
	}));

	const pendingChanges = pending.map(({ animal, isNew, changedFields }) => ({
		id: String(animal.ID),
		name: animal.ANIMALNAME ?? `Dog ${animal.ID}`,
		isNew,
		isArchived: false,
		isTransferredOut: false,
		isEuthanized: false,
		fields: changedFields
	}));

	const newArrivalChanges: SyncChange[] = newlyArrivedAnimals.map(a => ({
		id: String(a.ID),
		name: a.ANIMALNAME ?? `Dog ${a.ID}`,
		isNew: true,
		isArchived: false,
		isTransferredOut: false,
		isEuthanized: false,
		fields: []
	}));

	// Dedupe by dog id: a brand-new dog is flagged by both `pendingChanges` (new Firestore
	// doc) and `newArrivalChanges` (not in the known-ids list), which would list it twice.
	// Keep the first (richer) entry per id.
	const seen = new Set<string>();
	const changes: SyncChange[] = [];
	for (const change of [...pendingChanges, ...archivedChanges, ...newArrivalChanges]) {
		if (seen.has(change.id)) continue;
		seen.add(change.id);
		changes.push(change);
	}
	return { changes };
}

/**
 * Marks ASM-synced dogs as archived ('adopted') if they no longer appear in the latest
 * ASM response. Only affects docs that have an `asmId` field (i.e. were synced from ASM).
 * Safe to call after syncAnimalsFromASM().
 */
export async function markStaleAsmDogsArchived(
	currentAsmIds: Set<number>,
	shelterCodeOutcomes: Map<string, ArchiveOutcome> = new Map(),
	movementDateByShelterCode: Map<string, string> = new Map()
): Promise<{ id: string; name: string; outcome: ArchiveOutcome }[]> {
	if (!db) throw new Error('Firestore not available');

	const snapshot = await getDocs(collection(db, 'dogs'));
	const staleDocs = snapshot.docs.filter((d) => {
		const data = d.data();
		if (data.status === 'adopted' || data.status === 'transferred' || data.status === 'euthanized') return false;
		const asmId = data.asmId as number | undefined;
		const idAsNum = /^\d+$/.test(d.id) ? Number(d.id) : undefined;
		const effectiveAsmId = asmId ?? idAsNum;
		const shelterCode = data.asmShelterCode as string | undefined;
		const missedByAsmId = effectiveAsmId !== undefined && !currentAsmIds.has(effectiveAsmId);
		const caughtByShelterCode = Boolean(shelterCode && shelterCodeOutcomes.has(shelterCode));
		return missedByAsmId || caughtByShelterCode;
	});

	if (staleDocs.length === 0) return [];

	const BATCH_SIZE = 499;
	const now = new Date().toISOString();
	for (let i = 0; i < staleDocs.length; i += BATCH_SIZE) {
		const batch = writeBatch(db);
		for (const staleDoc of staleDocs.slice(i, i + BATCH_SIZE)) {
			const staleData = staleDoc.data();
			const shelterCode = staleData.asmShelterCode as string | undefined;
			const outcome: ArchiveOutcome = (shelterCode && shelterCodeOutcomes.get(shelterCode)) || 'adopted';
			// Fall back to the archive time so leftShelterDate is always set — the
			// movements summary counts departures strictly by this field.
			const movementDate = (shelterCode ? movementDateByShelterCode.get(shelterCode) : null) ?? now;
			batch.set(staleDoc.ref, {
				status: outcome,
				outdoorKennelAssignment: '',
				insideKennelAssignment: '',
				inFoster: false,
				permanentFoster: false,
				shelterSince: null,
				isOutOnDayTrip: false,
				currentDayTripStartedAt: null,
				leftShelterDate: movementDate,
				updatedAt: now,
				_lastSyncedAt: now
			}, { merge: true });
		}
		await batch.commit();
	}

	return staleDocs.map((d) => {
		const shelterCode = d.data().asmShelterCode as string | undefined;
		const outcome: ArchiveOutcome = (shelterCode && shelterCodeOutcomes.get(shelterCode)) || 'adopted';
		return { id: d.id, name: (d.data().name as string | undefined) ?? d.id, outcome };
	});
}
