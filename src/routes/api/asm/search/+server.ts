import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getAdminAuth } from '$lib/firebase/admin';
import { asmBase, loadAsmDogs } from '$lib/server/asmAnimals';

export const config = { maxDuration: 60 };

const MOVEMENT_LABELS: Record<number, string> = {
	0: 'in shelter',
	1: 'adopted',
	2: 'in foster',
	3: 'transferred',
	4: 'escaped',
	5: 'reclaimed',
	6: 'stolen',
	7: 'released',
	8: 'moved to retailer',
	9: 'reserved'
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Finds dogs in ASM by name, for any number of names at once (`?q=Rex&q=Dragon`). ASM has
 * no search, so this reads its lists — on the shelter, adopted in the last three years,
 * recent changes, and the departures report — and matches names here. Signed-in users only.
 */
export async function GET({ url, request }: RequestEvent) {
	const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	if (!token) throw error(401, 'Missing auth token');
	try {
		await getAdminAuth().verifyIdToken(token);
	} catch {
		throw error(401, 'Invalid auth token');
	}

	const base = asmBase();
	if (!base) throw error(503, 'ASM credentials not configured');

	const names = url.searchParams.getAll('q').map((q) => q.trim()).filter(Boolean);
	if (names.length === 0) throw error(400, 'Missing query param: q');

	const t = new Date();
	const from = `${t.getFullYear() - 3}-01-01`;
	let dogs;
	try {
		dogs = (await loadAsmDogs(base, from, { shelter: true })).dogs;
	} catch (e) {
		throw error(502, `ASM lists failed: ${e instanceof Error ? e.message : String(e)}`);
	}

	const results: Record<string, { id: number; name: string; shelterCode: string; breed: string; status: string }[]> = {};
	for (const q of names) {
		const want = norm(q);
		results[q] = dogs
			.filter((d) => want && norm(d.name) && (norm(d.name).includes(want) || want.includes(norm(d.name))))
			.map((d) => ({
				id: d.id,
				name: d.name,
				shelterCode: d.shelterCode,
				breed: d.breed,
				status: d.deceasedDate ? 'deceased' : (MOVEMENT_LABELS[d.movementType ?? 0] ?? 'unknown')
			}));
	}
	return json(results);
}
