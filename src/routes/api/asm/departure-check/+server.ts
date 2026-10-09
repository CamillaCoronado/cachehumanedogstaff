import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin';
import type { AsmFeedAnimal } from '$lib/utils/departureCheck';
import { asmBase, loadAsmDogs, searchAsmWebsite } from '$lib/server/asmAnimals';

export const config = { maxDuration: 60 };

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

	const base = asmBase();
	if (!base) throw error(503, 'ASM credentials not configured');

	const body = (await request.json().catch(() => ({}))) as { from?: string; search?: string[] };

	// Search mode: look each query (a shelter code or a name) up on ASM's website, which
	// covers every animal, deceased included. A few at a time; at most 25 per request.
	if (Array.isArray(body.search)) {
		const queries = [...new Set(body.search.map((q) => String(q).trim()).filter(Boolean))].slice(0, 25);
		const found = new Map<number, AsmFeedAnimal>();
		const problems: string[] = [];
		for (let i = 0; i < queries.length; i += 5) {
			const batch = await Promise.all(
				queries.slice(i, i + 5).map((q) =>
					searchAsmWebsite(q).catch((e: Error) => {
						problems.push(e.message);
						return [];
					})
				)
			);
			for (const dogs of batch) for (const { breed: _breed, ...dog } of dogs) found.set(dog.id, dog);
		}
		return json({ animals: [...found.values()], problem: problems[0] ?? null });
	}

	const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from ?? '') ? body.from! : `${new Date().getFullYear()}-01-01`;
	let result;
	try {
		result = await loadAsmDogs(base, from);
	} catch (e) {
		throw error(502, `ASM adoptions feed failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	const animals: AsmFeedAnimal[] = result.dogs.map(({ breed: _breed, ...dog }) => dog);
	return json({ from, animals });
}
