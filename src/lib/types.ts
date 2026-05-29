import type { Timestamp } from 'firebase/firestore';

export type DateValue = Date | Timestamp;
export type UserRole = 'admin' | 'manager' | 'staff' | 'volunteer';

export interface UserProfile {
	uid: string;
	email: string;
	displayName: string;
	role: UserRole;
	createdAt: DateValue;
	updatedAt: DateValue;
}

export type DogStatus = 'active' | 'adopted' | 'transferred' | 'euthanized';
export type DayTripStatus = 'ineligible' | 'difficult' | 'eligible';
export type DayTripIneligibleReason = 'behavior' | 'medical' | 'other';
export type IsolationStatus = 'none' | 'iso';
export type IsolationReason = 'sick' | 'bite_quarantine';
export type DogHandlingLevel = 'manager_only' | 'staff_only' | 'volunteer';
export type Compatibility = 'yes' | 'no' | 'unknown';
export type PottyTrainedStatus = 'yes' | 'no' | 'working_on_it' | 'unknown';
export type EnergyLevel = 'low' | 'medium' | 'high' | 'very_high' | 'unknown';
export type DogSex = 'male' | 'female' | 'unknown';

export interface Dog {
	id: string;
	name: string;
	breed: string;
	sex: DogSex;
	intakeDate: DateValue;
	originalIntakeDate: DateValue;
	reentryDates: DateValue[];
	leftShelterDate?: DateValue | null;
	dateOfBirth: DateValue;
	weightLbs: number | null;
	foodType: string;
	foodAmount: string;
	dietaryNotes: string;
	photoUrl?: string | null;
	hasOwnFood?: boolean;
	transitionToHills?: boolean | null;
	satinBalls?: boolean;
	hasSupplements?: boolean;
	hasSecondMeal?: boolean;
	secondMealAmount?: string;
	origin: string;
	color?: string;
	markings?: string;
	hiddenComments?: string;
	description?: string;
	warningNotes?: string;
	holdNotes?: string;
	pottyTrained: PottyTrainedStatus;
	goodWithDogs: Compatibility;
	goodWithCats: Compatibility;
	goodWithKids: Compatibility;
	goodWithElderly?: Compatibility;
	goodOnLead?: Compatibility;
	goodTraveller?: Compatibility;
	crateTrained?: Compatibility;
	idealHome: string;
	energyLevel: EnergyLevel;
	outdoorKennelAssignment: string;
	microchipDate?: DateValue | null;
	healthProblems?: string;
	lastBathDate: DateValue | null;
	lastBathBy: string | null;
	lastDayTripDate: DateValue | null;
	// Whether the dog is currently out on a day trip
	isOutOnDayTrip: boolean;
	// When the current day trip started (if out)
	currentDayTripStartedAt: DateValue | null;
	surgeryDate: DateValue | null;
	surgeryRestDays: number | null;
	lastSurgeryDate: DateValue | null;
	fortifloraDate: DateValue | null;
	fortifloraDays: number | null;
	fortifloraTime: 'am' | 'pm' | 'both' | null;
	isMicrochipped: boolean;
	isFixed: boolean;
	fixedDate: DateValue | null;
	isVaccinated: boolean;
	vaccineCount: number;
	vaccinatedDate: DateValue | null;
	allergyTypes?: string[];
	dayTripStatus: DayTripStatus;
	dayTripIneligibleReason?: DayTripIneligibleReason | null;
	dayTripManagerOnly: boolean;
	dayTripManagerOnlyReason?: DayTripIneligibleReason | null;
	dayTripNotes: string | null;
	handlingLevel: DogHandlingLevel;
	inFoster: boolean;
	shelterSince?: DateValue | null;
	playgroupReadyDate?: DateValue | null;
	awaitingEvaluation?: boolean;
	evaluationNotes?: string | null;
	notAdoptable?: boolean;
	notAdoptableReason?: string | null;
	permanentFoster?: boolean;
	isIncoming?: boolean;
	asmId?: number | null;
	asmShelterCode?: string;
	isolationStatus: IsolationStatus;
	isolationReason: IsolationReason | null;
	isolationUntilDate: DateValue | null;
	treatmentName?: string | null;
	treatmentNotes?: string | null;
	treatmentStartDate?: DateValue | null;
	treatmentEndDate?: DateValue | null;
	status: DogStatus;
	createdAt: DateValue;
	updatedAt: DateValue;
}

export interface BehavioralNote {
	id: string;
	note: string;
	createdAt: DateValue;
	loggedBy: string;
	loggedByName: string;
}

export type BehaviorRating = 'good' | 'neutral' | 'reactive' | 'na';
export type VolunteerOrientationStatus = 'pending' | 'emailed' | 'scheduled' | 'completed' | 'no_showed' | 'disqualified';

export interface DayTripLog {
	id: string;
	dogId: string;
	startedAt: DateValue;
	endedAt: DateValue | null;
	startedBy: string;
	startedByName: string;
	endedBy: string | null;
	endedByName: string | null;
	startNotes: string | null;
	endNotes: string | null;
	volunteerName?: string | null;
	reactionToDogs?: BehaviorRating | null;
	reactionToStrangers?: BehaviorRating | null;
	reactionToCats?: BehaviorRating | null;
	reactionToKids?: BehaviorRating | null;
	tripNotes?: string | null;
	source?: 'staff' | 'qr' | null;
	createdAt: DateValue;
	updatedAt: DateValue;
}

export interface Volunteer {
	id: string;
	name: string;
	email: string;
	submittedAt: string | null;
	hasDriversLicense: boolean;
	is18Plus: boolean;
	dogExperience: string;
	adventurePlans: string;
	photosOk: boolean;
	leashCommitment: boolean;
	orientationStatus: VolunteerOrientationStatus;
	waiverSigned: boolean;
	internalNotes: string;
	lastSyncedAt: DateValue;
	createdAt: DateValue;
	updatedAt: DateValue;
}

export type MealTime = 'am' | 'pm' | 'second';
export type AmountEaten = 'all' | 'most' | 'half' | 'little' | 'none';

export interface BathLog {
	id: string;
	timestamp: DateValue;
	loggedBy: string;
	loggedByName: string;
}

export interface FeedingLog {
	id: string;
	date: DateValue;
	mealTime: MealTime;
	amountEaten: AmountEaten;
	notes: string | null;
	loggedBy: string;
	loggedByName: string;
	createdAt: DateValue;
}

export interface StoolLog {
	id: string;
	timestamp: DateValue;
	stoolType: number;
	notes: string | null;
	loggedBy: string;
	loggedByName: string;
}

export type PlaygroupOutcome = 'successful' | 'mixed' | 'incident' | 'cancelled';
export type PlaygroupRecommendationType = 'ready_group' | 'evaluation_group' | 'manual';

export interface PlaygroupSession {
	id: string;
	date: DateValue;
	groupName: string;
	dogIds: string[];
	dogNames: string[];
	recommendationType: PlaygroupRecommendationType;
	outcome: PlaygroupOutcome;
	notes: string | null;
	durationMinutes: number | null;
	loggedBy: string;
	loggedByName: string;
	createdAt: DateValue;
}

export interface CleaningChecklistTask {
	id: string;
	description: string;
	order: number;
}

export interface CleaningChecklist {
	id: 'morning' | 'evening';
	tasks: CleaningChecklistTask[];
	updatedAt: DateValue;
}

export interface CleaningCompletion {
	id: string;
	date: DateValue;
	shift: 'morning' | 'evening';
	completedTasks: string[];
	lastUpdated: DateValue;
}
