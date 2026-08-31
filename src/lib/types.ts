import type { Timestamp } from 'firebase/firestore';

export type DateValue = Date | Timestamp;
export type UserRole = 'admin' | 'manager' | 'coordinator' | 'staff' | 'volunteer';

export interface UserProfile {
	uid: string;
	email: string;
	displayName: string;
	role: UserRole;
	/**
	 * Whether an admin has let this account in. Absent on accounts created before the
	 * approval gate — treat undefined as approved, matching isApproved() in firestore.rules.
	 */
	approved?: boolean;
	// E.164 (e.g. +14355550134) — the phone-inbox allowlist (docs/phone-inbox-plan.md)
	phoneNumber?: string | null;
	/** Newest syncEvents entry this user has been shown, so celebrations play once per person. */
	lastSeenSyncEventAt?: DateValue | null;
	createdAt: DateValue;
	updatedAt: DateValue;
}

export interface Treatment {
	id: string;
	/** The medication or procedure — "doxycycline", "ear flush". */
	name: string;
	/** What it's being given for — "URI", "diarrhea". This is the dog's reason for
	 *  being on the medical list; older records only have `name`. */
	condition?: string | null;
	notes?: string | null;
	startDate?: DateValue | null;
	endDate?: DateValue | null;
}

export type DogStatus = 'active' | 'adopted' | 'transferred' | 'euthanized';
export type DayTripStatus = 'ineligible' | 'difficult' | 'eligible';
export type DayTripIneligibleReason = 'behavior' | 'medical' | 'other';

// Reason a dog's day-trip color was set — mirrors the factors the color is otherwise
// calculated from, so a manual color reads consistently with a computed one.
export type TripColorReason =
	| 'behavior'
	| 'medical'
	| 'isolation'
	| 'sick'
	| 'awaiting_eval'
	| 'manager_only'
	| 'staff_only'
	| 'difficult'
	| 'other';
/** Observed play style — set by staff after watching the dog play, not derived
 *  from energy or size. Unset means the dog still needs a play assessment. */
export type DogPlayStyle = 'rough_and_rowdy' | 'gentle_and_dainty' | 'solo';
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
	/** App-uploaded photo gallery; photoUrl stays the primary/display photo. */
	photoUrls?: string[];
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
	/** ASM's reason-for-entry free text — why the dog came in / was returned. Staff-only, like hiddenComments. */
	entryReason?: string;
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
	/** Observed play styles (a dog can have more than one, e.g. rough with matched
	 *  dogs and gentle with small ones). Empty/unset = needs a play assessment. */
	playStyles?: DogPlayStyle[];
	/**
	 * Things that came in with the dog and have to leave with it — bed, toy, its own food,
	 * leftover meds. Kept as a plain list so the front desk can check them off at adoption.
	 */
	goHomeItems?: string[];
	outdoorKennelAssignment: string;
	/** Inside kennel assignment — free-text label parsed the same way as
	 *  outdoorKennelAssignment, but for the indoor sick/healthy-zone map. */
	insideKennelAssignment: string;
	microchipDate?: DateValue | null;
	healthProblems?: string;
	/** Marked (in Medical) as having fleas. On the inside kennel map this puts a
	 *  keep-empty flea buffer in the kennels on either side, since fleas can jump. While
	 *  fleas are set, handlingLevel is forced to staff-only. */
	hasFleas?: boolean;
	/** The handling level a dog had before a sick or flea hold forced it to staff-only,
	 *  restored when the hold clears. Null when the hold didn't change the level. */
	handlingLevelBeforeHold?: DogHandlingLevel | null;
	lastBathDate: DateValue | null;
	lastBathBy: string | null;
	/** Last logged yard time — counts as enrichment alongside day trips and playgroups. */
	lastYardDate?: DateValue | null;
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
	/** Vet-ordered fast: skip every meal through this date + meal (inclusive),
	 *  e.g. "fast tonight and tomorrow morning" → tomorrow's date, meal 'am'. */
	fastUntilDate?: DateValue | null;
	fastUntilMeal?: MealTime | null;
	fastReason?: string | null;
	isMicrochipped: boolean;
	isFixed: boolean;
	fixedDate: DateValue | null;
	isVaccinated: boolean;
	vaccineCount: number;
	/** Vaccinations still outstanding/overdue per ASM's schedule (VACCOUTSTANDINGCOUNT). */
	vaccinesOutstanding?: number;
	vaccinatedDate: DateValue | null;
	allergyTypes?: string[];
	dayTripStatus: DayTripStatus;
	dayTripIneligibleReason?: DayTripIneligibleReason | null;
	/** Why the dog is manager-only. Only meaningful when handlingLevel === 'manager_only'
	 *  (the handling level is the single source of truth for manager-only status). */
	dayTripManagerOnlyReason?: DayTripIneligibleReason | null;
	/** The dog's day-trip color — the single source of truth. Set by a manager (Colors tab)
	 *  or synced in from the sheet; `dogStripeColor` reads this, falling back to a computed
	 *  color when it's null. (Field name kept for back-compat.) */
	manualTripColor?: 'green' | 'yellow' | 'red' | null;
	/** Why the color was set (for red/yellow) — null for green or an unset color. */
	manualTripColorReason?: TripColorReason | null;
	/** Last color seen from the sheet, so a sheet change can update `manualTripColor` without
	 *  clobbering a manual change on every load. */
	lastSheetColor?: 'green' | 'yellow' | 'red' | null;
	/** Manager override letting an under-6-month puppy go on day trips before the 30-day gate. */
	dayTripPuppyOverride?: boolean;
	dayTripNotes: string | null;
	handlingLevel: DogHandlingLevel;
	inFoster: boolean;
	inFosterSince?: DateValue | null;
	shelterSince?: DateValue | null;
	playgroupReadyDate?: DateValue | null;
	awaitingEvaluation?: boolean;
	/** True once the sheet-color auto-clear has fired for this dog, so a later manual
	 *  re-check of awaitingEvaluation is respected and not auto-cleared again. */
	evaluationAutoCleared?: boolean;
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
	/** Outbreak "sick hold" — distinct from isolation (iso room). A sick-hold dog stays in
	 *  the normal kennel building and is still fed/handled by regular staff (with
	 *  precautions), but is grouped into the inside red zone and is staff-only, blocked from
	 *  playgroups/day-trips/yard, and not adoptable while held. All those effects are DERIVED
	 *  from this flag (handlingLevel/dayTripStatus are not mutated), so clearing it reverses
	 *  them with no residual state. */
	sickHold?: boolean;
	sickHoldReason?: string | null;
	sickHoldSince?: DateValue | null;
	/** Watch state — the step before treatment: the dog is being observed for symptoms
	 *  (or re-observed after finishing treatment/an outbreak). Purely informational (no
	 *  handling/playgroup/adoption effects). Mutually exclusive with sickHold, and
	 *  starting a treatment clears it. */
	sickMonitor?: boolean;
	sickMonitorReason?: string | null;
	sickMonitorSince?: DateValue | null;
	/** When the enrichment clock was last reset — stamped when a dog comes off an
	 *  isolation or sick hold, so it doesn't read as instantly overdue for enrichment
	 *  (which it couldn't get while held). The enrichment clock ignores time before this. */
	enrichmentResetDate?: DateValue | null;
	treatments?: Treatment[];
	/** When the ASM sync last wrote this dog (read-only — written by the sync,
	 *  preserved across app edits). For archived dogs this approximates the
	 *  archive date. */
	lastSyncedAt?: DateValue | null;
	// Deprecated single-treatment fields — kept for migration into `treatments`.
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

export type BehaviorRating = 'friendly' | 'neutral' | 'nervous' | 'excited' | 'reactive' | 'na';
export type VolunteerOrientationStatus = 'pending' | 'emailed' | 'scheduled' | 'signed_waiver' | 'answered_no' | 'no_showed';

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
	reactionToLeash?: BehaviorRating | null;
	reactionToCarRides?: BehaviorRating | null;
	reactionToToys?: BehaviorRating | null;
	tripNotes?: string | null;
	source?: 'staff' | 'qr' | null;
	createdAt: DateValue;
	updatedAt: DateValue;
}

export interface Volunteer {
	id: string;
	name: string;
	email: string;
	phone?: string | null;
	volunteerType?: 'dtv' | 'ihv';
	submittedAt: string | null;
	hasDriversLicense: boolean;
	is18Plus: boolean;
	dogExperience: string;
	adventurePlans: string;
	photosOk: boolean;
	leashCommitment: boolean;
	orientationStatus: VolunteerOrientationStatus;
	/**
	 * Set once someone changes the status from inside the app (e.g. marking a no-show at
	 * the front desk). The sheet sync then stops overwriting orientationStatus for this
	 * volunteer, so a manual call isn't silently undone on the next run.
	 */
	statusSetInApp?: boolean;
	isEstablished: boolean;
	isNonActive?: boolean;
	trainingSteps?: { point: boolean; pointPending: boolean; trained: boolean; computer: boolean; moved: boolean };
	sheetNotes?: string | null;
	orientationDate?: string | null;
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

export interface YardLog {
	id: string;
	timestamp: DateValue;
	durationMinutes: number | null;
	loggedBy: string;
	loggedByName: string;
}

/**
 * A feeding message from Slack, waiting for an admin to accept or dismiss it. Nothing
 * reaches a dog's history until someone approves it.
 */
export interface PendingFeeding {
	id: string;
	rawText: string;
	author: string;
	slackTs: string;
	postedAt: string;
	receivedAt: string;
	processed: boolean;
	entries: {
		dogId: string;
		dogName: string;
		amountEaten: AmountEaten;
		mealTime: MealTime;
		mealTimeInferred: boolean;
		/** Not named in the message — filled in because staff report only exceptions. */
		implied: boolean;
	}[];
}

/**
 * The morning surgery list read from Slack, waiting for an admin to accept it. Accepting
 * stamps surgeryDate on each dog, which is what keeps them off the morning feed list.
 */
export interface PendingSurgery {
	id: string;
	rawText: string;
	author: string;
	slackTs: string;
	postedAt: string;
	receivedAt: string;
	processed: boolean;
	dogs: { dogId: string; dogName: string }[];
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
