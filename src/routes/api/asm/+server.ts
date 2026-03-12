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
			`${ASM_URL}/asmservice?method=json_shelter_animals&account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`
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

	return json(data);
}
