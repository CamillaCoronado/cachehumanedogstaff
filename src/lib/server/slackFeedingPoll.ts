import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import { newChannelMessages, resolveAuthors } from '$lib/server/slackClient';
import {
	buildDogIndex,
	planBaths,
	planYardTime,
	planFeedingsDetailed,
	planSurgery,
	type DogRecord
} from '$lib/data/feedingImport';
import { applySurgeryList, writeBaths, writeFeedings, writeYard } from '$lib/server/slackWriters';

/** Where the last-read message timestamp lives, so each run starts where the last stopped. */
const CURSOR_DOC = 'syncState/slackFeedingCursor';
/** A first run with no cursor takes this much history rather than the whole channel. */
const FIRST_RUN_DAYS = 2;

interface SlackMessage {
	ts: string;
	text?: string;
	user?: string;
	subtype?: string;
	bot_id?: string;
}

export interface PollResult {
	scanned: number;
	/** Baths written from reports like "Roe got a bath". */
	baths: number;
	/** Yard time written from reports like "sally pickles Ann got yard time". */
	yard: number;
	/** Held back because the reading was uncertain; waiting on the Admin page. */
	queued: number;
	/** Written straight to the dogs' records, because the reading was plain. */
	applied: number;
	skipped?: string;
}


/**
 * Pulls new feeding reports from Slack and queues them for admin approval.
 *
 * Reading uses the bot token the app already has, so there is no public endpoint for
 * anyone to post to and nothing to configure in Slack. Called both by the daily cron and
 * by the ASM sync every user triggers on load, which is what keeps the queue current —
 * Hobby plans allow only one cron run a day.
 */
export async function pollSlackFeedings(): Promise<PollResult> {
	const { SLACK_BOT_TOKEN, SLACK_FEEDING_CHANNEL_ID } = env;
	if (!SLACK_BOT_TOKEN || !SLACK_FEEDING_CHANNEL_ID) {
	return { scanned: 0, queued: 0, applied: 0, baths: 0, yard: 0, skipped: 'not configured' };
	}

	const db = getAdminDb();
	const cursorSnap = await db.doc(CURSOR_DOC).get();
	const lastTs: string | null = cursorSnap.exists ? (cursorSnap.data()?.ts ?? null) : null;
	// New messages and new thread replies since the cursor, newest first.
	const messages: SlackMessage[] = await newChannelMessages(SLACK_BOT_TOKEN, SLACK_FEEDING_CHANNEL_ID, lastTs, FIRST_RUN_DAYS);
	if (messages.length === 0) return { scanned: 0, queued: 0, applied: 0, baths: 0, yard: 0 };

	const [dogsSnap, groupsSnap] = await Promise.all([
		db.collection('dogs')
		.select(
			'name',
			'intakeDate',
			'leftShelterDate',
			'status',
			'asmShelterCode',
			'inFoster',
			'permanentFoster',
			'inFosterSince',
			'shelterSince',
			'fosterReturnedAt',
			'isolationStatus',
			'isIncoming',
			'surgeryDate',
			'nicknames',
			'hasSecondMeal'
		)
			.get(),
		db.collection('dogGroups').get()
	]);
	const index = buildDogIndex(
		dogsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DogRecord, 'id'>) })),
		groupsSnap.docs.map((d) => ({ name: d.data().name, dogIds: d.data().dogIds ?? [] }))
	);

	const authors = await resolveAuthors(SLACK_BOT_TOKEN, db, [
		...new Set(messages.map((m) => String(m.user ?? '')))
	]);

	let queued = 0;
	let applied = 0;
	let baths = 0;
	let yard = 0;
	for (const m of messages) {
		const slackTs = String(m.ts);
		const postedAt = new Date(Number(slackTs) * 1000);

		// The surgery list arrives as a "do not feed" instruction, so it is checked first
		// and separately: it says who is fasting, not who ate.
		//
		// Applied straight away rather than queued for approval. It lands at 9am and the
		// morning feed follows shortly after; a list waiting on a click could easily be
		// approved after someone has already fed a dog that must not eat. The stamp
		// records where it came from, so a wrong one can be found and undone.
		const surgery = planSurgery(String(m.text), postedAt, index);
		if (surgery.length > 0) {
			const author = authors[String(m.user ?? '')] ?? 'Unknown';
			await applySurgeryList(db, surgery, String(m.text), postedAt, author, slackTs);
			queued++;
			continue;
		}

		// Baths are reported plainly and the parser rejects the many messages naming one
		// that has not happened, so these are written on arrival like the surgery list.
		// A message can report a bath and a feeding at once, so this does not short-circuit.
		const bathed = planBaths(String(m.text), postedAt, index);
		if (bathed.length > 0) {
			baths += await writeBaths(db, bathed, authors[String(m.user ?? '')] ?? 'Unknown', slackTs);
		}

		// Yard time is enrichment, and the only kind with no path into the app but by hand.
		// Written on arrival: the parser rejects instructions and, most importantly, the
		// inverse — "No dogs got yard time" reads almost identically to a blanket.
		const inYard = planYardTime(String(m.text), postedAt, index);
		if (inYard.length > 0) {
			yard += await writeYard(db, inYard, postedAt, authors[String(m.user ?? '')] ?? 'Unknown', slackTs);
		}

		const plan = planFeedingsDetailed(String(m.text), postedAt, index);
		if (plan.entries.length === 0) continue; // nothing about a specific dog eating

		const author = authors[String(m.user ?? '')] ?? 'Unknown';

		// A plain report is written on arrival. Most are: exceptions named outright, every
		// dog matched by name. Holding those for approval only delays the record and
		// buries the few readings that genuinely need a decision.
		if (plan.uncertain.length === 0) {
			applied += await writeFeedings(db, plan.entries, postedAt, author, String(m.text), slackTs);
			continue;
		}

		// Keyed by message, so a re-poll of the same message updates rather than duplicates.
		await db.collection('pendingFeedings').doc(slackTs.replace('.', '-')).set({
			rawText: String(m.text),
			author,
			slackTs,
			postedAt: postedAt.toISOString(),
			receivedAt: new Date().toISOString(),
			processed: false,
			uncertain: plan.uncertain,
			entries: plan.entries
		});
		queued++;
	}

	// Advance past everything scanned, not just what queued — a message that said nothing
	// about feeding should not be looked at again on the next run.
	const newest = messages.reduce((max, m) => (Number(m.ts) > Number(max) ? String(m.ts) : max), lastTs ?? '0');
	await db.doc(CURSOR_DOC).set({ ts: newest, updatedAt: new Date().toISOString() });

	return { scanned: messages.length, queued, applied, baths, yard };
}
