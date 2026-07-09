import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleInboundMessage, type PipelineDeps } from './pipeline';
import { resolveActions } from './resolve';
import { isNo, isYes, proposalReply } from './replies';
import type { InboundMessage, ParsedAction, PendingProposal } from './types';

// Camilla's number stands in for any registered staff phone (E.164).
const STAFF_PHONE = '+14355550134';
const STRANGER_PHONE = '+19995550000';
const NOW = new Date('2026-07-05T18:00:00'); // 6pm local → PM meal default

const ROSTER = [
	{ id: 'dog-buddy', name: 'Buddy' },
	{ id: 'dog-luna', name: 'Luna (Loo)' }
];

function makeMessage(text: string, from = STAFF_PHONE): InboundMessage {
	return { from, channel: 'sms', text, receivedAt: NOW };
}

function makeDeps(overrides: Partial<PipelineDeps> = {}) {
	const state: { pending: PendingProposal | null; applied: ParsedAction[][]; reviewed: string[] } = {
		pending: null,
		applied: [],
		reviewed: []
	};
	const deps: PipelineDeps = {
		findStaffByPhone: vi.fn(async (phone: string) =>
			phone === STAFF_PHONE ? { uid: 'u-cam', displayName: 'Camilla' } : null
		),
		fetchRoster: async () => ROSTER,
		parse: vi.fn(async () => ({
			actions: [{ type: 'feeding' as const, dogName: 'Buddy', amountEaten: 'none' as const, mealTime: null, notes: null }],
			unsure: false
		})),
		getPending: async () => state.pending,
		savePending: async (p) => {
			state.pending = p;
		},
		clearPending: async () => {
			state.pending = null;
		},
		applyActions: async (actions) => {
			state.applied.push(actions);
		},
		queueForReview: async (_m, _s, reason) => {
			state.reviewed.push(reason);
		},
		now: () => NOW,
		...overrides
	};
	return { deps, state };
}

beforeEach(() => vi.restoreAllMocks());

describe('handleInboundMessage', () => {
	it('rejects unknown senders and stores nothing', async () => {
		const { deps, state } = makeDeps();
		const result = await handleInboundMessage(makeMessage('Buddy didnt eat', STRANGER_PHONE), deps);
		expect(result.outcome).toBe('rejected');
		expect(result.reply).toContain('not registered');
		expect(state.pending).toBeNull();
		expect(state.reviewed).toHaveLength(0);
	});

	it('proposes but does NOT write until YES', async () => {
		const { deps, state } = makeDeps();
		const result = await handleInboundMessage(makeMessage("Buddy didn't eat tonight"), deps);
		expect(result.outcome).toBe('proposed');
		expect(result.reply).toContain('Reply YES to save');
		expect(result.reply).toContain("Buddy — didn't eat (PM)");
		expect(state.applied).toHaveLength(0); // nothing written yet
		expect(state.pending?.actions[0]).toMatchObject({ type: 'feeding', dogId: 'dog-buddy', amountEaten: 'none' });
	});

	it('YES applies the pending actions and clears the proposal', async () => {
		const { deps, state } = makeDeps();
		await handleInboundMessage(makeMessage("Buddy didn't eat"), deps);
		const result = await handleInboundMessage(makeMessage('yes'), deps);
		expect(result.outcome).toBe('saved');
		expect(state.applied).toHaveLength(1);
		expect(state.pending).toBeNull();
	});

	it('NO cancels without writing', async () => {
		const { deps, state } = makeDeps();
		await handleInboundMessage(makeMessage("Buddy didn't eat"), deps);
		const result = await handleInboundMessage(makeMessage('no'), deps);
		expect(result.outcome).toBe('canceled');
		expect(state.applied).toHaveLength(0);
		expect(state.pending).toBeNull();
	});

	it('YES with an expired proposal saves nothing', async () => {
		const { deps, state } = makeDeps();
		await handleInboundMessage(makeMessage("Buddy didn't eat"), deps);
		state.pending!.expiresAt = new Date(NOW.getTime() - 1000).toISOString();
		const result = await handleInboundMessage(makeMessage('YES'), deps);
		expect(result.outcome).toBe('nothing_pending');
		expect(state.applied).toHaveLength(0);
		expect(state.pending).toBeNull(); // stale proposal cleaned up
	});

	it('YES with nothing pending explains itself', async () => {
		const { deps } = makeDeps();
		const result = await handleInboundMessage(makeMessage('yes'), deps);
		expect(result.outcome).toBe('nothing_pending');
	});

	it('a new message replaces the previous pending proposal', async () => {
		const { deps, state } = makeDeps();
		await handleInboundMessage(makeMessage('first update'), deps);
		const first = state.pending;
		await handleInboundMessage(makeMessage('second update'), deps);
		expect(state.pending?.originalText).toBe('second update');
		expect(state.pending).not.toBe(first);
		expect(state.applied).toHaveLength(0);
	});

	it('unknown dog names go to review, not to a guess', async () => {
		const { deps, state } = makeDeps({
			parse: async () => ({
				actions: [{ type: 'dog_note', dogName: 'Ghost', note: 'limping' }],
				unsure: false
			})
		});
		const result = await handleInboundMessage(makeMessage('Ghost is limping'), deps);
		expect(result.outcome).toBe('review');
		expect(state.reviewed[0]).toContain('Ghost');
		expect(state.pending).toBeNull();
	});

	it('parser uncertainty or errors also land in review', async () => {
		const unsure = makeDeps({ parse: async () => ({ actions: [], unsure: true }) });
		expect((await handleInboundMessage(makeMessage('gibberish'), unsure.deps)).outcome).toBe('review');
		expect(unsure.state.reviewed).toEqual(['could not parse']);

		const failing = makeDeps({
			parse: async () => {
				throw new Error('api down');
			}
		});
		expect((await handleInboundMessage(makeMessage('anything'), failing.deps)).outcome).toBe('review');
		expect(failing.state.reviewed).toEqual(['parse_error']);
	});
});

describe('resolveActions', () => {
	it('matches roster names (including parenthetical aliases) and defaults the meal', () => {
		const { actions, unmatchedNames } = resolveActions(
			[
				{ type: 'feeding', dogName: 'buddy', amountEaten: 'none', mealTime: null, notes: null },
				{ type: 'trip_return', dogName: 'Luna', note: 'great with kids' },
				{ type: 'handoff_note', note: 'gate latch is loose' }
			],
			ROSTER,
			NOW
		);
		expect(unmatchedNames).toEqual([]);
		expect(actions[0]).toMatchObject({ type: 'feeding', dogId: 'dog-buddy', mealTime: 'pm' });
		expect(actions[1]).toMatchObject({ type: 'trip_return', dogId: 'dog-luna' });
		expect(actions[2]).toMatchObject({ type: 'handoff_note' });
	});

	it('reports unmatched names instead of dropping them', () => {
		const { actions, unmatchedNames } = resolveActions(
			[{ type: 'dog_note', dogName: 'Nobody', note: 'x' }],
			ROSTER,
			NOW
		);
		expect(actions).toHaveLength(0);
		expect(unmatchedNames).toEqual(['Nobody']);
	});
});

describe('YES/NO matching', () => {
	it('accepts natural variants and rejects content messages', () => {
		for (const t of ['yes', 'YES', ' y ', 'Yep!', 'ok', 'confirm']) expect(isYes(t)).toBe(true);
		for (const t of ['no', 'N', 'nope', 'cancel', 'STOP']) expect(isNo(t)).toBe(true);
		expect(isYes('yes Buddy ate all')).toBe(false);
		expect(isNo('no food left in bin')).toBe(false);
	});
});

describe('proposalReply', () => {
	it('lists every action and the YES/NO instruction', () => {
		const reply = proposalReply([
			{ type: 'feeding', dogId: 'd1', dogName: 'Buddy', amountEaten: 'none', mealTime: 'pm', notes: null },
			{ type: 'handoff_note', note: 'freezer door ajar' }
		]);
		expect(reply).toContain("• Buddy — didn't eat (PM)");
		expect(reply).toContain('• Handoff note: freezer door ajar');
		expect(reply).toContain('Reply YES to save, NO to cancel.');
	});
});
