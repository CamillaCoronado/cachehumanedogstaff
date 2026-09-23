import {
	bathLogId,
	feedingDate,
	feedingLogId,
	shelterDay,
	yardLogId,
	type PlannedBath,
	type PlannedFeeding,
	type PlannedSurgery,
	type PlannedYard
} from '$lib/data/feedingImport';

/**
 * How a Slack report becomes records — shared by the live poll and the Admin backfill,
 * so a report is written the same way whichever of them reads it.
 */

type Db = FirebaseFirestore.Firestore;

/**
 * Marks the day's surgery dogs, and records the list as already applied so the Admin
 * page can show it. `onlyForward` keeps a later surgery date: the backfill replays old
 * lists, which must not pull a dog's surgery date back.
 */
export async function applySurgeryList(
	db: Db,
	surgery: PlannedSurgery[],
	text: string,
	postedAt: Date,
	author: string,
	slackTs: string,
	onlyForward = false
): Promise<void> {
	const note = `Surgery list via Slack — ${author}: "${text.slice(0, 180)}"`;
	const current = onlyForward ? await Promise.all(surgery.map((d) => db.collection('dogs').doc(d.dogId).get())) : [];
	const batch = db.batch();
	surgery.forEach((dog, i) => {
		if (onlyForward) {
			const existing = current[i].data()?.surgeryDate;
			if (existing && new Date(existing).getTime() >= postedAt.getTime()) return;
		}
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
	});
	await batch.commit();

	await db.collection('pendingSurgeries').doc(slackTs.replace('.', '-')).set({
		rawText: text,
		author,
		slackTs,
		postedAt: postedAt.toISOString(),
		receivedAt: new Date().toISOString(),
		processed: true,
		appliedAt: new Date().toISOString(),
		dogs: surgery
	});
}

/** Logs baths; a dog's lastBathDate only moves forward. */
export async function writeBaths(db: Db, bathed: PlannedBath[], author: string, slackTs: string): Promise<number> {
	const loggedByName = `${author} (via Slack)`;
	const current = await Promise.all(bathed.map((d) => db.collection('dogs').doc(d.dogId).get()));
	const batch = db.batch();
	bathed.forEach((dog, i) => {
		const id = bathLogId(dog.at, dog.dogId);
		batch.set(db.collection('dogs').doc(dog.dogId).collection('bathLogs').doc(id), {
			id,
			timestamp: dog.at.toISOString(),
			loggedBy: 'slack-import',
			loggedByName,
			source: 'slack',
			sourceTs: slackTs
		});
		const existing = current[i].data()?.lastBathDate;
		if (!existing || new Date(existing).getTime() < dog.at.getTime()) {
			batch.set(db.collection('dogs').doc(dog.dogId), { lastBathDate: dog.at.toISOString(), lastBathBy: loggedByName }, { merge: true });
		}
	});
	await batch.commit();
	return bathed.length;
}

/** Logs yard time; a dog's lastYardDate only moves forward. */
export async function writeYard(db: Db, inYard: PlannedYard[], postedAt: Date, author: string, slackTs: string): Promise<number> {
	const current = await Promise.all(inYard.map((d) => db.collection('dogs').doc(d.dogId).get()));
	const batch = db.batch();
	inYard.forEach((dog, i) => {
		const id = yardLogId(postedAt, dog.dogId);
		batch.set(db.collection('dogs').doc(dog.dogId).collection('yardLogs').doc(id), {
			id,
			timestamp: postedAt.toISOString(),
			durationMinutes: dog.durationMinutes,
			loggedBy: 'slack-import',
			loggedByName: `${author} (via Slack)`,
			source: 'slack',
			sourceTs: slackTs
		});
		const existing = current[i].data()?.lastYardDate;
		if (!existing || new Date(existing).getTime() < postedAt.getTime()) {
			batch.set(db.collection('dogs').doc(dog.dogId), { lastYardDate: postedAt.toISOString() }, { merge: true });
		}
	});
	await batch.commit();
	return inYard.length;
}

/**
 * Writes a report's logs, leaving alone any meal that already has one.
 *
 * A filled-in dog is an inference from the exceptions, so anything already standing —
 * a staff entry, an earlier report of the same feed — knows more than it does. A dog the
 * message actually named overwrites, since that is an observation.
 */
export async function writeFeedings(
	db: Db,
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
		const existing = await Promise.all(chunk.map((e) => db.collection('dogs').doc(e.dogId).collection('feedingLogs').get()));

		const batch = db.batch();
		chunk.forEach((entry, j) => {
			// Compared on the shelter's calendar day, not the server's: an evening report
			// is already the next day in UTC, and would miss the log it should defer to.
			const fedAt = feedingDate(postedAt, entry.mealTime);
			const day = shelterDay(fedAt);
			const already = existing[j].docs.some((d) => {
				const x = d.data();
				return x.mealTime === entry.mealTime && shelterDay(new Date(x.date)) === day;
			});
			if (entry.implied && already) return;

			const id = feedingLogId(fedAt, entry.dogId, entry.mealTime);
			batch.set(db.collection('dogs').doc(entry.dogId).collection('feedingLogs').doc(id), {
				id,
				date: fedAt.toISOString(),
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
