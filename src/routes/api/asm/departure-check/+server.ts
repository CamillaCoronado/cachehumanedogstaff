import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin';
import type { AsmDeparture } from '$lib/utils/departureCheck';

export const config = { maxDuration: 60 };

/** Dogs looked up per request; the page sends them in batches this size. */
const MAX_DOGS = 25;

const day = (v: unknown) => {
	const m = typeof v === 'string' ? v.match(/(\d{4})[-/](\d{2})[-/](\d{2})/) : null;
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

type DogRef = { id: string; asmId?: number | null; shelterCode?: string | null };

/**
 * Admin-only: what ASM says happened to each dog — its last movement and date, or its
 * death. Looked up one by one with ASM's animal search, which covers every animal, where
 * the adoption and recent-changes feeds only cover adoptions or the last month.
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

	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;
	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) throw error(503, 'ASM credentials not configured');
	const base = `${ASM_URL}/asmservice?account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`;

	const body = (await request.json().catch(() => ({}))) as { dogs?: DogRef[] };
	const dogs = (Array.isArray(body.dogs) ? body.dogs : []).slice(0, MAX_DOGS);

	const none: AsmDeparture = { found: false, movementType: null, movementDate: null, deceasedDate: null };
	const lookup = async (d: DogRef): Promise<[string, AsmDeparture]> => {
		const q = d.shelterCode || (d.asmId ? String(d.asmId) : '');
		if (!q) return [d.id, none];
		try {
			const res = await fetch(`${base}&method=json_find_animals&q=${encodeURIComponent(q)}`);
			if (!res.ok) return [d.id, none];
			const rows = (await res.json()) as Record<string, unknown>[];
			const a = (Array.isArray(rows) ? rows : []).find(
				(r) => (d.asmId && Number(r.ID) === d.asmId) || (d.shelterCode && String(r.SHELTERCODE ?? '') === d.shelterCode)
			);
			if (!a) return [d.id, none];
			const type = Number(a.ACTIVEMOVEMENTTYPE);
			return [
				d.id,
				{
					found: true,
					movementType: Number.isFinite(type) && type > 0 ? type : null,
					movementDate: day(a.ACTIVEMOVEMENTDATE),
					deceasedDate: day(a.DECEASEDDATE)
				}
			];
		} catch {
			return [d.id, none];
		}
	};

	// A few at a time: ASM is one small server.
	const out: Record<string, AsmDeparture> = {};
	for (let i = 0; i < dogs.length; i += 5) {
		for (const [id, dep] of await Promise.all(dogs.slice(i, i + 5).map(lookup))) out[id] = dep;
	}
	return json(out);
}
