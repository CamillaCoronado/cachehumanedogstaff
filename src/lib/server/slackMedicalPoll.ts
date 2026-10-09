import { randomUUID } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import { isReport, newChannelMessages, resolveAuthors, type HistoryMessage } from '$lib/server/slackClient';
import { parseMedicalPost } from '$lib/server/slackMedicalParse';
import {
	planSlackMedical,
	resolveMedicalActions,
	type MedicalAction,
	type RawMedicalAction,
	type RosterDog,
	type RosterGroup
} from '$lib/utils/medicalSlack';
import { shelterToday } from '$lib/utils/medicalSync';

/** Where the last-read message timestamp lives, so each run starts where the last stopped. */
const CURSOR_DOC = 'syncState/slackMedicalCursor';
/** A first run with no cursor takes this much history rather than the whole channel. */
const FIRST_RUN_DAYS = 2;
/** Posts read per run, oldest first; the rest wait for the next sync, inside its time limit. */
const MAX_PER_RUN = 12;
export const PENDING_MEDICAL = 'pendingMedical';

export interface MedicalPollResult {
	scanned: number;
	/** Posts written straight to the dogs, because every dog matched and the reading was sure. */
	applied: number;
	/** Held back for an admin: an unknown dog, an unsure reading, or a failed read. */
	queued: number;
	skipped?: string;
}

/** A post waiting in the admin's Slack list. */
export interface PendingMedical {
	id: string;
	rawText: string;
	author: string;
	slackTs: string;
	postedAt: string;
	receivedAt: string;
	processed: boolean;
	reason: string;
	actions: RawMedicalAction[];
	unmatched: string[];
}

/** Active dogs at the shelter or in short-term foster, and the names standing for several. */
export async function medicalRoster(db: Firestore): Promise<{ roster: RosterDog[]; groups: RosterGroup[] }> {
	const [dogsSnap, groupsSnap] = await Promise.all([
		db.collection('dogs').select('name', 'nicknames', 'status', 'permanentFoster').get(),
		db.collection('dogGroups').get()
	]);
	const roster = dogsSnap.docs
		.filter((d) => d.data().status === 'active' && d.data().permanentFoster !== true && d.data().name)
		.map((d) => ({ id: d.id, name: String(d.data().name), nicknames: (d.data().nicknames as string[] | undefined) ?? [] }));
	const groups = groupsSnap.docs.map((d) => ({ name: String(d.data().name ?? ''), dogIds: (d.data().dogIds as string[]) ?? [] }));
	return { roster, groups };
}

/**
 * Writes a post's actions to its dogs. Additive only (see planSlackMedical); one-off
 * doses go to the dog's notes, keyed by the post so a re-read doesn't repeat them.
 * Returns how many dogs changed.
 */
export async function applyMedicalActions(
	db: Firestore,
	actions: MedicalAction[],
	postedAt: Date,
	author: string,
	slackTs: string
): Promise<number> {
	const byDog = new Map<string, MedicalAction[]>();
	for (const a of actions) byDog.set(a.dogId, [...(byDog.get(a.dogId) ?? []), a]);

	let changed = 0;
	for (const [dogId, list] of byDog) {
		const ref = db.collection('dogs').doc(dogId);
		const snap = await ref.get();
		if (!snap.exists) continue;
		const { patch, notes } = planSlackMedical(snap.data() ?? {}, list, shelterToday(postedAt), postedAt.toISOString(), randomUUID);
		if (patch) {
			await ref.set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
		}
		for (const [i, note] of notes.entries()) {
			const id = `slack-med-${slackTs.replace('.', '-')}-${i}`;
			await ref.collection('behavioralNotes').doc(id).set({
				id,
				note: `Medical: ${note}`,
				createdAt: postedAt.toISOString(),
				loggedBy: 'slack',
				loggedByName: author
			});
		}
		if (patch || notes.length > 0) changed++;
	}
	return changed;
}

/**
 * Reads new #medical-updates posts into the Medical page. Called by the ASM sync every
 * user triggers and by the daily cron, like the feeding and playgroup polls.
 */
export async function pollSlackMedical(): Promise<MedicalPollResult> {
	const { SLACK_BOT_TOKEN, SLACK_MEDICAL_CHANNEL_ID } = env;
	if (!SLACK_BOT_TOKEN || !SLACK_MEDICAL_CHANNEL_ID) return { scanned: 0, applied: 0, queued: 0, skipped: 'not configured' };
	if (!env.OPENAI_API_KEY) return { scanned: 0, applied: 0, queued: 0, skipped: 'OPENAI_API_KEY not configured' };

	const db = getAdminDb();
	const cursorSnap = await db.doc(CURSOR_DOC).get();
	const lastTs: string | null = cursorSnap.exists ? (cursorSnap.data()?.ts ?? null) : null;
	const fresh: HistoryMessage[] = await newChannelMessages(SLACK_BOT_TOKEN, SLACK_MEDICAL_CHANNEL_ID, lastTs, FIRST_RUN_DAYS);
	if (fresh.length === 0) return { scanned: 0, applied: 0, queued: 0 };

	// Oldest first, so a post that updates an earlier one is read after it, and a capped
	// run leaves the newest for next time rather than skipping the middle.
	const batch = fresh.sort((a, b) => Number(a.ts) - Number(b.ts)).slice(0, MAX_PER_RUN);
	const posts = batch.filter(isReport);

	const { roster, groups } = await medicalRoster(db);
	const authors = await resolveAuthors(SLACK_BOT_TOKEN, db, [...new Set(posts.map((m) => String(m.user ?? '')))]);

	// Read in parallel: one model call per post, inside the sync's time limit.
	const readings = await Promise.all(
		posts.map((m) =>
			parseMedicalPost(String(m.text ?? '').trim(), roster.map((d) => d.name)).catch((e: unknown) => {
				console.error('[slack medical parse]', e);
				return null;
			})
		)
	);

	let applied = 0;
	let queued = 0;
	for (const [i, m] of posts.entries()) {
		const slackTs = String(m.ts);
		const rawText = String(m.text ?? '').trim();
		const postedAt = new Date(Number(slackTs) * 1000);
		const author = authors[String(m.user ?? '')] ?? 'Unknown';
		const queue = (reason: string, actions: RawMedicalAction[], unmatched: string[]) =>
			db.collection(PENDING_MEDICAL).doc(slackTs.replace('.', '-')).set({
				rawText,
				author,
				slackTs,
				postedAt: postedAt.toISOString(),
				receivedAt: new Date().toISOString(),
				processed: false,
				reason,
				actions,
				unmatched
			});

		const parsed = readings[i];
		if (!parsed) {
			// Kept for an admin rather than lost or retried forever.
			await queue("Couldn't read this post automatically.", [], []);
			queued++;
			continue;
		}
		if (parsed.actions.length === 0 && !parsed.unsure) continue; // not about a dog's care

		const { actions, unmatched } = resolveMedicalActions(parsed.actions, roster, groups);
		if (parsed.unsure || unmatched.length > 0) {
			const why = [
				parsed.unsure ? 'The reading is unsure.' : '',
				unmatched.length ? `No dog in the app called ${unmatched.map((n) => `"${n}"`).join(', ')}.` : ''
			].filter(Boolean);
			await queue(why.join(' '), parsed.actions, unmatched);
			queued++;
			continue;
		}
		await applyMedicalActions(db, actions, postedAt, author, slackTs);
		applied++;
	}

	const newest = batch[batch.length - 1].ts;
	await db.doc(CURSOR_DOC).set({ ts: newest, updatedAt: new Date().toISOString() });
	return { scanned: batch.length, applied, queued };
}
