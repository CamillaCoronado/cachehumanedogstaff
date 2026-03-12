import type {
	BehavioralNote,
	DogHandlingLevel,
	DayTripIneligibleReason,
	DayTripLog,
	Dog,
	FeedingLog,
	StoolLog,
	UserProfile
} from '$lib/types';
import { readJson, writeJson, createId } from '$lib/utils/storage';
import { toDate, toDateString } from '$lib/utils/dates';
import { db } from '$lib/firebase/config';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

const DOGS_KEY = 'shelter.dogs';
const NOTES_KEY = 'shelter.behavioralNotes';
const FEEDING_KEY = 'shelter.feedingLogs';
const STOOL_KEY = 'shelter.stoolLogs';
const DAY_TRIP_KEY = 'shelter.dayTripLogs';

interface StoredDog {
	id: string;
	name: string;
	breed?: string;
	sex?: 'male' | 'female' | 'unknown';
	intakeDate: string;
	originalIntakeDate?: string;
	reentryDates?: string[];
	leftShelterDate?: string | null;
	dateOfBirth: string;
	weightLbs?: number | null;
	foodType: string;
	foodAmount: string;
	dietaryNotes: string;
	photoUrl?: string | null;
	hasOwnFood?: boolean;
	transitionToHills?: boolean | null;
	origin?: string;
	markings?: string;
	hiddenComments?: string;
	description?: string;
	warningNotes?: string;
	holdNotes?: string;
	pottyTrained?: 'yes' | 'no' | 'working_on_it' | 'unknown';
	goodWithDogs?: 'yes' | 'no' | 'unknown';
	goodWithCats?: 'yes' | 'no' | 'unknown';
	goodWithKids?: 'yes' | 'no' | 'unknown';
	goodWithElderly?: 'yes' | 'no' | 'unknown';
	goodOnLead?: 'yes' | 'no' | 'unknown';
	goodTraveller?: 'yes' | 'no' | 'unknown';
	crateTrained?: 'yes' | 'no' | 'unknown';
	idealHome?: string;
	energyLevel?: 'low' | 'medium' | 'high' | 'very_high' | 'unknown';
	outdoorKennelAssignment: string;
	microchipDate?: string | null;
	healthProblems?: string;
	lastBathDate: string | null;
	lastBathBy: string | null;
	lastDayTripDate: string | null;
	// day trip in-progress state
	isOutOnDayTrip: boolean;
	currentDayTripStartedAt: string | null;
	surgeryDate: string | null;
	isMicrochipped?: boolean;
	isFixed: boolean;
	fixedDate: string | null;
	isVaccinated: boolean;
	vaccinatedDate: string | null;
	dayTripStatus: 'ineligible' | 'difficult' | 'eligible';
	dayTripIneligibleReason?: DayTripIneligibleReason | null;
	dayTripManagerOnly?: boolean;
	dayTripManagerOnlyReason?: DayTripIneligibleReason | null;
	dayTripNotes: string | null;
	handlingLevel?: DogHandlingLevel;
	inFoster: boolean;
	isolationStatus: 'none' | 'sick' | 'bite_quarantine';
	isolationStartDate: string | null;
	status: 'active' | 'adopted';
	createdAt: string;
	updatedAt: string;
}

interface StoredNote {
	id: string;
	note: string;
	createdAt: string;
	loggedBy: string;
	loggedByName: string;
}

interface StoredFeedingLog {
	id: string;
	date: string;
	mealTime: 'am' | 'pm';
	amountEaten: 'all' | 'most' | 'half' | 'little' | 'none';
	notes: string | null;
	loggedBy: string;
	loggedByName: string;
	createdAt: string;
}

interface StoredStoolLog {
	id: string;
	timestamp: string;
	stoolType: number;
	notes: string | null;
	loggedBy: string;
	loggedByName: string;
}

interface StoredDayTripLog {
	id: string;
	dogId: string;
	startedAt: string;
	endedAt: string | null;
	startedBy: string;
	startedByName: string;
	endedBy: string | null;
	endedByName: string | null;
	startNotes: string | null;
	endNotes: string | null;
	createdAt: string;
	updatedAt: string;
}

interface NoteMap {
	[dogId: string]: StoredNote[];
}

interface LogMap<T> {
	[dogId: string]: T[];
}

function normalizeKennelAssignment(value: string | null | undefined) {
	return value?.trim() ?? '';
}

// Returns all name variants for a dog: "Buddy (Max)" → ["buddy", "max"]
function dogNameVariants(name: string): string[] {
	const lower = name.trim().toLowerCase();
	const match = lower.match(/^(.+?)\s*\((.+)\)$/);
	if (match) return [match[1].trim(), match[2].trim()];
	return [lower];
}

// When ASM and manually-entered dogs represent the same animal, keep the ASM copy.
function deduplicateAgainstAsm(dogs: Dog[]): Dog[] {
	const asmDogs = dogs.filter((d) => d.origin === 'ASM');
	const nonAsmDogs = dogs.filter((d) => d.origin !== 'ASM');

	// Build a set of every name variant that exists in ASM dogs
	const asmNames = new Set<string>();
	for (const dog of asmDogs) {
		for (const v of dogNameVariants(dog.name)) asmNames.add(v);
	}

	// Drop non-ASM dogs whose name (or parenthetical alias) already exists in ASM
	const kept = nonAsmDogs.filter(
		(dog) => !dogNameVariants(dog.name).some((v) => asmNames.has(v))
	);

	return [...asmDogs, ...kept];
}

function applyFosterHousingRules(dog: Dog): Dog {
	if (!dog.inFoster) {
		const trimmed = normalizeKennelAssignment(dog.outdoorKennelAssignment);
		if (trimmed === dog.outdoorKennelAssignment) return dog;
		return { ...dog, outdoorKennelAssignment: trimmed };
	}
	if (!dog.outdoorKennelAssignment) return dog;
	return { ...dog, outdoorKennelAssignment: '' };
}

function normalizeDayTripIneligibleReason(value: unknown): DayTripIneligibleReason | null {
	return value === 'behavior' || value === 'medical' || value === 'other' ? value : null;
}

function normalizeDogHandlingLevel(value: unknown): DogHandlingLevel {
	if (value === 'manager_only' || value === 'staff_only' || value === 'volunteer') return value;
	return 'volunteer';
}

function serializeDog(dog: Dog): StoredDog {
	const serializedIntakeDate = toDateString(dog.intakeDate) ?? new Date().toISOString();
	const serializedOriginalEntry = toDateString(dog.originalIntakeDate) ?? serializedIntakeDate;
	const serializedReentries = serializeDateArray(dog.reentryDates);

	return {
		id: dog.id,
		name: dog.name,
		breed: dog.breed,
		sex: dog.sex ?? 'unknown',
		intakeDate: serializedIntakeDate,
		originalIntakeDate: serializedOriginalEntry,
		reentryDates: serializedReentries,
		leftShelterDate: toDateString(dog.leftShelterDate),
		dateOfBirth: toDateString(dog.dateOfBirth) ?? new Date().toISOString(),
		weightLbs: typeof dog.weightLbs === 'number' && Number.isFinite(dog.weightLbs) ? dog.weightLbs : null,
		foodType: dog.foodType,
		foodAmount: dog.foodAmount,
		dietaryNotes: dog.dietaryNotes,
		photoUrl: dog.photoUrl ?? null,
		hasOwnFood: dog.hasOwnFood ?? false,
		transitionToHills: dog.transitionToHills ?? null,
		origin: dog.origin,
		markings: dog.markings ?? '',
		hiddenComments: dog.hiddenComments ?? '',
		description: dog.description ?? '',
		warningNotes: dog.warningNotes ?? '',
		holdNotes: dog.holdNotes ?? '',
		pottyTrained: dog.pottyTrained,
		goodWithDogs: dog.goodWithDogs,
		goodWithCats: dog.goodWithCats,
		goodWithKids: dog.goodWithKids,
		goodWithElderly: dog.goodWithElderly ?? 'unknown',
		goodOnLead: dog.goodOnLead ?? 'unknown',
		goodTraveller: dog.goodTraveller ?? 'unknown',
		crateTrained: dog.crateTrained ?? 'unknown',
		idealHome: dog.idealHome,
		energyLevel: dog.energyLevel,
		outdoorKennelAssignment: normalizeKennelAssignment(dog.inFoster ? '' : dog.outdoorKennelAssignment),
		microchipDate: toDateString(dog.microchipDate),
		healthProblems: dog.healthProblems ?? '',
		lastBathDate: toDateString(dog.lastBathDate),
		lastBathBy: dog.lastBathBy,
		lastDayTripDate: toDateString(dog.lastDayTripDate),
		isOutOnDayTrip: dog.isOutOnDayTrip ?? false,
		currentDayTripStartedAt: toDateString(dog.currentDayTripStartedAt),
		surgeryDate: toDateString(dog.surgeryDate),
		isMicrochipped: dog.isMicrochipped ?? false,
		isFixed: dog.isFixed,
		fixedDate: toDateString(dog.fixedDate),
		isVaccinated: dog.isVaccinated,
		vaccinatedDate: toDateString(dog.vaccinatedDate),
		dayTripStatus: dog.dayTripStatus,
		dayTripIneligibleReason: dog.dayTripIneligibleReason ?? null,
		dayTripManagerOnly: dog.dayTripManagerOnly ?? false,
		dayTripManagerOnlyReason: dog.dayTripManagerOnly ? (dog.dayTripManagerOnlyReason ?? 'other') : null,
		dayTripNotes: dog.dayTripNotes,
		handlingLevel: dog.handlingLevel ?? 'volunteer',
		inFoster: dog.inFoster ?? false,
		isolationStatus: dog.isolationStatus,
		isolationStartDate: toDateString(dog.isolationStartDate),
		status: dog.status,
		createdAt: toDateString(dog.createdAt) ?? new Date().toISOString(),
		updatedAt: toDateString(dog.updatedAt) ?? new Date().toISOString()
	};
}

function deserializeDog(stored: StoredDog): Dog {
	const intakeDate = toDate(stored.intakeDate) ?? new Date();
	const originalIntakeDate = toDate(stored.originalIntakeDate) ?? intakeDate;
	const reentryDates = deserializeDateArray(stored.reentryDates);
	const normalizedDayTripNotes = (stored.dayTripNotes ?? '').trim();
	const normalizedDayTripIneligibleReason = normalizeDayTripIneligibleReason(stored.dayTripIneligibleReason);
	const normalizedDayTripManagerOnlyReason = normalizeDayTripIneligibleReason(stored.dayTripManagerOnlyReason);
	const normalizedHandlingLevel = normalizeDogHandlingLevel(stored.handlingLevel);
	const dayTripManagerOnly = stored.dayTripManagerOnly ?? false;
	const normalizedDayTripStatus =
		(stored.dayTripStatus ?? 'eligible') === 'ineligible' &&
			normalizedDayTripNotes.length === 0 &&
			normalizedDayTripIneligibleReason === null
			? 'eligible'
			: (stored.dayTripStatus ?? 'eligible');
	const dayTripIneligibleReason =
		normalizedDayTripStatus === 'ineligible' && (stored.isolationStatus ?? 'none') === 'none'
			? normalizedDayTripIneligibleReason
			: null;
	const dayTripManagerOnlyReason =
		dayTripManagerOnly ? (normalizedDayTripManagerOnlyReason ?? 'other') : null;

	const dog: Dog = {
		id: stored.id,
		name: stored.name,
		breed: stored.breed ?? '',
		sex: stored.sex ?? 'unknown',
		intakeDate,
		originalIntakeDate,
		reentryDates,
		leftShelterDate: stored.leftShelterDate ? toDate(stored.leftShelterDate) : null,
		dateOfBirth: toDate(stored.dateOfBirth) ?? new Date(),
		weightLbs:
			typeof stored.weightLbs === 'number' && Number.isFinite(stored.weightLbs)
				? stored.weightLbs
				: null,
		foodType: stored.foodType,
		foodAmount: stored.foodAmount,
		dietaryNotes: stored.dietaryNotes,
		photoUrl: typeof stored.photoUrl === 'string' ? stored.photoUrl : null,
		hasOwnFood: stored.hasOwnFood ?? false,
		transitionToHills: typeof stored.transitionToHills === 'boolean' ? stored.transitionToHills : null,
		origin: stored.origin ?? '',
		markings: stored.markings ?? '',
		hiddenComments: stored.hiddenComments ?? '',
		description: stored.description ?? '',
		warningNotes: stored.warningNotes ?? '',
		holdNotes: stored.holdNotes ?? '',
		pottyTrained: stored.pottyTrained ?? 'unknown',
		goodWithDogs: stored.goodWithDogs ?? 'unknown',
		goodWithCats: stored.goodWithCats ?? 'unknown',
		goodWithKids: stored.goodWithKids ?? 'unknown',
		goodWithElderly: stored.goodWithElderly ?? 'unknown',
		goodOnLead: stored.goodOnLead ?? 'unknown',
		goodTraveller: stored.goodTraveller ?? 'unknown',
		crateTrained: stored.crateTrained ?? 'unknown',
		idealHome: stored.idealHome ?? '',
		energyLevel: stored.energyLevel ?? 'unknown',
		outdoorKennelAssignment: stored.outdoorKennelAssignment,
		microchipDate: stored.microchipDate ? toDate(stored.microchipDate) : null,
		healthProblems: stored.healthProblems ?? '',
		lastBathDate: stored.lastBathDate ? toDate(stored.lastBathDate) : null,
		lastBathBy: stored.lastBathBy ?? null,
		lastDayTripDate: stored.lastDayTripDate ? toDate(stored.lastDayTripDate) : null,
		isOutOnDayTrip: stored.isOutOnDayTrip ?? false,
		currentDayTripStartedAt: stored.currentDayTripStartedAt ? toDate(stored.currentDayTripStartedAt) : null,
		surgeryDate: stored.surgeryDate ? toDate(stored.surgeryDate) : null,
		isMicrochipped: stored.isMicrochipped ?? false,
		isFixed: stored.isFixed ?? false,
		fixedDate: stored.fixedDate ? toDate(stored.fixedDate) : null,
		isVaccinated: stored.isVaccinated ?? false,
		vaccinatedDate: stored.vaccinatedDate ? toDate(stored.vaccinatedDate) : null,
		dayTripStatus: normalizedDayTripStatus,
		dayTripIneligibleReason,
		dayTripManagerOnly,
		dayTripManagerOnlyReason,
		dayTripNotes: normalizedDayTripNotes.length > 0 ? normalizedDayTripNotes : null,
		handlingLevel: normalizedHandlingLevel,
		inFoster: stored.inFoster ?? false,
		isolationStatus: stored.isolationStatus ?? 'none',
		isolationStartDate: stored.isolationStartDate ? toDate(stored.isolationStartDate) : null,
		status: stored.status,
		createdAt: toDate(stored.createdAt) ?? new Date(),
		updatedAt: toDate(stored.updatedAt) ?? new Date()
	};
	return applyFosterHousingRules(dog);
}

function serializeDateArray(values: Dog['reentryDates'] | undefined): string[] {
	if (!Array.isArray(values)) return [];
	return values
		.map((value) => toDateString(value))
		.filter((value): value is string => Boolean(value));
}

function deserializeDateArray(values: string[] | undefined): Date[] {
	if (!Array.isArray(values)) return [];
	return values
		.map((value) => toDate(value))
		.filter((value): value is Date => Boolean(value));
}

function serializeNote(note: BehavioralNote): StoredNote {
	return {
		id: note.id,
		note: note.note,
		createdAt: toDateString(note.createdAt) ?? new Date().toISOString(),
		loggedBy: note.loggedBy,
		loggedByName: note.loggedByName
	};
}

function deserializeNote(note: StoredNote): BehavioralNote {
	return {
		id: note.id,
		note: note.note,
		createdAt: toDate(note.createdAt) ?? new Date(),
		loggedBy: note.loggedBy,
		loggedByName: note.loggedByName
	};
}

function serializeFeedingLog(log: FeedingLog): StoredFeedingLog {
	return {
		id: log.id,
		date: toDateString(log.date) ?? new Date().toISOString(),
		mealTime: log.mealTime,
		amountEaten: log.amountEaten,
		notes: log.notes,
		loggedBy: log.loggedBy,
		loggedByName: log.loggedByName,
		createdAt: toDateString(log.createdAt) ?? new Date().toISOString()
	};
}

function deserializeFeedingLog(log: StoredFeedingLog): FeedingLog {
	return {
		id: log.id,
		date: toDate(log.date) ?? new Date(),
		mealTime: log.mealTime,
		amountEaten: log.amountEaten,
		notes: log.notes,
		loggedBy: log.loggedBy,
		loggedByName: log.loggedByName,
		createdAt: toDate(log.createdAt) ?? new Date()
	};
}

function serializeStoolLog(log: StoolLog): StoredStoolLog {
	return {
		id: log.id,
		timestamp: toDateString(log.timestamp) ?? new Date().toISOString(),
		stoolType: log.stoolType,
		notes: log.notes,
		loggedBy: log.loggedBy,
		loggedByName: log.loggedByName
	};
}

function deserializeStoolLog(log: StoredStoolLog): StoolLog {
	return {
		id: log.id,
		timestamp: toDate(log.timestamp) ?? new Date(),
		stoolType: log.stoolType,
		notes: log.notes,
		loggedBy: log.loggedBy,
		loggedByName: log.loggedByName
	};
}

function serializeDayTripLog(log: DayTripLog): StoredDayTripLog {
	return {
		id: log.id,
		dogId: log.dogId,
		startedAt: toDateString(log.startedAt) ?? new Date().toISOString(),
		endedAt: toDateString(log.endedAt),
		startedBy: log.startedBy,
		startedByName: log.startedByName,
		endedBy: log.endedBy,
		endedByName: log.endedByName,
		startNotes: log.startNotes,
		endNotes: log.endNotes,
		createdAt: toDateString(log.createdAt) ?? new Date().toISOString(),
		updatedAt: toDateString(log.updatedAt) ?? new Date().toISOString()
	};
}

function deserializeDayTripLog(log: StoredDayTripLog): DayTripLog {
	return {
		id: log.id,
		dogId: log.dogId,
		startedAt: toDate(log.startedAt) ?? new Date(),
		endedAt: log.endedAt ? toDate(log.endedAt) : null,
		startedBy: log.startedBy,
		startedByName: log.startedByName,
		endedBy: log.endedBy ?? null,
		endedByName: log.endedByName ?? null,
		startNotes: log.startNotes ?? null,
		endNotes: log.endNotes ?? null,
		createdAt: toDate(log.createdAt) ?? new Date(),
		updatedAt: toDate(log.updatedAt) ?? new Date()
	};
}

function getUserIdentity(profile?: UserProfile | null) {
	return {
		uid: profile?.uid ?? 'local-user',
		name: profile?.displayName ?? profile?.email ?? 'Local User'
	};
}

function readDayTripMap() {
	return readJson<LogMap<StoredDayTripLog>>(DAY_TRIP_KEY, {});
}

function writeDayTripMap(map: LogMap<StoredDayTripLog>) {
	writeJson(DAY_TRIP_KEY, map);
}

function toMillis(value: unknown) {
	return toDate(value as Parameters<typeof toDate>[0])?.getTime() ?? 0;
}

function sortByDateDesc<T>(items: T[], getValue: (item: T) => unknown) {
	return [...items].sort((a, b) => toMillis(getValue(b)) - toMillis(getValue(a)));
}

function dogsCollectionRef() {
	if (!db) return null;
	return collection(db, 'dogs');
}

function dogRef(dogId: string) {
	if (!db) return null;
	return doc(db, 'dogs', dogId);
}

function dogSubcollectionRef(
	dogId: string,
	subcollection: 'behavioralNotes' | 'feedingLogs' | 'stoolLogs' | 'dayTripLogs'
) {
	if (!db) return null;
	return collection(db, 'dogs', dogId, subcollection);
}

async function deleteDogSubcollection(
	dogId: string,
	subcollection: 'behavioralNotes' | 'feedingLogs' | 'stoolLogs' | 'dayTripLogs'
) {
	const ref = dogSubcollectionRef(dogId, subcollection);
	if (!ref) return;
	const snapshot = await getDocs(ref);
	await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
}

export async function listDogs() {
	const ref = dogsCollectionRef();
	if (ref) {
		const snapshot = await getDocs(ref);
		const dogs = snapshot.docs.map((docSnap) =>
			deserializeDog({ id: docSnap.id, ...(docSnap.data() as StoredDog) })
		);
		return deduplicateAgainstAsm(dogs);
	}

	const stored = readJson<StoredDog[]>(DOGS_KEY, []);
	return deduplicateAgainstAsm(stored.map(deserializeDog));
}

export async function getDog(id: string) {
	const ref = dogRef(id);
	if (ref) {
		const snapshot = await getDoc(ref);
		if (!snapshot.exists()) return null;
		return deserializeDog({ id: snapshot.id, ...(snapshot.data() as StoredDog) });
	}

	const stored = readJson<StoredDog[]>(DOGS_KEY, []);
	const match = stored.find((dog) => dog.id === id);
	return match ? deserializeDog(match) : null;
}

export async function createDog(data: Omit<Dog, 'id' | 'createdAt' | 'updatedAt'>) {
	const ref = dogsCollectionRef();
	if (ref) {
		const now = new Date();
		const dog: Dog = applyFosterHousingRules({
			...data,
			id: createId('dog'),
			createdAt: now,
			updatedAt: now
		});
		await setDoc(doc(ref, dog.id), serializeDog(dog));
		return dog;
	}

	const stored = readJson<StoredDog[]>(DOGS_KEY, []);
	const now = new Date();
	const dog: Dog = applyFosterHousingRules({
		...data,
		id: createId('dog'),
		createdAt: now,
		updatedAt: now
	});
	stored.push(serializeDog(dog));
	writeJson(DOGS_KEY, stored);
	return dog;
}

export async function updateDog(id: string, updates: Partial<Dog>) {
	const ref = dogRef(id);
	if (ref) {
		const current = await getDog(id);
		if (!current) return null;
		const merged: Dog = applyFosterHousingRules({
			...current,
			...updates,
			updatedAt: new Date()
		});
		await setDoc(ref, serializeDog(merged));
		return merged;
	}

	const stored = readJson<StoredDog[]>(DOGS_KEY, []);
	const now = new Date();
	const next = stored.map((dog) => {
		if (dog.id !== id) return dog;
		const merged: Dog = applyFosterHousingRules({
			...deserializeDog(dog),
			...updates,
			updatedAt: now
		});
		return serializeDog(merged);
	});
	writeJson(DOGS_KEY, next);
	return getDog(id);
}

export async function archiveDog(id: string) {
	return updateDog(id, { status: 'adopted' });
}

export async function returnDog(id: string) {
	return updateDog(id, { status: 'active' });
}

export async function deleteDog(id: string) {
	const ref = dogRef(id);
	if (ref) {
		await deleteDogSubcollection(id, 'behavioralNotes');
		await deleteDogSubcollection(id, 'feedingLogs');
		await deleteDogSubcollection(id, 'stoolLogs');
		await deleteDogSubcollection(id, 'dayTripLogs');
		await deleteDoc(ref);
		return;
	}

	const stored = readJson<StoredDog[]>(DOGS_KEY, []);
	const next = stored.filter((dog) => dog.id !== id);
	writeJson(DOGS_KEY, next);

	const notes = readJson<NoteMap>(NOTES_KEY, {});
	delete notes[id];
	writeJson(NOTES_KEY, notes);

	const feeding = readJson<LogMap<StoredFeedingLog>>(FEEDING_KEY, {});
	delete feeding[id];
	writeJson(FEEDING_KEY, feeding);

	const stools = readJson<LogMap<StoredStoolLog>>(STOOL_KEY, {});
	delete stools[id];
	writeJson(STOOL_KEY, stools);

	const dayTrips = readDayTripMap();
	delete dayTrips[id];
	writeDayTripMap(dayTrips);
}

export async function listBehavioralNotes(dogId: string) {
	const ref = dogSubcollectionRef(dogId, 'behavioralNotes');
	if (ref) {
		const snapshot = await getDocs(ref);
		const notes = snapshot.docs.map((docSnap) =>
			deserializeNote({ id: docSnap.id, ...(docSnap.data() as StoredNote) })
		);
		return sortByDateDesc(notes, (note) => note.createdAt);
	}

	const stored = readJson<NoteMap>(NOTES_KEY, {});
	const notes = stored[dogId] ?? [];
	return notes.map(deserializeNote);
}

export async function addBehavioralNote(dogId: string, note: string, profile?: UserProfile | null) {
	const ref = dogSubcollectionRef(dogId, 'behavioralNotes');
	if (ref) {
		const identity = getUserIdentity(profile);
		const entry: BehavioralNote = {
			id: createId('note'),
			note,
			createdAt: new Date(),
			loggedBy: identity.uid,
			loggedByName: identity.name
		};
		await setDoc(doc(ref, entry.id), serializeNote(entry));
		return entry;
	}

	const stored = readJson<NoteMap>(NOTES_KEY, {});
	const list = stored[dogId] ?? [];
	const identity = getUserIdentity(profile);
	const entry: BehavioralNote = {
		id: createId('note'),
		note,
		createdAt: new Date(),
		loggedBy: identity.uid,
		loggedByName: identity.name
	};
	list.unshift(serializeNote(entry));
	stored[dogId] = list;
	writeJson(NOTES_KEY, stored);
	return entry;
}

export async function listAllFeedingLogsForToday(today = new Date()): Promise<Record<string, FeedingLog[]>> {
	const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const dayEnd = new Date(dayStart.getTime() + 86_400_000);

	if (db) {
		const snapshot = await getDocs(
			query(
				collectionGroup(db, 'feedingLogs'),
				where('date', '>=', dayStart.toISOString()),
				where('date', '<', dayEnd.toISOString())
			)
		);
		const byDog: Record<string, FeedingLog[]> = {};
		for (const docSnap of snapshot.docs) {
			const dogId = docSnap.ref.parent.parent?.id;
			if (!dogId) continue;
			const log = deserializeFeedingLog({ id: docSnap.id, ...(docSnap.data() as StoredFeedingLog) });
			(byDog[dogId] ??= []).push(log);
		}
		return byDog;
	}

	// localStorage fallback
	const stored = readJson<LogMap<StoredFeedingLog>>(FEEDING_KEY, {});
	const byDog: Record<string, FeedingLog[]> = {};
	for (const [dogId, logs] of Object.entries(stored)) {
		const dayLogs = logs
			.map(deserializeFeedingLog)
			.filter((log) => {
				const t = toDate(log.date)?.getTime() ?? 0;
				return t >= dayStart.getTime() && t < dayEnd.getTime();
			});
		if (dayLogs.length > 0) byDog[dogId] = dayLogs;
	}
	return byDog;
}

export async function listFeedingLogs(dogId: string) {
	const ref = dogSubcollectionRef(dogId, 'feedingLogs');
	if (ref) {
		const snapshot = await getDocs(ref);
		const logs = snapshot.docs.map((docSnap) =>
			deserializeFeedingLog({ id: docSnap.id, ...(docSnap.data() as StoredFeedingLog) })
		);
		return sortByDateDesc(logs, (log) => log.date);
	}

	const stored = readJson<LogMap<StoredFeedingLog>>(FEEDING_KEY, {});
	const logs = stored[dogId] ?? [];
	return logs.map(deserializeFeedingLog);
}

export async function listStoolLogs(dogId: string) {
	const ref = dogSubcollectionRef(dogId, 'stoolLogs');
	if (ref) {
		const snapshot = await getDocs(ref);
		const logs = snapshot.docs.map((docSnap) =>
			deserializeStoolLog({ id: docSnap.id, ...(docSnap.data() as StoredStoolLog) })
		);
		return sortByDateDesc(logs, (log) => log.timestamp);
	}

	const stored = readJson<LogMap<StoredStoolLog>>(STOOL_KEY, {});
	const logs = stored[dogId] ?? [];
	return logs.map(deserializeStoolLog);
}

export async function listDayTripLogs(dogId: string) {
	const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
	if (ref) {
		const snapshot = await getDocs(ref);
		const logs = snapshot.docs.map((docSnap) =>
			deserializeDayTripLog({ id: docSnap.id, ...(docSnap.data() as StoredDayTripLog) })
		);
		return sortByDateDesc(logs, (log) => log.startedAt);
	}

	const stored = readDayTripMap();
	const logs = stored[dogId] ?? [];
	return logs.map(deserializeDayTripLog);
}

export async function listAllDayTripLogs() {
	if (db) {
		const snapshot = await getDocs(collectionGroup(db, 'dayTripLogs'));
		const logs = snapshot.docs.map((docSnap) =>
			deserializeDayTripLog({ id: docSnap.id, ...(docSnap.data() as StoredDayTripLog) })
		);
		return sortByDateDesc(logs, (log) => log.startedAt);
	}

	const stored = readDayTripMap();
	return Object.values(stored).flat().map(deserializeDayTripLog);
}

export async function addFeedingLog(
	dogId: string,
	log: Omit<FeedingLog, 'id' | 'createdAt' | 'loggedBy' | 'loggedByName'>,
	profile?: UserProfile | null
) {
	const ref = dogSubcollectionRef(dogId, 'feedingLogs');
	if (ref) {
		const identity = getUserIdentity(profile);
		const entry: FeedingLog = {
			...log,
			id: createId('feed'),
			createdAt: new Date(),
			loggedBy: identity.uid,
			loggedByName: identity.name
		};
		await setDoc(doc(ref, entry.id), serializeFeedingLog(entry));
		return entry;
	}

	const stored = readJson<LogMap<StoredFeedingLog>>(FEEDING_KEY, {});
	const list = stored[dogId] ?? [];
	const identity = getUserIdentity(profile);
	const entry: FeedingLog = {
		...log,
		id: createId('feed'),
		createdAt: new Date(),
		loggedBy: identity.uid,
		loggedByName: identity.name
	};
	list.unshift(serializeFeedingLog(entry));
	stored[dogId] = list;
	writeJson(FEEDING_KEY, stored);
	return entry;
}

export async function addStoolLog(dogId: string, log: Omit<StoolLog, 'id' | 'loggedBy' | 'loggedByName'>, profile?: UserProfile | null) {
	const ref = dogSubcollectionRef(dogId, 'stoolLogs');
	if (ref) {
		const identity = getUserIdentity(profile);
		const entry: StoolLog = {
			...log,
			id: createId('stool'),
			loggedBy: identity.uid,
			loggedByName: identity.name
		};
		await setDoc(doc(ref, entry.id), serializeStoolLog(entry));
		return entry;
	}

	const stored = readJson<LogMap<StoredStoolLog>>(STOOL_KEY, {});
	const list = stored[dogId] ?? [];
	const identity = getUserIdentity(profile);
	const entry: StoolLog = {
		...log,
		id: createId('stool'),
		loggedBy: identity.uid,
		loggedByName: identity.name
	};
	list.unshift(serializeStoolLog(entry));
	stored[dogId] = list;
	writeJson(STOOL_KEY, stored);
	return entry;
}

export async function logBath(dogId: string, profile?: UserProfile | null) {
	const identity = getUserIdentity(profile);
	return updateDog(dogId, { lastBathDate: new Date(), lastBathBy: identity.name });
}

export async function logDayTrip(dogId: string, profile?: UserProfile | null, notes?: string | null) {
	const identity = getUserIdentity(profile);
	const now = new Date();
	const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
	if (ref) {
		const entry: DayTripLog = {
			id: createId('trip'),
			dogId,
			startedAt: now,
			endedAt: now,
			startedBy: identity.uid,
			startedByName: identity.name,
			endedBy: identity.uid,
			endedByName: identity.name,
			startNotes: notes ?? null,
			endNotes: null,
			createdAt: now,
			updatedAt: now
		};
		await setDoc(doc(ref, entry.id), serializeDayTripLog(entry));
		return updateDog(dogId, {
			lastDayTripDate: now,
			isOutOnDayTrip: false,
			currentDayTripStartedAt: null
		});
	}

	const stored = readDayTripMap();
	const list = stored[dogId] ?? [];
	const entry: DayTripLog = {
		id: createId('trip'),
		dogId,
		startedAt: now,
		endedAt: now,
		startedBy: identity.uid,
		startedByName: identity.name,
		endedBy: identity.uid,
		endedByName: identity.name,
		startNotes: notes ?? null,
		endNotes: null,
		createdAt: now,
		updatedAt: now
	};
	list.unshift(serializeDayTripLog(entry));
	stored[dogId] = list;
	writeDayTripMap(stored);
	return updateDog(dogId, {
		lastDayTripDate: now,
		isOutOnDayTrip: false,
		currentDayTripStartedAt: null
	});
}

export async function startDayTrip(dogId: string, profile?: UserProfile | null, notes?: string | null) {
	const identity = getUserIdentity(profile);
	const now = new Date();
	const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
	if (ref) {
		const logs = await listDayTripLogs(dogId);
		const openTrip = logs.find((trip) => !trip.endedAt);
		const tripStart = openTrip ? toDate(openTrip.startedAt) ?? now : now;

		if (!openTrip) {
			const entry: DayTripLog = {
				id: createId('trip'),
				dogId,
				startedAt: now,
				endedAt: null,
				startedBy: identity.uid,
				startedByName: identity.name,
				endedBy: null,
				endedByName: null,
				startNotes: notes ?? null,
				endNotes: null,
				createdAt: now,
				updatedAt: now
			};
			await setDoc(doc(ref, entry.id), serializeDayTripLog(entry));
		} else if (notes && !openTrip.startNotes) {
			await setDoc(
				doc(ref, openTrip.id),
				serializeDayTripLog({
					...openTrip,
					startNotes: notes,
					updatedAt: now
				})
			);
		}

		return updateDog(dogId, {
			lastDayTripDate: tripStart,
			isOutOnDayTrip: true,
			currentDayTripStartedAt: tripStart
		});
	}

	const stored = readDayTripMap();
	const list = stored[dogId] ?? [];
	const openTrip = list.find((trip) => !trip.endedAt);
	const tripStart = openTrip ? toDate(openTrip.startedAt) ?? now : now;

	if (!openTrip) {
		const entry: DayTripLog = {
			id: createId('trip'),
			dogId,
			startedAt: now,
			endedAt: null,
			startedBy: identity.uid,
			startedByName: identity.name,
			endedBy: null,
			endedByName: null,
			startNotes: notes ?? null,
			endNotes: null,
			createdAt: now,
			updatedAt: now
		};
		list.unshift(serializeDayTripLog(entry));
	} else if (notes && !openTrip.startNotes) {
		openTrip.startNotes = notes;
		openTrip.updatedAt = now.toISOString();
	}

	stored[dogId] = list;
	writeDayTripMap(stored);
	return updateDog(dogId, {
		lastDayTripDate: tripStart,
		isOutOnDayTrip: true,
		currentDayTripStartedAt: tripStart
	});
}

export async function endDayTrip(dogId: string, profile?: UserProfile | null, notes?: string | null) {
	const identity = getUserIdentity(profile);
	const now = new Date();
	const dog = await getDog(dogId);
	const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
	if (ref) {
		const logs = await listDayTripLogs(dogId);
		const openTrip = logs.find((trip) => !trip.endedAt);

		if (openTrip) {
			await setDoc(
				doc(ref, openTrip.id),
				serializeDayTripLog({
					...openTrip,
					endedAt: now,
					endedBy: identity.uid,
					endedByName: identity.name,
					endNotes: notes ?? openTrip.endNotes ?? null,
					updatedAt: now
				})
			);
		} else {
			const fallbackStart = toDate(dog?.currentDayTripStartedAt) ?? now;
			const entry: DayTripLog = {
				id: createId('trip'),
				dogId,
				startedAt: fallbackStart,
				endedAt: now,
				startedBy: identity.uid,
				startedByName: identity.name,
				endedBy: identity.uid,
				endedByName: identity.name,
				startNotes: null,
				endNotes: notes ?? null,
				createdAt: now,
				updatedAt: now
			};
			await setDoc(doc(ref, entry.id), serializeDayTripLog(entry));
		}

		return updateDog(dogId, {
			isOutOnDayTrip: false,
			currentDayTripStartedAt: null
		});
	}

	const stored = readDayTripMap();
	const list = stored[dogId] ?? [];
	const openTripIndex = list.findIndex((trip) => !trip.endedAt);

	if (openTripIndex >= 0) {
		const openTrip = list[openTripIndex];
		list[openTripIndex] = {
			...openTrip,
			endedAt: now.toISOString(),
			endedBy: identity.uid,
			endedByName: identity.name,
			endNotes: notes ?? openTrip.endNotes ?? null,
			updatedAt: now.toISOString()
		};
	} else {
		const fallbackStart = toDate(dog?.currentDayTripStartedAt) ?? now;
		const entry: DayTripLog = {
			id: createId('trip'),
			dogId,
			startedAt: fallbackStart,
			endedAt: now,
			startedBy: identity.uid,
			startedByName: identity.name,
			endedBy: identity.uid,
			endedByName: identity.name,
			startNotes: null,
			endNotes: notes ?? null,
			createdAt: now,
			updatedAt: now
		};
		list.unshift(serializeDayTripLog(entry));
	}

	stored[dogId] = list;
	writeDayTripMap(stored);
	return updateDog(dogId, {
		isOutOnDayTrip: false,
		currentDayTripStartedAt: null
	});
}
