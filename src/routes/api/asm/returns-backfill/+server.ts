import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin';
import { syncReturnsFromASM } from '$lib/server/asmReturnsSync';

export const config = { maxDuration: 60 };

/**
 * Admin-only: reads returned dogs' ASM movements for as long as one request allows and
 * says how many are left. The Admin page calls it again until none are.
 */
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

	try {
		// Stop starting new reads at 45s so the last ones finish inside the minute.
		return json(await syncReturnsFromASM({ limit: Infinity, budgetMs: 45_000, neverRead: true }));
	} catch (e) {
		console.error('returns backfill failed', e);
		throw error(500, e instanceof Error ? e.message : String(e));
	}
}
