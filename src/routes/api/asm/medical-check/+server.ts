import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin';
import { asmBase, loadAsmRegimens } from '$lib/server/asmAnimals';

export const config = { maxDuration: 60 };

/** Every active medical regimen in ASM, for the admin medical check to compare. Reads only. */
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
	if (!asmBase()) throw error(503, 'ASM credentials not configured');

	try {
		return json({ regimens: await loadAsmRegimens() });
	} catch (e) {
		throw error(502, `ASM medical book failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}
