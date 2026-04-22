import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

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
	9: 'reserved',
};

export async function GET({ url }: RequestEvent) {
	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;

	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) {
		throw error(503, 'ASM credentials not configured');
	}

	const q = url.searchParams.get('q')?.trim();
	if (!q) throw error(400, 'Missing query param: q');

	let res: Response;
	try {
		res = await fetch(
			`${ASM_URL}/asmservice?method=json_find_animals&q=${encodeURIComponent(q)}&account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`
		);
	} catch (e) {
		throw error(502, `ASM network error: ${e instanceof Error ? e.message : String(e)}`);
	}

	if (!res.ok) throw error(502, `ASM search failed: ${res.status}`);

	let data: unknown[];
	try {
		data = await res.json();
	} catch {
		throw error(502, 'ASM returned non-JSON');
	}

	const animals = (Array.isArray(data) ? data : []).map((a: Record<string, unknown>) => ({
		id: a.ID,
		name: a.ANIMALNAME,
		shelterCode: a.SHELTERCODE,
		breed: a.BREEDNAME,
		status: a.DECEASEDDATE
			? 'deceased'
			: MOVEMENT_LABELS[a.ACTIVEMOVEMENTTYPE as number] ?? 'unknown',
		activeMovermentType: a.ACTIVEMOVEMENTTYPE,
	}));

	return json(animals);
}
