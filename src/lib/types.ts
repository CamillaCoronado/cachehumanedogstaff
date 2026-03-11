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

export type DogStatus = 'active' | 'adopted';
export type DayTripStatus = 'ineligible' | 'difficult' | 'eligible';
export type DayTripIneligibleReason = 'behavior' | 'medical' | 'other';
export type IsolationStatus = 'none' | 'sick' | 'bite_quarantine';
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
	origin: string;
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
	isMicrochipped: boolean;
	isFixed: boolean;
	fixedDate: DateValue | null;
	isVaccinated: boolean;
	vaccinatedDate: DateValue | null;
	dayTripStatus: DayTripStatus;
	dayTripIneligibleReason?: DayTripIneligibleReason | null;
	dayTripManagerOnly: boolean;
	dayTripManagerOnlyReason?: DayTripIneligibleReason | null;
	dayTripNotes: string | null;
	handlingLevel: DogHandlingLevel;
	inFoster: boolean;
	isolationStatus: IsolationStatus;
	isolationStartDate: DateValue | null;
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
	createdAt: DateValue;
	updatedAt: DateValue;
}

export type MealTime = 'am' | 'pm';
export type AmountEaten = 'all' | 'most' | 'half' | 'little' | 'none';

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
