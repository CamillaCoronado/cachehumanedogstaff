import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Real departure dates from ASM, for backfilling archived dogs that were
// saved without one: adoption movement dates (json_adopted_animals, chunked —
// ASM caps responses at 1000 rows) plus deceased dates (json_recent_changes,
// which reaches back about a month). No transfer feed exists in ASM's service
// API, so transfers usually come back unmatched.
interface Departure {
	id: number;
	shelterCode: string;
	date: string; // YYYY-MM-DD
	outcome: 'adopted' | 'euthanized';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateStr(val: unknown): string | null {
	if (typeof val !== 'string') return null;
	const m = val.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function addOneYear(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	return `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function fetchAsmJson(base: string, params: string): Promise<unknown> {
	const res = await fetch(`${base}&${params}`, { redirect: 'follow' });
	if (!res.ok) throw error(502, `ASM fetch failed: ${res.status}`);
	try {
		return JSON.parse(await res.text());
	} catch {
		throw error(502, 'ASM returned non-JSON');
	}
}

export async function GET({ url }) {
	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;
	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) {
		throw error(503, 'ASM credentials not configured');
	}

	const fromdate = url.searchParams.get('fromdate') ?? '';
	const todate = url.searchParams.get('todate') ?? '';
	if (!DATE_RE.test(fromdate) || !DATE_RE.test(todate)) {
		throw error(400, 'fromdate and todate are required (YYYY-MM-DD)');
	}

	const base = `${ASM_URL}/asmservice?account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`;

	// Adoption windows (≤1 year each) + the recent-changes feed, in parallel.
	const windows: { from: string; to: string }[] = [];
	let cursor = fromdate;
	while (cursor < todate) {
		const next = addOneYear(cursor);
		windows.push({ from: cursor, to: next < todate ? next : todate });
		cursor = next;
	}
	if (windows.length === 0) windows.push({ from: fromdate, to: todate });

	const [adoptionChunks, recentChanges] = await Promise.all([
		Promise.all(
			windows.map((w) => fetchAsmJson(base, `method=json_adopted_animals&fromdate=${w.from}&todate=${w.to}`))
		),
		fetchAsmJson(base, 'method=json_recent_changes').catch(() => [])
	]);

	const byKey = new Map<string, Departure>();
	const add = (entry: Departure) => byKey.set(`${entry.id}|${entry.outcome}`, entry);

	for (const chunk of adoptionChunks) {
		if (!Array.isArray(chunk)) continue;
		for (const raw of chunk as Record<string, unknown>[]) {
			if (String(raw.SPECIESNAME ?? '').toLowerCase() !== 'dog') continue;
			const id = Number(raw.ID);
			const date = normalizeDateStr(raw.ACTIVEMOVEMENTDATE);
			if (!Number.isFinite(id) || !date) continue;
			add({ id, shelterCode: String(raw.SHELTERCODE ?? ''), date, outcome: 'adopted' });
		}
	}

	if (Array.isArray(recentChanges)) {
		for (const raw of recentChanges as Record<string, unknown>[]) {
			if (String(raw.SPECIESNAME ?? '').toLowerCase() !== 'dog') continue;
			const id = Number(raw.ID);
			const date = normalizeDateStr(raw.DECEASEDDATE);
			if (!Number.isFinite(id) || !date) continue;
			add({ id, shelterCode: String(raw.SHELTERCODE ?? ''), date, outcome: 'euthanized' });
		}
	}

	return json(Array.from(byKey.values()));
}
