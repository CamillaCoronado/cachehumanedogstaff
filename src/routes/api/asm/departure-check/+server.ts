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

type DogRef = { id: string; name?: string | null; asmId?: number | null; shelterCode?: string | null };

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

	const miss = (missReason: string): AsmDeparture => ({
		found: false,
		movementType: null,
		movementDate: null,
		deceasedDate: null,
		missReason
	});
	const toDeparture = (a: Record<string, unknown>, matchedByName: string | null): AsmDeparture => {
		const type = Number(a.ACTIVEMOVEMENTTYPE);
		return {
			found: true,
			movementType: Number.isFinite(type) && type > 0 ? type : null,
			movementDate: day(a.ACTIVEMOVEMENTDATE),
			deceasedDate: day(a.DECEASEDDATE),
			matchedByName
		};
	};

	/** One search, retried once: a failed request must not read as "not in ASM". */
	const search = async (q: string): Promise<Record<string, unknown>[] | string> => {
		let last = '';
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const res = await fetch(`${base}&method=json_find_animals&q=${encodeURIComponent(q)}`);
				if (!res.ok) {
					last = `ASM returned ${res.status}`;
					continue;
				}
				const rows = await res.json();
				return Array.isArray(rows) ? rows : [];
			} catch (e) {
				last = e instanceof Error ? e.message : String(e);
			}
		}
		return last || 'ASM lookup failed';
	};

	const lookup = async (d: DogRef): Promise<[string, AsmDeparture]> => {
		const ids = [...new Set([d.shelterCode, d.asmId ? String(d.asmId) : null].filter((q): q is string => Boolean(q)))];
		const failures: string[] = [];
		for (const q of ids) {
			const rows = await search(q);
			if (typeof rows === 'string') {
				failures.push(rows);
				continue;
			}
			const a = rows.find(
				(r) => (d.asmId && Number(r.ID) === d.asmId) || (d.shelterCode && String(r.SHELTERCODE ?? '').trim().toUpperCase() === d.shelterCode.trim().toUpperCase())
			);
			if (a) return [d.id, toDeparture(a, null)];
		}

		// The ids missed (or there are none): try the name, but only take a single dog by
		// that exact name, and flag it so the admin checks it is the same animal.
		const name = d.name?.trim();
		if (name) {
			const rows = await search(name);
			if (typeof rows === 'string') {
				failures.push(rows);
			} else {
				const dogs = rows.filter(
					(r) =>
						String(r.ANIMALNAME ?? '').trim().toLowerCase() === name.toLowerCase() &&
						String(r.SPECIESNAME ?? 'dog').toLowerCase() === 'dog'
				);
				if (dogs.length === 1) return [d.id, toDeparture(dogs[0], String(dogs[0].SHELTERCODE ?? dogs[0].ID ?? '?'))];
				if (dogs.length > 1) {
					const codes = dogs.map((r) => String(r.SHELTERCODE ?? r.ID)).join(', ');
					return [d.id, miss(`ids not found; ${dogs.length} dogs named ${name} in ASM (${codes})`)];
				}
			}
		}

		if (failures.length > 0) return [d.id, miss(`lookup failed: ${failures[0]}`)];
		if (ids.length === 0) return [d.id, miss('no ASM id or shelter code on record, and no dog by that name')];
		return [d.id, miss(`ASM has no animal matching ${ids.join(' / ')} or the name`)];
	};

	// A few at a time: ASM is one small server.
	const out: Record<string, AsmDeparture> = {};
	for (let i = 0; i < dogs.length; i += 5) {
		for (const [id, dep] of await Promise.all(dogs.slice(i, i + 5).map(lookup))) out[id] = dep;
	}
	return json(out);
}
