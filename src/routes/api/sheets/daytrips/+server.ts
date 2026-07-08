import { json, error } from '@sveltejs/kit';
import { fetchTabRows } from '$lib/server/googleSheets';

function parseDogName(raw: string): string {
	return raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function parseSheetDate(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;
	const parts = s.split('/');
	if (parts.length !== 2) return null;
	const month = parseInt(parts[0], 10);
	const day = parseInt(parts[1], 10);
	if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;

	// Assign year: if the date is within the last 6 months use current year, else previous year
	const today = new Date();
	const year = today.getFullYear();
	const candidate = new Date(year, month - 1, day);
	const finalYear = candidate <= today ? year : year - 1;

	return `${finalYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function GET() {
	let rows: string[][];
	try {
		rows = await fetchTabRows('DT Numbers', '1548223211');
	} catch (e) {
		throw error(502, `Sheet fetch error: ${e instanceof Error ? e.message : String(e)}`);
	}

	// Skip header row; each row is: Name, 1st Trip, 2nd Trip, ...
	const data = rows
		.slice(1)
		.filter((row) => row[0]?.trim())
		.map((row) => {
			const name = parseDogName(row[0]);
			const dates = row
				.slice(1)
				.map((d) => parseSheetDate(d))
				.filter((d): d is string => d !== null);
			return { name, dates };
		})
		.filter((d) => d.name.length > 0);

	return json(data);
}
