import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin';
import { backfillDogStaff, STAFF_KINDS, type StaffKind } from '$lib/server/slackStaffBackfill';

// Paging months of Slack history, and every dog's logs, can take a while.
export const config = { maxDuration: 60 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Admin-only: backfills #dog-staff reports. Dry run unless told otherwise. */
export async function POST({ request }: RequestEvent) {
	const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	if (!token) throw error(401, 'Missing auth token');

	let uid: string;
	try {
		uid = (await getAdminAuth().verifyIdToken(token)).uid;
	} catch {
		throw error(401, 'Invalid auth token');
	}
	const profile = await getAdminDb().collection('users').doc(uid).get();
	if (profile.data()?.role !== 'admin') throw error(403, 'Admins only');

	const body = (await request.json().catch(() => ({}))) as { since?: string; dryRun?: boolean; kinds?: unknown; keep?: unknown };
	if (!body.since || !DATE_RE.test(body.since)) throw error(400, 'since is required (YYYY-MM-DD)');
	// Midnight at the shelter (Mountain time), whatever timezone the server runs in.
	const since = new Date(`${body.since}T00:00:00-07:00`);
	const kinds = Array.isArray(body.kinds)
		? (body.kinds.filter((k) => STAFF_KINDS.includes(k as StaffKind)) as StaffKind[])
		: STAFF_KINDS;
	const keep = Array.isArray(body.keep) ? body.keep.filter((k): k is string => typeof k === 'string') : undefined;

	return json(await backfillDogStaff(since, body.dryRun !== false, kinds, keep));
}
