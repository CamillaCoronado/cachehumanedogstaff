import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin';
import { channelHistory, resolveAuthors } from '$lib/server/slackClient';
import { applySurgeryList, writeBaths, writeFeedings, writeYard } from '$lib/server/slackWriters';
import {
	bathLogId,
	buildDogIndex,
	feedingDate,
	feedingLogId,
	planBaths,
	planFeedingsDetailed,
	planSurgery,
	planYardTime,
	shelterDay,
	yardLogId,
	type DogRecord
} from '$lib/data/feedingImport';

/** Stops a very long range from running past the function's time limit (3,000 messages). */
const MAX_PAGES = 15;

export type StaffKind = 'surgery' | 'bath' | 'yard' | 'feeding';
export const STAFF_KINDS: StaffKind[] = ['surgery', 'bath', 'yard', 'feeding'];

export interface StaffBackfillRow {
	/** `${kind}|${slackTs}` — what the admin ticks to keep. */
	key: string;
	kind: StaffKind;
	/** When it happened (a "yesterday" bath is dated back). */
	at: string;
	author: string;
	text: string;
	/** What would be logged, in words. */
	summary: string;
	/** Why the reading needs a look — shown, and the row starts unticked. */
	uncertain: string[];
}

export interface StaffBackfillResult {
	scanned: number;
	rows: StaffBackfillRow[];
	/** Reports found that are already fully logged — left alone. */
	alreadyLogged: Record<StaffKind, number>;
	/** Records written this run; all 0 on a dry run. */
	written: Record<StaffKind, number>;
	truncated: boolean;
	threadsSkipped: number;
	skipped?: string;
}

const zero = (): Record<StaffKind, number> => ({ surgery: 0, bath: 0, yard: 0, feeding: 0 });
const names = (list: { dogName: string }[]) => list.map((d) => d.dogName).join(', ');
const MEAL = { am: 'morning', pm: 'afternoon', second: 'second meal' } as const;

/**
 * Replays #dog-staff (thread replies included) from `since` through the live poll's own
 * readers and writers: surgery lists, baths, yard time and feedings. Anything already
 * logged is skipped. With dryRun nothing is written; otherwise only rows in `keep` are.
 *
 * Uncertain feeding readings — the ones the live poll holds for review — are listed
 * unticked with the reason, and written directly if the admin ticks them.
 */
export async function backfillDogStaff(
	since: Date,
	dryRun: boolean,
	kinds: StaffKind[],
	keep?: string[]
): Promise<StaffBackfillResult> {
	const empty: StaffBackfillResult = { scanned: 0, rows: [], alreadyLogged: zero(), written: zero(), truncated: false, threadsSkipped: 0 };
	const { SLACK_BOT_TOKEN, SLACK_FEEDING_CHANNEL_ID } = env;
	if (!SLACK_BOT_TOKEN || !SLACK_FEEDING_CHANNEL_ID) return { ...empty, skipped: 'not configured' };

	const db = getAdminDb();
	const { messages, truncated, threadsSkipped } = await channelHistory(SLACK_BOT_TOKEN, SLACK_FEEDING_CHANNEL_ID, since, MAX_PAGES, true);
	if (messages.length === 0) return { ...empty, truncated, threadsSkipped };

	const [dogsSnap, groupsSnap, surgeriesSnap] = await Promise.all([
		db.collection('dogs').get(),
		db.collection('dogGroups').get(),
		db.collection('pendingSurgeries').select().get()
	]);
	const index = buildDogIndex(
		dogsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DogRecord, 'id'>) })),
		groupsSnap.docs.map((d) => ({ name: d.data().name, dogIds: d.data().dogIds ?? [] }))
	);
	const authors = await resolveAuthors(SLACK_BOT_TOKEN, db, [...new Set(messages.map((m) => String(m.user ?? '')))]);
	const surgeryDone = new Set(surgeriesSnap.docs.map((d) => d.id));

	// What each dog already has, read once: log ids, and meals already logged by anyone.
	const logs = new Map<string, { bath: Set<string>; yard: Set<string>; feed: Set<string>; mealDays: Set<string> }>();
	const dogIds = dogsSnap.docs.map((d) => d.id);
	for (let i = 0; i < dogIds.length; i += 20) {
		const ids = dogIds.slice(i, i + 20);
		const snaps = await Promise.all(
			ids.map((id) =>
				Promise.all([
					kinds.includes('bath') ? db.collection('dogs').doc(id).collection('bathLogs').select().get() : null,
					kinds.includes('yard') ? db.collection('dogs').doc(id).collection('yardLogs').select().get() : null,
					kinds.includes('feeding') ? db.collection('dogs').doc(id).collection('feedingLogs').select('date', 'mealTime').get() : null
				])
			)
		);
		snaps.forEach(([b, y, f], j) => {
			const mealDays = new Set<string>();
			f?.docs.forEach((d) => {
				const x = d.data();
				if (x.date && x.mealTime) mealDays.add(`${x.mealTime}|${shelterDay(new Date(x.date))}`);
			});
			logs.set(ids[j], {
				bath: new Set(b?.docs.map((d) => d.id) ?? []),
				yard: new Set(y?.docs.map((d) => d.id) ?? []),
				feed: new Set(f?.docs.map((d) => d.id) ?? []),
				mealDays
			});
		});
	}
	const has = (dogId: string, set: 'bath' | 'yard' | 'feed', id: string) => logs.get(dogId)?.[set].has(id) ?? false;

	type Plan = StaffBackfillRow & { run: () => Promise<number> };
	const plans: Plan[] = [];
	const alreadyLogged = zero();

	for (const m of [...messages].sort((a, b) => Number(a.ts) - Number(b.ts))) {
		const ts = String(m.ts);
		const text = String(m.text);
		const postedAt = new Date(Number(ts) * 1000);
		const author = authors[String(m.user ?? '')] ?? 'Unknown';
		const base = { author, text: text.slice(0, 200), uncertain: [] as string[] };

		// As in the live poll: a surgery list is only that — never also read as a feed.
		const surgery = planSurgery(text, postedAt, index);
		if (surgery.length > 0) {
			if (!kinds.includes('surgery')) continue;
			if (surgeryDone.has(ts.replace('.', '-'))) {
				alreadyLogged.surgery++;
				continue;
			}
			plans.push({
				...base, key: `surgery|${ts}`, kind: 'surgery', at: postedAt.toISOString(),
				summary: `surgery list: ${names(surgery)}`,
				run: async () => (await applySurgeryList(db, surgery, text, postedAt, author, ts, true), 1)
			});
			continue;
		}

		if (kinds.includes('bath')) {
			const all = planBaths(text, postedAt, index);
			const todo = all.filter((b) => !has(b.dogId, 'bath', bathLogId(b.at, b.dogId)));
			if (all.length > 0 && todo.length === 0) alreadyLogged.bath++;
			if (todo.length > 0) {
				plans.push({
					...base, key: `bath|${ts}`, kind: 'bath', at: todo[0].at.toISOString(),
					summary: `bath: ${names(todo)}`,
					run: () => writeBaths(db, todo, author, ts)
				});
			}
		}

		if (kinds.includes('yard')) {
			const all = planYardTime(text, postedAt, index);
			const todo = all.filter((y) => !has(y.dogId, 'yard', yardLogId(postedAt, y.dogId)));
			if (all.length > 0 && todo.length === 0) alreadyLogged.yard++;
			if (todo.length > 0) {
				plans.push({
					...base, key: `yard|${ts}`, kind: 'yard', at: postedAt.toISOString(),
					summary: `yard time: ${names(todo)}`,
					run: () => writeYard(db, todo, postedAt, author, ts)
				});
			}
		}

		if (kinds.includes('feeding')) {
			const plan = planFeedingsDetailed(text, postedAt, index);
			if (plan.entries.length > 0) {
				const meal = plan.entries[0].mealTime;
				const fedAt = feedingDate(postedAt, meal);
				const mealDay = `${meal}|${shelterDay(fedAt)}`;
				const named = plan.entries.filter((e) => !e.implied && !has(e.dogId, 'feed', feedingLogId(fedAt, e.dogId, meal)));
				// The writer leaves a filled-in dog alone if its meal is already logged.
				const implied = plan.entries.filter((e) => e.implied && !(logs.get(e.dogId)?.mealDays.has(mealDay) ?? false));
				if (named.length === 0 && implied.length === 0) {
					alreadyLogged.feeding++;
				} else {
					const namedText = named.map((e) => `${e.dogName} ${e.amountEaten === 'none' ? "didn't eat" : `ate ${e.amountEaten}`}`).join(', ');
					plans.push({
						...base, key: `feeding|${ts}`, kind: 'feeding', at: fedAt.toISOString(),
						summary: `${MEAL[meal]}${namedText ? ` · ${namedText}` : ''}${implied.length ? ` · ${implied.length} others ate all` : ''}`,
						uncertain: plan.uncertain,
						run: () => writeFeedings(db, plan.entries, postedAt, author, text, ts)
					});
				}
			}
		}
	}

	const rows = plans.map(({ run: _run, ...row }) => row);
	const result: StaffBackfillResult = { scanned: messages.length, rows, alreadyLogged, written: zero(), truncated, threadsSkipped };
	if (dryRun) return result;

	const kept = new Set(keep ?? []);
	for (const p of plans) {
		if (!kept.has(p.key)) continue;
		result.written[p.kind] += await p.run();
	}
	return result;
}
