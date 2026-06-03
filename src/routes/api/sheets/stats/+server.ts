import { json } from '@sveltejs/kit';

const SHEET_ID = '115x6-x7z4IXXKfSW71GQrxfhGEjVRICDl1zKOljGE80';

const CHART_TABS = [
	{ year: 2024, gid: '2048243758' },
	{ year: 2025, gid: '1275517464' },
	{ year: 2026, gid: '747552302' },
] as const;

const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];

async function fetchChartTab(gid: string): Promise<{ name: string; hours: number; trips: number }[]> {
	const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

	const csv = await res.text();
	const rows = csv.split(/\r?\n/).map((r) =>
		r.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim())
	);

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
		CHART_TABS.map(async ({ year, gid }) => {
			try {
				const months = await fetchChartTab(gid);
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
