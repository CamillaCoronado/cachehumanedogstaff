import type { InboundMessage, ParsedAction, ParseOutcome, PendingProposal, StaffMatch } from './types';
import { PROPOSAL_TTL_MS } from './types';
import {
	canceledReply,
	isNo,
	isYes,
	nothingPendingReply,
	notUnderstoodReply,
	proposalReply,
	savedReply,
	unknownSenderReply
} from './replies';
import { resolveActions } from './resolve';

// The pipeline is pure orchestration over injected dependencies, so it's fully
// unit-testable without Firestore or OpenAI. createFirestoreDeps() (deps.ts)
// provides the real implementations for the webhook routes.

export interface PipelineDeps {
	findStaffByPhone(phone: string): Promise<StaffMatch | null>;
	fetchRoster(): Promise<Array<{ id: string; name: string }>>;
	parse(text: string, dogNames: string[]): Promise<ParseOutcome>;
	getPending(phone: string): Promise<PendingProposal | null>;
	savePending(proposal: PendingProposal): Promise<void>;
	clearPending(phone: string): Promise<void>;
	applyActions(actions: ParsedAction[], staff: StaffMatch): Promise<void>;
	queueForReview(message: InboundMessage, staff: StaffMatch, reason: string): Promise<void>;
	now(): Date;
}

export interface PipelineResult {
	/** Text to send back to the sender (SMS). Null = send nothing. */
	reply: string | null;
	outcome: 'rejected' | 'proposed' | 'saved' | 'canceled' | 'nothing_pending' | 'review';
}

export async function handleInboundMessage(message: InboundMessage, deps: PipelineDeps): Promise<PipelineResult> {
	const staff = await deps.findStaffByPhone(message.from);
	if (!staff) {
		return { reply: unknownSenderReply(), outcome: 'rejected' };
	}

	const now = deps.now();

	if (isYes(message.text)) {
		const pending = await deps.getPending(message.from);
		if (!pending || new Date(pending.expiresAt) < now) {
			if (pending) await deps.clearPending(message.from);
			return { reply: nothingPendingReply(), outcome: 'nothing_pending' };
		}
		await deps.applyActions(pending.actions, staff);
		await deps.clearPending(message.from);
		return { reply: savedReply(pending.actions), outcome: 'saved' };
	}

	if (isNo(message.text)) {
		await deps.clearPending(message.from);
		return { reply: canceledReply(), outcome: 'canceled' };
	}

	// New update: parse → resolve names → propose (or queue for review).
	const roster = await deps.fetchRoster();
	let outcome: ParseOutcome;
	try {
		outcome = await deps.parse(message.text, roster.map((d) => d.name));
	} catch (e) {
		console.error('[phone inbox] parse failed:', e);
		await deps.queueForReview(message, staff, 'parse_error');
		return { reply: notUnderstoodReply(), outcome: 'review' };
	}

	const { actions, unmatchedNames } = resolveActions(outcome.actions, roster, now);
	if (outcome.unsure || unmatchedNames.length > 0 || actions.length === 0) {
		const reason =
			unmatchedNames.length > 0 ? `unknown dog name: ${unmatchedNames.join(', ')}` : 'could not parse';
		await deps.queueForReview(message, staff, reason);
		return { reply: notUnderstoodReply(), outcome: 'review' };
	}

	// Replaces any previous pending proposal for this phone.
	await deps.savePending({
		phone: message.from,
		staffUid: staff.uid,
		staffName: staff.displayName,
		channel: message.channel,
		originalText: message.text,
		actions,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString()
	});
	return { reply: proposalReply(actions), outcome: 'proposed' };
}
