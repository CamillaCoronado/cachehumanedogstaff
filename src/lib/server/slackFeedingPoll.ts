import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import {
	buildDogIndex,
	feedingLogId,
	planFeedingsDetailed,
	shelterDay,
	planSurgery,
	type DogRecord,
	type PlannedFeeding
} from '$lib/data/feedingImport';

/** Where the last-read message timestamp lives, so each run starts where the last stopped. */
const CURSOR_DOC = 'syncState/slackFeedingCursor';
const USERS_DOC = 'syncState/slackUserNames';
/** A first run with no cursor takes this much history rather than the whole channel. */
const FIRST_RUN_DAYS = 2;
const MAX_MESSAGES = 200;

interface SlackMessage {
	ts: string;
	text?: string;
	user?: string;
	subtype?: string;
	bot_id?: string;
}

async function slack(token: string, method: string, params: Record<string, string>) {
	const url = new URL(`https://slack.com/api/${method}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	const body = await res.json();
	if (!body.ok) throw new Error(`slack ${method}: ${body.error}`);
	return body;
}

/**
 * Slack identifies authors by id. Names are cached because they rarely change and
 * users.list is rate-limited far more tightly than conversations.history.
 */
async function resolveAuthors(token: string, db: FirebaseFirestore.Firestore, ids: string[]) {
	const ref = db.doc(USERS_DOC);
	const snap = await ref.get();
	const cached: Record<string, string> = snap.exists ? (snap.data()?.names ?? {}) : {};
	if (ids.every((id) => id in cached)) return cached;

	try {
		const body = await slack(token, 'users.list', { limit: '500' });
		for (const u of body.members ?? []) {
			cached[u.id] = u.profile?.real_name || u.profile?.display_name || u.name || u.id;
		}
		await ref.set({ names: cached, updatedAt: new Date().toISOString() });
	} catch {
		// Keep whatever is cached; an unresolved id is better than dropping the message.
	}
	return cached;
}


export interface PollResult {
	scanned: number;
	/** Held back because the reading was uncertain; waiting on the Admin page. */
	queued: number;
	/** Written straight to the dogs' records, because the reading was plain. */
	applied: number;
	skipped?: string;
}

/**
 * Writes a report's logs, leaving alone any meal that already has one.
 *
 * A filled-in dog is an inference from the exceptions, so anything already standing —
 * a staff entry, an earlier report of the same feed — knows more than it does. A dog the
 * message actually named overwrites, since that is an observation.
 */
async function writeFeedings(
	db: FirebaseFirestore.Firestore,
	entries: PlannedFeeding[],
	postedAt: Date,
	author: string,
	rawText: string,
	slackTs: string
): Promise<number> {
	const notes = `via Slack — ${author}: "${rawText.slice(0, 180)}"`;
	const now = new Date().toISOString();
	let written = 0;

	for (let i = 0; i < entries.length; i += 200) {
		const chunk = entries.slice(i, i + 200);
		const existing = await Promise.all(
			chunk.map((e) =>
				db.collection('dogs').doc(e.dogId).collection('feedingLogs').get()
			)
		);

		const batch = db.batch();
		chunk.forEach((entry, j) => {
			// Compared on the shelter's calendar day, not the server's: an evening report
			// is already the next day in UTC, and would miss the log it should defer to.
			const day = shelterDay(postedAt);
			const already = existing[j].docs.some((d) => {
				const x = d.data();
				return x.mealTime === entry.mealTime && shelterDay(new Date(x.date)) === day;
			});
			if (entry.implied && already) return;

			const id = feedingLogId(postedAt, entry.dogId, entry.mealTime);
			batch.set(db.collection('dogs').doc(entry.dogId).collection('feedingLogs').doc(id), {
				id,
				date: postedAt.toISOString(),
				mealTime: entry.mealTime,
				amountEaten: entry.amountEaten,
				notes,
				loggedBy: 'slack-import',
				loggedByName: `${author} (via Slack)`,
				createdAt: now,
				source: 'slack',
				sourceTs: slackTs,
				mealTimeInferred: entry.mealTimeInferred,
				impliedFromExceptions: entry.implied
			});
			written++;
		});
		await batch.commit();
	}
	return written;
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
		return { scanned: 0, queued: 0, applied: 0, skipped: 'not configured' };
	}

	const db = getAdminDb();
	const cursorSnap = await db.doc(CURSOR_DOC).get();
	const lastTs: string | null = cursorSnap.exists ? (cursorSnap.data()?.ts ?? null) : null;
	const oldest = lastTs ?? String(Math.floor((Date.now() - FIRST_RUN_DAYS * 86_400_000) / 1000));

	const history = await slack(SLACK_BOT_TOKEN, 'conversations.history', {
		channel: SLACK_FEEDING_CHANNEL_ID,
		oldest,
		limit: String(MAX_MESSAGES)
	});

	// Slack returns newest first; oldest is inclusive, so drop the cursor message itself.
	const messages: SlackMessage[] = (history.messages ?? []).filter(
		(m: SlackMessage) =>
			m.subtype === undefined && m.bot_id === undefined && String(m.text ?? '').trim() && m.ts !== lastTs
	);
	if (messages.length === 0) return { scanned: 0, queued: 0, applied: 0 };

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
			'isolationStatus',
			'isIncoming',
			'surgeryDate',
			'nicknames'
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
			const note = `Surgery list via Slack — ${author}: "${String(m.text).slice(0, 180)}"`;
			const batch = db.batch();
			for (const dog of surgery) {
				batch.set(
					db.collection('dogs').doc(dog.dogId),
					{
						surgeryDate: postedAt.toISOString(),
						surgerySource: `slack:${slackTs}`,
						surgeryNote: note,
						updatedAt: new Date().toISOString()
					},
					{ merge: true }
				);
			}
			await batch.commit();

			// Recorded as already handled, so the Admin page can show what was applied
			// without asking anyone to approve it again.
			await db.collection('pendingSurgeries').doc(slackTs.replace('.', '-')).set({
				rawText: String(m.text),
				author,
				slackTs,
				postedAt: postedAt.toISOString(),
				receivedAt: new Date().toISOString(),
				processed: true,
				appliedAt: new Date().toISOString(),
				dogs: surgery
			});
			queued++;
			continue;
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

	return { scanned: messages.length, queued, applied };
}
