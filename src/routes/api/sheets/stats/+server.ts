import { json } from '@sveltejs/kit';
import { fetchTabRows } from '$lib/server/googleSheets';
import { parseSheetNumber } from '$lib/utils/sheetNumbers';

const FIRST_YEAR = 2024;

/**
 * Tab ids for the CSV fallback (used when there are no API credentials). A year missing
 * here still loads by title through the API; without credentials it reports an error
 * instead of reading the wrong tab.
 */
const TAB_GIDS: Record<number, string> = {
	2024: '2048243758',
	2025: '1275517464',
	2026: '747552302'
};

const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];

async function fetchChartTab(title: string, gid: string): Promise<{ name: string; hours: number; trips: number }[]> {
	const rows = (await fetchTabRows(title, gid)).map((row) => row.map((cell) => cell.trim()));

	// Row 0 is the header; rows 1–12 are months
	const results: { name: string; hours: number; trips: number }[] = [];

	for (let i = 1; i < rows.length; i++) {
		const row = rows[i];
		const name = row[0]?.trim();
		if (!name || !MONTH_NAMES.includes(name)) continue;

		const hours = parseSheetNumber(row[1]);
		const trips = Math.round(parseSheetNumber(row[2]));
		results.push({ name, hours, trips });
	}

	if (results.length === 0) throw new Error(`No month rows found in "${title}"`);
	return results;
}

export async function GET() {
	const years: number[] = [];
	for (let y = FIRST_YEAR; y <= new Date().getFullYear(); y++) years.push(y);

	const results = await Promise.all(
		years.map(async (year) => {
			const title = `${year} Day Trip Data Chart`;
			try {
				const months = await fetchChartTab(title, TAB_GIDS[year] ?? '');
				const totalHours = months.reduce((s, m) => s + m.hours, 0);
				const totalTrips = months.reduce((s, m) => s + m.trips, 0);
				return { year, months, totalHours, totalTrips, error: null };
			} catch (e) {
				return { year, months: [] as { name: string; hours: number; trips: number }[], totalHours: 0, totalTrips: 0, error: e instanceof Error ? e.message : String(e) };
			}
		})
	);

	return json(results);
}
