import type {
	BathLog,
	BehavioralNote,
	DogHandlingLevel,
	DayTripIneligibleReason,
	DayTripLog,
	Dog,
	FeedingLog,
	StoolLog,
	Treatment,
	UserProfile
} from '$lib/types';
import { readJson, writeJson, createId } from '$lib/utils/storage';
import { toDate, toDateString } from '$lib/utils/dates';
import { db } from '$lib/firebase/config';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';

const DOGS_KEY = 'shelter.dogs';
const NOTES_KEY = 'shelter.behavioralNotes';
const BATH_KEY = 'shelter.bathLogs';
const FEEDING_KEY = 'shelter.feedingLogs';
const STOOL_KEY = 'shelter.stoolLogs';
const DAY_TRIP_KEY = 'shelter.dayTripLogs';

interface StoredTreatment {
	id: string;
	name: string;
	notes?: string | null;
	startDate?: string | null;
	endDate?: string | null;
}

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
	color?: string;
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
	surgeryRestDays?: number | null;
	lastSurgeryDate?: string | null;
	fortifloraDate?: string | null;
	fortifloraDays?: number | null;
	fortifloraTime?: string | null;
	satinBalls?: boolean;
	hasSupplements?: boolean;
	hasSecondMeal?: boolean;
	secondMealAmount?: string;
	isMicrochipped?: boolean;
	isFixed: boolean;
	fixedDate: string | null;
	isVaccinated: boolean;
	vaccineCount?: number;
	vaccinesOutstanding?: number;
	vaccinatedDate: string | null;
	allergyTypes?: string[];
	dayTripStatus: 'ineligible' | 'difficult' | 'eligible';
	dayTripIneligibleReason?: DayTripIneligibleReason | null;
	dayTripManagerOnly?: boolean;
	dayTripManagerOnlyReason?: DayTripIneligibleReason | null;
	manualTripColor?: 'green' | 'yellow' | 'red' | null;
	dayTripPuppyOverride?: boolean;
	dayTripNotes: string | null;
	handlingLevel?: DogHandlingLevel;
	inFoster: boolean;
	inFosterSince?: string | null;
	shelterSince?: string | null;
	playgroupReadyDate?: string | null;
	awaitingEvaluation?: boolean;
	evaluationAutoCleared?: boolean;
	asmId?: number | null;
	asmShelterCode?: string;
	isIncoming?: boolean;
	isolationStatus: 'none' | 'iso' | 'sick' | 'bite_quarantine';
	isolationReason?: 'sick' | 'bite_quarantine' | null;
	isolationUntilDate?: string | null;
	treatments?: StoredTreatment[];
	// Deprecated single-treatment fields — migrated into `treatments` on read.
	treatmentName?: string | null;
	treatmentNotes?: string | null;
	treatmentStartDate?: string | null;
	treatmentEndDate?: string | null;
	status: 'active' | 'adopted' | 'transferred' | 'euthanized';
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
	mealTime: 'am' | 'pm' | 'second';
	amountEaten: 'all' | 'most' | 'half' | 'little' | 'none';
	notes: string | null;
	loggedBy: string;
	loggedByName: string;
	createdAt: string;
}

interface StoredBathLog {
	id: string;
	timestamp: string;
	loggedBy: string;
	loggedByName: string;
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
	volunteerName?: string | null;
	reactionToDogs?: string | null;
	reactionToStrangers?: string | null;
	reactionToCats?: string | null;
	reactionToKids?: string | null;
	reactionToLeash?: string | null;
	reactionToCarRides?: string | null;
	reactionToToys?: string | null;
	tripNotes?: string | null;
	source?: 'staff' | 'qr' | null;
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

function isSameLocalDay(a: Date | null, b: Date) {
	return Boolean(
		a &&
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function appendUniqueDate(values: Dog['reentryDates'] | undefined, date: Date) {
	const existing = Array.isArray(values) ? [...values] : [];
	if (existing.some((value) => isSameLocalDay(toDate(value), date))) return existing;
	return [...existing, date];
}

// Returns all name variants for a dog: "Buddy (Max)" → ["buddy", "max"]
function dogNameVariants(name: string): string[] {
	const lower = name.trim().toLowerCase();
	const match = lower.match(/^(.+?)\s*\((.+)\)$/);
	if (match) return [match[1].trim(), match[2].trim()];
	return [lower];
}

// ASM-synced dogs always have purely numeric document IDs (String(animal.ID)).
// Manually-created dogs have UUID-style IDs.
function isAsmDog(dog: Dog) {
	return /^\d+$/.test(dog.id);
}

// When ASM and manually-entered dogs represent the same animal, keep the ASM copy.
function deduplicateAgainstAsm(dogs: Dog[]): Dog[] {
	const asmDogs = dogs.filter(isAsmDog);
	const nonAsmDogs = dogs.filter((d) => !isAsmDog(d));

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

function applyStatusTransition(current: Dog, updates: Partial<Dog>, now: Date): Dog {
	const nextStatus = updates.status ?? current.status;
	const changedToAdopted = current.status !== 'adopted' && nextStatus === 'adopted';
	const changedToActive = current.status === 'adopted' && nextStatus === 'active';

	const merged: Dog = applyFosterHousingRules({
		...current,
		...updates,
		updatedAt: now
	});

	if (changedToAdopted) {
		return applyFosterHousingRules({
			...merged,
			leftShelterDate: merged.leftShelterDate ?? now,
			outdoorKennelAssignment: '',
			inFoster: false,
			permanentFoster: false,
			shelterSince: null,
			isOutOnDayTrip: false,
			currentDayTripStartedAt: null
		});
	}

	if (changedToActive) {
		const reentryAt = toDate(merged.shelterSince) ?? now;
		return applyFosterHousingRules({
			...merged,
			leftShelterDate: null,
			reentryDates: appendUniqueDate(merged.reentryDates, reentryAt),
			awaitingEvaluation: true
		});
	}

	return merged;
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
		satinBalls: dog.satinBalls ?? false,
		hasSupplements: dog.hasSupplements ?? false,
		hasSecondMeal: dog.hasSecondMeal ?? false,
		secondMealAmount: dog.secondMealAmount ?? '',
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
		surgeryRestDays: dog.surgeryRestDays ?? null,
		lastSurgeryDate: toDateString(dog.lastSurgeryDate),
		fortifloraDate: toDateString(dog.fortifloraDate) ?? null,
		fortifloraDays: typeof dog.fortifloraDays === 'number' ? dog.fortifloraDays : null,
		fortifloraTime: dog.fortifloraTime ?? null,
		isMicrochipped: dog.isMicrochipped ?? false,
		isFixed: dog.isFixed,
		fixedDate: toDateString(dog.fixedDate),
		isVaccinated: dog.isVaccinated,
		vaccineCount: dog.vaccineCount,
		vaccinesOutstanding: dog.vaccinesOutstanding ?? 0,
		vaccinatedDate: toDateString(dog.vaccinatedDate),
		allergyTypes: dog.allergyTypes ?? [],
		dayTripStatus: dog.dayTripStatus,
		dayTripIneligibleReason: dog.dayTripIneligibleReason ?? null,
		dayTripManagerOnly: dog.dayTripManagerOnly ?? false,
		dayTripManagerOnlyReason: dog.dayTripManagerOnly ? (dog.dayTripManagerOnlyReason ?? 'other') : null,
		manualTripColor: dog.manualTripColor ?? null,
		dayTripPuppyOverride: dog.dayTripPuppyOverride ?? false,
		dayTripNotes: dog.dayTripNotes,
		handlingLevel: dog.handlingLevel ?? 'volunteer',
		inFoster: dog.inFoster ?? false,
		inFosterSince: toDateString(dog.inFosterSince) ?? null,
		shelterSince: toDateString(dog.shelterSince) ?? null,
		playgroupReadyDate: toDateString(dog.playgroupReadyDate) ?? null,
		awaitingEvaluation: dog.awaitingEvaluation ?? false,
		evaluationAutoCleared: dog.evaluationAutoCleared ?? false,
		asmId: typeof dog.asmId === 'number' ? dog.asmId : null,
		asmShelterCode: dog.asmShelterCode ?? '',
		isolationStatus: dog.isolationStatus,
		isolationReason: dog.isolationReason ?? null,
		isolationUntilDate: toDateString(dog.isolationUntilDate),
		treatments: (dog.treatments ?? []).map((t) => ({
			id: t.id,
			name: t.name,
			notes: t.notes ?? null,
			startDate: toDateString(t.startDate),
			endDate: toDateString(t.endDate)
		})),
		// Deprecated flat fields are no longer written — null them out as data migrates.
		treatmentName: null,
		treatmentNotes: null,
		treatmentStartDate: null,
		treatmentEndDate: null,
		status: dog.status,
		createdAt: toDateString(dog.createdAt) ?? new Date().toISOString(),
		updatedAt: toDateString(dog.updatedAt) ?? new Date().toISOString()
	};
}

// Reads the treatments array, migrating the deprecated single-treatment flat fields
// into a one-element array when no array is present yet. An existing array (even an
// empty one) is authoritative — that's how "all treatments removed" is preserved.
function deserializeTreatments(stored: StoredDog): Treatment[] {
	if (Array.isArray(stored.treatments)) {
		return stored.treatments.map((t) => ({
			id: t.id,
			name: t.name,
			notes: t.notes ?? null,
			startDate: t.startDate ? toDate(t.startDate) : null,
			endDate: t.endDate ? toDate(t.endDate) : null
		}));
	}
	if (stored.treatmentName) {
		return [{
			id: createId('tx'),
			name: stored.treatmentName,
			notes: stored.treatmentNotes ?? null,
			startDate: stored.treatmentStartDate ? toDate(stored.treatmentStartDate) : null,
			endDate: stored.treatmentEndDate ? toDate(stored.treatmentEndDate) : null
		}];
	}
	return [];
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
		satinBalls: stored.satinBalls ?? false,
		hasSupplements: stored.hasSupplements ?? false,
		hasSecondMeal: stored.hasSecondMeal ?? false,
		secondMealAmount: stored.secondMealAmount ?? '',
		origin: stored.origin ?? '',
		color: stored.color ?? '',
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
		surgeryRestDays: typeof stored.surgeryRestDays === 'number' ? stored.surgeryRestDays : null,
		lastSurgeryDate: stored.lastSurgeryDate ? toDate(stored.lastSurgeryDate) : null,
		fortifloraDate: stored.fortifloraDate ? toDate(stored.fortifloraDate) : null,
		fortifloraDays: typeof stored.fortifloraDays === 'number' ? stored.fortifloraDays : null,
		fortifloraTime: (['am', 'pm', 'both'].includes(stored.fortifloraTime ?? '') ? stored.fortifloraTime as 'am' | 'pm' | 'both' : null),
		isMicrochipped: stored.isMicrochipped ?? false,
		isFixed: stored.isFixed ?? false,
		fixedDate: stored.fixedDate ? toDate(stored.fixedDate) : null,
		isVaccinated: stored.isVaccinated ?? false,
		vaccineCount: stored.vaccineCount ?? (stored.isVaccinated ? 1 : 0),
		vaccinesOutstanding: stored.vaccinesOutstanding ?? 0,
		vaccinatedDate: stored.vaccinatedDate ? toDate(stored.vaccinatedDate) : null,
		allergyTypes: stored.allergyTypes ?? [],
		dayTripStatus: normalizedDayTripStatus,
		dayTripIneligibleReason,
		dayTripManagerOnly,
		dayTripManagerOnlyReason,
		manualTripColor: (['green', 'yellow', 'red'].includes(stored.manualTripColor ?? '')
			? (stored.manualTripColor as 'green' | 'yellow' | 'red')
			: null),
		dayTripPuppyOverride: stored.dayTripPuppyOverride ?? false,
		dayTripNotes: normalizedDayTripNotes.length > 0 ? normalizedDayTripNotes : null,
		handlingLevel: normalizedHandlingLevel,
		inFoster: stored.inFoster ?? false,
		inFosterSince: stored.inFosterSince ? toDate(stored.inFosterSince) : null,
		shelterSince: stored.shelterSince ? toDate(stored.shelterSince) : null,
		playgroupReadyDate: stored.playgroupReadyDate ? toDate(stored.playgroupReadyDate) : null,
		awaitingEvaluation: stored.awaitingEvaluation ?? false,
		evaluationAutoCleared: stored.evaluationAutoCleared ?? false,
		asmId: typeof stored.asmId === 'number' ? stored.asmId : null,
		asmShelterCode: stored.asmShelterCode ?? '',
		isIncoming: stored.isIncoming ?? false,
		isolationStatus: (stored.isolationStatus === 'sick' || stored.isolationStatus === 'bite_quarantine' || stored.isolationStatus === 'iso') ? 'iso' : 'none',
		isolationReason: (stored.isolationStatus === 'sick' || stored.isolationReason === 'sick') ? 'sick' : (stored.isolationStatus === 'bite_quarantine' || stored.isolationReason === 'bite_quarantine') ? 'bite_quarantine' : null,
		isolationUntilDate: stored.isolationUntilDate ? toDate(stored.isolationUntilDate) : null,
		treatments: deserializeTreatments(stored),
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

function serializeBathLog(log: BathLog): StoredBathLog {
	return {
		id: log.id,
		timestamp: toDateString(log.timestamp) ?? new Date().toISOString(),
		loggedBy: log.loggedBy,
		loggedByName: log.loggedByName
	};
}

function deserializeBathLog(log: StoredBathLog): BathLog {
	return {
		id: log.id,
		timestamp: toDate(log.timestamp) ?? new Date(),
		loggedBy: log.loggedBy,
		loggedByName: log.loggedByName
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
		volunteerName: log.volunteerName ?? null,
		reactionToDogs: log.reactionToDogs ?? null,
		reactionToStrangers: log.reactionToStrangers ?? null,
		reactionToCats: log.reactionToCats ?? null,
		reactionToKids: log.reactionToKids ?? null,
		reactionToLeash: log.reactionToLeash ?? null,
		reactionToCarRides: log.reactionToCarRides ?? null,
		reactionToToys: log.reactionToToys ?? null,
		tripNotes: log.tripNotes ?? null,
		source: log.source ?? null,
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
		volunteerName: log.volunteerName ?? null,
		reactionToDogs: (log.reactionToDogs as DayTripLog['reactionToDogs']) ?? null,
		reactionToStrangers: (log.reactionToStrangers as DayTripLog['reactionToStrangers']) ?? null,
		reactionToCats: (log.reactionToCats as DayTripLog['reactionToCats']) ?? null,
		reactionToKids: (log.reactionToKids as DayTripLog['reactionToKids']) ?? null,
		reactionToLeash: (log.reactionToLeash as DayTripLog['reactionToLeash']) ?? null,
		reactionToCarRides: (log.reactionToCarRides as DayTripLog['reactionToCarRides']) ?? null,
		reactionToToys: (log.reactionToToys as DayTripLog['reactionToToys']) ?? null,
		tripNotes: log.tripNotes ?? null,
		source: log.source ?? null,
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

function isPermissionDenied(error: unknown) {
	return typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		String((error as { code?: unknown }).code).includes('permission-denied');
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
	subcollection: 'behavioralNotes' | 'bathLogs' | 'feedingLogs' | 'stoolLogs' | 'dayTripLogs'
) {
	if (!db) return null;
	return collection(db, 'dogs', dogId, subcollection);
}

async function deleteDogSubcollection(
	dogId: string,
	subcollection: 'behavioralNotes' | 'bathLogs' | 'feedingLogs' | 'stoolLogs' | 'dayTripLogs'
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
			deserializeDog({ ...(docSnap.data() as StoredDog), id: docSnap.id })
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
		return deserializeDog({ ...(snapshot.data() as StoredDog), id: snapshot.id });
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
			awaitingEvaluation: true,
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
		awaitingEvaluation: true,
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
		const merged = applyStatusTransition(current, updates, new Date());
		await setDoc(ref, serializeDog(merged), { merge: true });
		return merged;
	}

	const stored = readJson<StoredDog[]>(DOGS_KEY, []);
	const now = new Date();
	const next = stored.map((dog) => {
		if (dog.id !== id) return dog;
		const merged = applyStatusTransition(deserializeDog(dog), updates, now);
		return serializeDog(merged);
	});
	writeJson(DOGS_KEY, next);
	return getDog(id);
}

export async function mergeDogs(keepId: string, deleteId: string) {
	const subcollections = ['behavioralNotes', 'bathLogs', 'feedingLogs', 'stoolLogs', 'dayTripLogs'] as const;

	if (db) {
		for (const sub of subcollections) {
			const srcRef = collection(db, 'dogs', deleteId, sub);
			const dstRef = collection(db, 'dogs', keepId, sub);
			const snapshot = await getDocs(srcRef);
			const batch = writeBatch(db);
			for (const docSnap of snapshot.docs) {
				batch.set(doc(dstRef, docSnap.id), docSnap.data());
			}
			await batch.commit();
		}
		await deleteDog(deleteId);
		return;
	}

	// localStorage path
	const notes = readJson<NoteMap>(NOTES_KEY, {});
	notes[keepId] = [...(notes[keepId] ?? []), ...(notes[deleteId] ?? [])];
	delete notes[deleteId];
	writeJson(NOTES_KEY, notes);

	const baths = readJson<LogMap<StoredBathLog>>(BATH_KEY, {});
	baths[keepId] = [...(baths[keepId] ?? []), ...(baths[deleteId] ?? [])];
	delete baths[deleteId];
	writeJson(BATH_KEY, baths);

	const feeding = readJson<LogMap<StoredFeedingLog>>(FEEDING_KEY, {});
	feeding[keepId] = [...(feeding[keepId] ?? []), ...(feeding[deleteId] ?? [])];
	delete feeding[deleteId];
	writeJson(FEEDING_KEY, feeding);

	const stools = readJson<LogMap<StoredStoolLog>>(STOOL_KEY, {});
	stools[keepId] = [...(stools[keepId] ?? []), ...(stools[deleteId] ?? [])];
	delete stools[deleteId];
	writeJson(STOOL_KEY, stools);

	const dayTrips = readDayTripMap();
	dayTrips[keepId] = [...(dayTrips[keepId] ?? []), ...(dayTrips[deleteId] ?? [])];
	delete dayTrips[deleteId];
	writeDayTripMap(dayTrips);

	await deleteDog(deleteId);
}

export async function archiveDog(id: string) {
	return updateDog(id, {
		status: 'adopted',
		leftShelterDate: new Date(),
		outdoorKennelAssignment: '',
		inFoster: false,
		permanentFoster: false,
		shelterSince: null,
		isOutOnDayTrip: false,
		currentDayTripStartedAt: null
	});
}

export async function returnDog(id: string) {
	return updateDog(id, {
		status: 'active',
		leftShelterDate: null
	});
}

export async function deleteDog(id: string) {
	const ref = dogRef(id);
	if (ref) {
		await deleteDogSubcollection(id, 'behavioralNotes');
		await deleteDogSubcollection(id, 'bathLogs');
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

	const baths = readJson<LogMap<StoredBathLog>>(BATH_KEY, {});
	delete baths[id];
	writeJson(BATH_KEY, baths);

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
			deserializeNote({ ...(docSnap.data() as StoredNote), id: docSnap.id })
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
			const log = deserializeFeedingLog({ ...(docSnap.data() as StoredFeedingLog), id: docSnap.id });
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
			deserializeFeedingLog({ ...(docSnap.data() as StoredFeedingLog), id: docSnap.id })
		);
		return sortByDateDesc(logs, (log) => log.date);
	}

	const stored = readJson<LogMap<StoredFeedingLog>>(FEEDING_KEY, {});
	const logs = stored[dogId] ?? [];
	return logs.map(deserializeFeedingLog);
}

export async function listBathLogs(dogId: string) {
	const ref = dogSubcollectionRef(dogId, 'bathLogs');
	if (ref) {
		try {
			const snapshot = await getDocs(ref);
			const logs = snapshot.docs.map((docSnap) =>
				deserializeBathLog({ ...(docSnap.data() as StoredBathLog), id: docSnap.id })
			);
			return sortByDateDesc(logs, (log) => log.timestamp);
		} catch (error) {
			if (isPermissionDenied(error)) return [];
			throw error;
		}
	}

	const stored = readJson<LogMap<StoredBathLog>>(BATH_KEY, {});
	const logs = stored[dogId] ?? [];
	return logs.map(deserializeBathLog);
}

export async function backfillBathLogsFromDogs() {
	if (db) {
		try {
			const [dogsSnapshot, bathLogsSnapshot] = await Promise.all([
				getDocs(collection(db, 'dogs')),
				getDocs(collectionGroup(db, 'bathLogs'))
			]);

			const existingByDog = new Map<string, Set<number>>();
			for (const docSnap of bathLogsSnapshot.docs) {
				const dogId = docSnap.ref.parent.parent?.id;
				if (!dogId) continue;
				const timestamp = toDate((docSnap.data() as StoredBathLog).timestamp)?.getTime();
				if (!timestamp) continue;
				const existing = existingByDog.get(dogId) ?? new Set<number>();
				existing.add(timestamp);
				existingByDog.set(dogId, existing);
			}

			let writes = 0;
			let batch = writeBatch(db);
			for (const dogDoc of dogsSnapshot.docs) {
				const data = dogDoc.data() as StoredDog;
				const bathAt = toDate(data.lastBathDate);
				if (!bathAt) continue;
				const existing = existingByDog.get(dogDoc.id);
				if (existing?.has(bathAt.getTime())) continue;

				const logRef = doc(collection(db, 'dogs', dogDoc.id, 'bathLogs'));
				batch.set(logRef, serializeBathLog({
					id: logRef.id,
					timestamp: bathAt,
					loggedBy: 'system-backfill',
					loggedByName: 'Bath history backfill'
				}));
				writes += 1;

				if (writes % 450 === 0) {
					await batch.commit();
					batch = writeBatch(db);
				}
			}

			if (writes % 450 !== 0) {
				await batch.commit();
			}

			return writes;
		} catch (error) {
			if (isPermissionDenied(error)) return 0;
			throw error;
		}
	}

	const dogs = readJson<StoredDog[]>(DOGS_KEY, []);
	const stored = readJson<LogMap<StoredBathLog>>(BATH_KEY, {});
	let writes = 0;

	for (const dog of dogs) {
		const bathAt = toDate(dog.lastBathDate);
		if (!bathAt) continue;
		const logs = stored[dog.id] ?? [];
		const hasMatch = logs.some((log) => (toDate(log.timestamp)?.getTime() ?? 0) === bathAt.getTime());
		if (hasMatch) continue;
		logs.unshift(serializeBathLog({
			id: createId('bath'),
			timestamp: bathAt,
			loggedBy: 'system-backfill',
			loggedByName: 'Bath history backfill'
		}));
		stored[dog.id] = logs;
		writes += 1;
	}

	if (writes > 0) {
		writeJson(BATH_KEY, stored);
	}

	return writes;
}

// One-time repair: re-derive every dog's lastDayTripDate from its trip logs (the
// single source of truth) so the cached field matches what the logs actually show.
// Fixes dogs whose date drifted because a log was created without updating the cache.
export async function backfillLastDayTripFromLogs() {
	if (db) {
		try {
			const [dogsSnapshot, tripLogsSnapshot] = await Promise.all([
				getDocs(collection(db, 'dogs')),
				getDocs(collectionGroup(db, 'dayTripLogs'))
			]);

			const latestByDog = new Map<string, Date>();
			for (const docSnap of tripLogsSnapshot.docs) {
				const dogId = docSnap.ref.parent.parent?.id;
				if (!dogId) continue;
				const data = docSnap.data() as StoredDayTripLog;
				const d = toDate(data.endedAt) ?? toDate(data.startedAt);
				if (!d) continue;
				const existing = latestByDog.get(dogId);
				if (!existing || d > existing) latestByDog.set(dogId, d);
			}

			let writes = 0;
			let batch = writeBatch(db);
			for (const dogDoc of dogsSnapshot.docs) {
				const data = dogDoc.data() as StoredDog;
				const latest = latestByDog.get(dogDoc.id) ?? null;
				const latestStr = latest ? toDateString(latest) : null;
				const currentStr = data.lastDayTripDate ? toDateString(data.lastDayTripDate) : null;
				if (latestStr === currentStr) continue;
				batch.set(doc(db, 'dogs', dogDoc.id), { lastDayTripDate: latestStr }, { merge: true });
				writes += 1;
				if (writes % 450 === 0) {
					await batch.commit();
					batch = writeBatch(db);
				}
			}

			if (writes % 450 !== 0) {
				await batch.commit();
			}

			return writes;
		} catch (error) {
			if (isPermissionDenied(error)) return 0;
			throw error;
		}
	}

	const dogs = readJson<StoredDog[]>(DOGS_KEY, []);
	const stored = readDayTripMap();
	let writes = 0;

	for (const dog of dogs) {
		const logs = stored[dog.id] ?? [];
		let latest: Date | null = null;
		for (const log of logs) {
			const d = toDate(log.endedAt) ?? toDate(log.startedAt);
			if (d && (!latest || d > latest)) latest = d;
		}
		const latestStr = latest ? toDateString(latest) : null;
		const currentStr = dog.lastDayTripDate ? toDateString(dog.lastDayTripDate) : null;
		if (latestStr === currentStr) continue;
		dog.lastDayTripDate = latestStr;
		writes += 1;
	}

	if (writes > 0) {
		writeJson(DOGS_KEY, dogs);
	}

	return writes;
}

export async function listStoolLogs(dogId: string) {
	const ref = dogSubcollectionRef(dogId, 'stoolLogs');
	if (ref) {
		const snapshot = await getDocs(ref);
		const logs = snapshot.docs.map((docSnap) =>
			deserializeStoolLog({ ...(docSnap.data() as StoredStoolLog), id: docSnap.id })
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
			deserializeDayTripLog({ ...(docSnap.data() as StoredDayTripLog), id: docSnap.id })
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
			deserializeDayTripLog({ ...(docSnap.data() as StoredDayTripLog), id: docSnap.id })
		);
		return sortByDateDesc(logs, (log) => log.startedAt);
	}

	const stored = readDayTripMap();
	return Object.values(stored).flat().map(deserializeDayTripLog);
}

export async function patchDayTripLog(
	dogId: string,
	tripId: string,
	patch: Partial<Pick<DayTripLog,
		'tripNotes' | 'reactionToDogs' | 'reactionToStrangers' | 'reactionToCats' |
		'reactionToKids' | 'reactionToLeash' | 'reactionToCarRides' | 'reactionToToys'
	>>
) {
	if (db) {
		const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
		if (ref) await setDoc(doc(ref, tripId), patch, { merge: true });
		return;
	}
	const map = readDayTripMap();
	if (map[dogId]) {
		map[dogId] = map[dogId].map(l => l.id === tripId ? { ...l, ...patch } : l);
		writeDayTripMap(map);
	}
}

// lastDayTripDate is derived purely from the dog's trip logs — the single source of
// truth. It is the most recent trip date (endedAt preferred, else startedAt for an
// in-progress trip), or null when the dog has no logs. Call after any change to a
// dog's trip logs.
export async function recomputeLastDayTripDate(dogId: string): Promise<void> {
	const logs = await listDayTripLogs(dogId);
	let latest: Date | null = null;
	for (const log of logs) {
		const d = toDate(log.endedAt) ?? toDate(log.startedAt);
		if (d && (!latest || d > latest)) latest = d;
	}
	await updateDog(dogId, { lastDayTripDate: latest });
}

export async function deleteDayTripLog(dogId: string, tripId: string) {
	if (db) {
		const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
		if (ref) await deleteDoc(doc(ref, tripId));
	} else {
		const map = readDayTripMap();
		if (map[dogId]) {
			map[dogId] = map[dogId].filter((l) => l.id !== tripId);
			writeDayTripMap(map);
		}
	}
	await recomputeLastDayTripDate(dogId);
}

export async function repairTripYear(
	dogId: string,
	tripId: string,
	correctedStartedAt: Date,
	correctedEndedAt: Date | null
) {
	if (db) {
		const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
		if (ref) {
			await setDoc(doc(ref, tripId), {
				startedAt: toDateString(correctedStartedAt),
				endedAt: correctedEndedAt ? toDateString(correctedEndedAt) : null,
			}, { merge: true });
		}
	} else {
		const map = readDayTripMap();
		if (map[dogId]) {
			map[dogId] = map[dogId].map((l) => {
				if (l.id !== tripId) return l;
				return {
					...l,
					startedAt: toDateString(correctedStartedAt) ?? l.startedAt,
					endedAt: correctedEndedAt ? (toDateString(correctedEndedAt) ?? l.endedAt) : l.endedAt,
				};
			});
			writeDayTripMap(map);
		}
	}
	await recomputeLastDayTripDate(dogId);
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

export async function updateFeedingLog(
	dogId: string,
	logId: string,
	updates: Pick<FeedingLog, 'amountEaten' | 'notes'>
) {
	const ref = dogSubcollectionRef(dogId, 'feedingLogs');
	if (ref) {
		await setDoc(doc(ref, logId), updates, { merge: true });
		return;
	}

	const stored = readJson<LogMap<StoredFeedingLog>>(FEEDING_KEY, {});
	const list = stored[dogId] ?? [];
	const idx = list.findIndex((e) => e.id === logId);
	if (idx < 0) return;
	list[idx] = { ...list[idx], ...updates };
	stored[dogId] = list;
	writeJson(FEEDING_KEY, stored);
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

export async function logBath(dogId: string, profile?: UserProfile | null, timestamp?: Date) {
	const identity = getUserIdentity(profile);
	const now = timestamp ?? new Date();
	const ref = dogSubcollectionRef(dogId, 'bathLogs');
	if (ref) {
		try {
			const entry: BathLog = {
				id: createId('bath'),
				timestamp: now,
				loggedBy: identity.uid,
				loggedByName: identity.name
			};
			await setDoc(doc(ref, entry.id), serializeBathLog(entry));
		} catch (error) {
			if (!isPermissionDenied(error)) throw error;
		}
		await updateDog(dogId, { lastBathDate: now, lastBathBy: identity.name });
		return null;
	}

	const stored = readJson<LogMap<StoredBathLog>>(BATH_KEY, {});
	const list = stored[dogId] ?? [];
	const entry: BathLog = {
		id: createId('bath'),
		timestamp: now,
		loggedBy: identity.uid,
		loggedByName: identity.name
	};
	list.unshift(serializeBathLog(entry));
	stored[dogId] = list;
	writeJson(BATH_KEY, stored);
	await updateDog(dogId, { lastBathDate: now, lastBathBy: identity.name });
	return entry;
}

export async function deleteBathLog(dogId: string, logId: string) {
	const ref = dogSubcollectionRef(dogId, 'bathLogs');
	if (ref) {
		await deleteDoc(doc(ref, logId));
		// Recompute lastBathDate from remaining logs
		const remaining = await getDocs(ref);
		let latestMs = 0;
		let latestLog: StoredBathLog | null = null;
		for (const snap of remaining.docs) {
			const data = snap.data() as StoredBathLog;
			const ms = new Date(data.timestamp).getTime();
			if (ms > latestMs) { latestMs = ms; latestLog = data; }
		}
		await updateDog(dogId, {
			lastBathDate: latestLog ? new Date(latestLog.timestamp) : null,
			lastBathBy: latestLog ? latestLog.loggedByName : null
		});
		return;
	}
	const stored = readJson<LogMap<StoredBathLog>>(BATH_KEY, {});
	const list = (stored[dogId] ?? []).filter((l) => l.id !== logId);
	stored[dogId] = list;
	writeJson(BATH_KEY, stored);
	const latest = list[0] ?? null;
	await updateDog(dogId, {
		lastBathDate: latest ? new Date(latest.timestamp) : null,
		lastBathBy: latest ? latest.loggedByName : null
	});
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

// Visual-only toggle — updates the dog's status without creating a trip log entry.
// Purely visual whiteboard state: only toggles the "out now" flag and its
// timestamp. Never touches lastDayTripDate or trip logs — completed trips are
// recorded via the trip log form (logManualTrip), which owns the overdue clock.
/**
 * Manager-set day-trip color override. Pass `null` to clear the override and
 * fall back to the imported sheet color / computed color.
 */
export async function setDogManualTripColor(
	dogId: string,
	color: 'green' | 'yellow' | 'red' | null
): Promise<void> {
	await updateDog(dogId, { manualTripColor: color });
}

export async function setDogTripStatus(dogId: string, isOut: boolean): Promise<void> {
	const now = new Date();
	if (isOut) {
		await updateDog(dogId, { isOutOnDayTrip: true, currentDayTripStartedAt: now });
	} else {
		await updateDog(dogId, { isOutOnDayTrip: false, currentDayTripStartedAt: null });
	}
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

/** Creates a historical day trip log entry with a specific date and zero duration.
 *  Does NOT update the dog's lastDayTripDate — callers should do that separately. */
export async function clearDayTripLogs(dogId: string): Promise<void> {
	await deleteDogSubcollection(dogId, 'dayTripLogs');
}

export async function importHistoricalDayTrip(
	dogId: string,
	tripDate: Date,
	profile?: UserProfile | null
): Promise<void> {
	const identity = getUserIdentity(profile);
	const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
	if (!ref) return; // Firebase not available — skip silently for imports
	const entry: DayTripLog = {
		id: importedTripId(tripDate),
		dogId,
		startedAt: tripDate,
		endedAt: tripDate,
		startedBy: identity.uid,
		startedByName: identity.name,
		endedBy: identity.uid,
		endedByName: identity.name,
		startNotes: 'Imported from spreadsheet',
		endNotes: null,
		createdAt: new Date(),
		updatedAt: new Date()
	};
	await setDoc(doc(ref, entry.id), serializeDayTripLog(entry));
	await recomputeLastDayTripDate(dogId);
}

// Returns the default end time for a day trip: 1 hour before closing on the given date.
// Mon–Thu close at 6pm → default 5pm; Fri–Sat close at 5pm → default 4pm; Sun (closed) → 5pm.
function defaultTripEndTime(date: Date): Date {
	const day = date.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
	const hour = day >= 1 && day <= 4 ? 17 : 16; // Mon-Thu: 5pm, Fri/Sat/Sun: 4pm
	const result = new Date(date);
	result.setHours(hour, 0, 0, 0);
	return result;
}

export async function endDayTrip(dogId: string, profile?: UserProfile | null, notes?: string | null) {
	const identity = getUserIdentity(profile);
	const now = new Date();
	const dog = await getDog(dogId);
	const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
	if (ref) {
		const logs = await listDayTripLogs(dogId);
		const openTrip = logs.find((trip) => !trip.endedAt);

		// Close at the shelter's closing time on the day the trip started
		const tripStartDate = openTrip ? (toDate(openTrip.startedAt) ?? now) : (toDate(dog?.currentDayTripStartedAt) ?? now);
		const endedAt = defaultTripEndTime(tripStartDate);

		if (openTrip) {
			await setDoc(
				doc(ref, openTrip.id),
				serializeDayTripLog({
					...openTrip,
					endedAt,
					endedBy: identity.uid,
					endedByName: identity.name,
					endNotes: notes ?? openTrip.endNotes ?? null,
					updatedAt: now
				})
			);
		} else {
			const entry: DayTripLog = {
				id: createId('trip'),
				dogId,
				startedAt: tripStartDate,
				endedAt,
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
			currentDayTripStartedAt: null,
			lastDayTripDate: endedAt
		});
	}

	const stored = readDayTripMap();
	const list = stored[dogId] ?? [];
	const openTripIndex = list.findIndex((trip) => !trip.endedAt);
	const localStart = openTripIndex >= 0
		? (toDate(list[openTripIndex].startedAt) ?? now)
		: (toDate(dog?.currentDayTripStartedAt) ?? now);
	const endedAt = defaultTripEndTime(localStart);

	if (openTripIndex >= 0) {
		const openTrip = list[openTripIndex];
		list[openTripIndex] = {
			...openTrip,
			endedAt: endedAt.toISOString(),
			endedBy: identity.uid,
			endedByName: identity.name,
			endNotes: notes ?? openTrip.endNotes ?? null,
			updatedAt: now.toISOString()
		};
	} else {
		const entry: DayTripLog = {
			id: createId('trip'),
			dogId,
			startedAt: localStart,
			endedAt,
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
		currentDayTripStartedAt: null,
		lastDayTripDate: endedAt
	});
}

// Deterministic id for a trip imported from notes/spreadsheet, keyed on the trip day.
// Re-importing the same day overwrites the same row instead of creating a duplicate,
// so concurrent imports across devices can never double up.
export function importedTripId(date: Date): string {
	return `imp-${toDateString(date)?.slice(0, 10) ?? 'unknown'}`;
}

export interface ManualTripData {
	logId?: string;
	startedAt: Date;
	endedAt: Date | null;
	volunteerName: string;
	reactionToDogs: DayTripLog['reactionToDogs'];
	reactionToStrangers: DayTripLog['reactionToStrangers'];
	reactionToCats: DayTripLog['reactionToCats'];
	reactionToKids: DayTripLog['reactionToKids'];
	reactionToLeash: DayTripLog['reactionToLeash'];
	reactionToCarRides: DayTripLog['reactionToCarRides'];
	reactionToToys: DayTripLog['reactionToToys'];
	tripNotes: string;
	source: 'staff' | 'qr';
}

export async function logManualTrip(
	dogId: string,
	data: ManualTripData,
	profile?: UserProfile | null
): Promise<void> {
	const identity = getUserIdentity(profile);
	const now = new Date();
	const ref = dogSubcollectionRef(dogId, 'dayTripLogs');
	const entry: DayTripLog = {
		id: data.logId ?? createId('trip'),
		dogId,
		startedAt: data.startedAt,
		endedAt: data.endedAt,
		startedBy: identity.uid,
		startedByName: identity.name,
		endedBy: data.endedAt ? identity.uid : null,
		endedByName: data.endedAt ? identity.name : null,
		startNotes: null,
		endNotes: null,
		volunteerName: data.volunteerName || null,
		reactionToDogs: data.reactionToDogs ?? null,
		reactionToStrangers: data.reactionToStrangers ?? null,
		reactionToCats: data.reactionToCats ?? null,
		reactionToKids: data.reactionToKids ?? null,
		reactionToLeash: data.reactionToLeash ?? null,
		reactionToCarRides: data.reactionToCarRides ?? null,
		reactionToToys: data.reactionToToys ?? null,
		tripNotes: data.tripNotes || null,
		source: data.source,
		createdAt: now,
		updatedAt: now
	};
	if (ref) {
		await setDoc(doc(ref, entry.id), serializeDayTripLog(entry));
	} else {
		const stored = readDayTripMap();
		const list = (stored[dogId] ??= []);
		// Overwrite an existing row with the same id (deterministic imports), else add.
		const existingIndex = list.findIndex((l) => l.id === entry.id);
		if (existingIndex >= 0) list[existingIndex] = serializeDayTripLog(entry);
		else list.unshift(serializeDayTripLog(entry));
		writeDayTripMap(stored);
	}
	// Out-status is owned solely by the visual toggle (setDogTripStatus) — logging a trip
	// never changes isOutOnDayTrip/currentDayTripStartedAt.
	await recomputeLastDayTripDate(dogId);
}
