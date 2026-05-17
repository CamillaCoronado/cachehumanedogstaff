import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function GET() {
	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;

	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) {
		throw error(503, 'ASM credentials not configured');
	}

	let res: Response;
	try {
		res = await fetch(
			`${ASM_URL}/asmservice?method=json_shelter_animals&account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}&sensitive=1`
		);
	} catch (e) {
		throw error(502, `ASM network error: ${e instanceof Error ? e.message : String(e)}`);
	}

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw error(502, `ASM fetch failed: ${res.status} ${body.slice(0, 200)}`);
	}

	const text = await res.text();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		console.error('[ASM] Non-JSON response:', text.slice(0, 500));
		throw error(502, `ASM returned non-JSON: ${text.slice(0, 200)}`);
	}

	// When PHOTOURLS is absent or empty, inject a constructed animal_image URL.
	// This covers photos that exist in ASM but aren't marked for web publication,
	// which causes PHOTOURLS to be empty. The URL is stable (same animal ID),
	// so the sync comparison won't flip on every run. Animals with no photo at all
	// will get a URL that returns nothing — handled by onerror in the UI.
	if (Array.isArray(data)) {
		data = data.map((animal: Record<string, unknown>) => {
			if (Array.isArray(animal.PHOTOURLS) && animal.PHOTOURLS.length > 0) return animal;
			const fallbackUrl = `${ASM_URL}/asmservice?method=animal_image&account=${encodeURIComponent(ASM_ACCOUNT)}&animalid=${encodeURIComponent(String(animal.ID))}&seq=1`;
			return { ...animal, PHOTOURLS: [fallbackUrl] };
		});
	}

	return json(data);
}
