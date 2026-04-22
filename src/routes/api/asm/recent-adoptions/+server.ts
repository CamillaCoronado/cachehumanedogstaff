import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

interface AsmAnimal {
	ID: number;
	ANIMALID?: number | null;
	ANIMALNAME: string | null;
	SPECIESNAME: string | null;
	SHELTERCODE: string | null;
	PHOTOURLS?: string[];
	WEBSITEIMAGECOUNT?: number | null;
	WEBSITEMEDIANAME?: string | null;
	WEBSITEMEDIADATE?: string | null;
	ACTIVEMOVEMENTTYPE: number;
	MOVEMENTTYPE?: number | null;
	ACTIVEMOVEMENTDATE: string | null;
	MOVEMENTDATE?: string | null;
}

const MAX_LOOKBACK_DAYS = 120;
const DEFAULT_LOOKBACK_DAYS = 30;

export async function GET({ url }: RequestEvent) {
	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;

	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) {
		throw error(503, 'ASM credentials not configured');
	}

	const requestedDays = Number.parseInt(url.searchParams.get('days') ?? `${DEFAULT_LOOKBACK_DAYS}`, 10);
	const lookbackDays =
		Number.isFinite(requestedDays) && requestedDays > 0
			? Math.min(requestedDays, MAX_LOOKBACK_DAYS)
			: DEFAULT_LOOKBACK_DAYS;
	const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

	let res: Response;
	try {
		res = await fetch(
			`${ASM_URL}/asmservice?method=json_recent_adoptions&account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`
		);
	} catch (e) {
		throw error(502, `ASM network error: ${e instanceof Error ? e.message : String(e)}`);
	}

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw error(502, `ASM fetch failed: ${res.status} ${body.slice(0, 200)}`);
	}

	let data: unknown;
	try {
		data = await res.json();
	} catch {
		throw error(502, 'ASM returned non-JSON');
	}

	const recentAdoptions = (Array.isArray(data) ? data : [])
		.filter((animal): animal is AsmAnimal => typeof animal === 'object' && animal !== null)
		.filter((animal) => (animal.SPECIESNAME ?? '').toLowerCase() === 'dog')
		.filter((animal) => (animal.MOVEMENTTYPE ?? animal.ACTIVEMOVEMENTTYPE) === 1)
		.map((animal) => ({
			...animal,
			adoptedAt: animal.MOVEMENTDATE ?? animal.ACTIVEMOVEMENTDATE
		}))
		.filter((animal) => Boolean(animal.adoptedAt))
		.map((animal) => ({
			id: String(animal.ID),
			animalId: String(animal.ANIMALID ?? animal.ID),
			name: animal.ANIMALNAME ?? `Dog ${animal.ID}`,
			shelterCode: animal.SHELTERCODE ?? '',
			adoptedAt: animal.adoptedAt as string,
			photoUrl:
				(Array.isArray(animal.PHOTOURLS) && animal.PHOTOURLS.length > 0 ? animal.PHOTOURLS[0] : null) ??
				(animal.WEBSITEMEDIANAME || animal.WEBSITEMEDIADATE || (animal.WEBSITEIMAGECOUNT ?? 0) > 0
					? `${ASM_URL}/asmservice?method=animal_image&account=${encodeURIComponent(ASM_ACCOUNT)}&animalid=${encodeURIComponent(String(animal.ANIMALID ?? animal.ID))}&seq=1`
					: null)
		}))
		.filter((animal) => {
			const adoptedMs = Date.parse(animal.adoptedAt);
			return Number.isFinite(adoptedMs) && adoptedMs >= cutoffMs;
		})
		.sort((a, b) => Date.parse(b.adoptedAt) - Date.parse(a.adoptedAt));

	return json(recentAdoptions);
}
