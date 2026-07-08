import { json } from '@sveltejs/kit';
import { fetchTabRows } from '$lib/server/googleSheets';

const CHART_TABS = [
	{ year: 2024, title: '2024 Day Trip Data Chart', gid: '2048243758' },
	{ year: 2025, title: '2025 Day Trip Data Chart', gid: '1275517464' },
	{ year: 2026, title: '2026 Day Trip Data Chart', gid: '747552302' },
] as const;

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

		const hours = parseFloat(row[1]) || 0;
		const trips = parseInt(row[2], 10) || 0;
		results.push({ name, hours, trips });
	}

	return results;
}

export async function GET() {
	const results = await Promise.all(
		CHART_TABS.map(async ({ year, title, gid }) => {
			try {
				const months = await fetchChartTab(title, gid);
				const totalHours = months.reduce((s, m) => s + m.hours, 0);
				const totalTrips = months.reduce((s, m) => s + m.trips, 0);
				return { year, months, totalHours, totalTrips, error: null };
			} catch (e) {
				return { year, months: [] as { name: string; hours: number; trips: number }[], totalHours: 0, totalTrips: 0, error: String(e) };
			}
		})
	);

	return json(results);
}
