import { json, error } from '@sveltejs/kit';
import { fetchGridRowData } from '$lib/server/googleSheets';

const SHEET_NAME = 'DT Numbers';

function parseName(raw: string): string {
	return raw.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
}

function classifyColor(r: number, g: number, b: number): 'green' | 'yellow' | 'red' | null {
	if (r > 0.95 && g > 0.95 && b > 0.95) return null;
	if (g > r && g > b && g > 0.65) return 'green';
	if (r > 0.8 && g > 0.75 && b < 0.55) return 'yellow';
	if (r > 0.7 && r > g && r > b && g < 0.6) return 'red';
	return null; // orange (foster), purple (adopted), etc.
}

export async function GET() {
	let rows: unknown[];
	try {
		rows = await fetchGridRowData(`${SHEET_NAME}!A:A`);
	} catch (e) {
		throw error(502, `Sheets API error: ${e instanceof Error ? e.message : String(e)}`);
	}

	const colors: Record<string, 'green' | 'yellow' | 'red'> = {};

	for (const row of rows) {
		const cell = (row as Record<string, unknown>)?.values as unknown[] | undefined;
		const v = cell?.[0] as Record<string, unknown> | undefined;
		if (!v) continue;

		const name = parseName((v.formattedValue as string | undefined) ?? '');
		if (!name || name === 'name') continue;

		const bg = (v.userEnteredFormat as Record<string, unknown> | undefined)?.backgroundColor as Record<string, number> | undefined ?? {};
		const r = bg.red ?? 1;
		const g = bg.green ?? 1;
		const b = bg.blue ?? 1;

		const color = classifyColor(r, g, b);
		if (color) colors[name] = color;
	}

	return json(colors);
}
