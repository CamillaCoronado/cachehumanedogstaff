// Phone inbox core types (docs/phone-inbox-plan.md). Provider-agnostic: the
// webhook adapter turns a provider payload into an InboundMessage; everything
// downstream is the same for SMS and transcribed voicemail.

export interface InboundMessage {
	/** Sender in E.164, e.g. +14355550134 */
	from: string;
	channel: 'sms' | 'voice';
	/** SMS body, or the voicemail transcript */
	text: string;
	receivedAt: Date;
	/** Provider's message id, for idempotency/debugging */
	providerId?: string;
}

/** The staff profile a sender matched (allowlist hit). */
export interface StaffMatch {
	uid: string;
	displayName: string;
}

export type AmountEaten = 'all' | 'most' | 'half' | 'little' | 'none';

// Additive-only actions — never status changes like adoption/archive/isolation
// (safety rail). trip_return is the one operational toggle, explicitly in scope.
export type ParsedAction =
	| { type: 'feeding'; dogId: string; dogName: string; amountEaten: AmountEaten; mealTime: 'am' | 'pm'; notes: string | null }
	| { type: 'dog_note'; dogId: string; dogName: string; note: string }
	| { type: 'trip_return'; dogId: string; dogName: string; note: string | null }
	| { type: 'handoff_note'; note: string };

/** What the AI extracts before dog names are resolved against the roster. */
export type RawAction =
	| { type: 'feeding'; dogName: string; amountEaten: AmountEaten; mealTime: 'am' | 'pm' | null; notes: string | null }
	| { type: 'dog_note'; dogName: string; note: string }
	| { type: 'trip_return'; dogName: string; note: string | null }
	| { type: 'handoff_note'; note: string };

export interface ParseOutcome {
	actions: RawAction[];
	/** True when the model couldn't map the message to actions confidently. */
	unsure: boolean;
}

/** A proposal awaiting YES/NO from the sender. */
export interface PendingProposal {
	phone: string;
	staffUid: string;
	staffName: string;
	channel: 'sms' | 'voice';
	originalText: string;
	actions: ParsedAction[];
	createdAt: string;
	expiresAt: string;
}

export const PROPOSAL_TTL_MS = 15 * 60 * 1000;

/** Same PM boundary the cleaning page uses (1:30pm). */
export function currentShift(now: Date): 'morning' | 'evening' {
	return now.getHours() > 13 || (now.getHours() === 13 && now.getMinutes() >= 30) ? 'evening' : 'morning';
}
