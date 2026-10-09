import { env } from '$env/dynamic/private';

/**
 * ASM's service API has no animal search (there is no json_find_animals; unknown methods
 * fail with "Invalid method"). What it does have are lists: animals on the shelter,
 * adoptions between two dates, records changed in the last month, and saved reports.
 * Everything that needs to find an animal reads these and matches locally.
 */

/** A dog as ASM's lists describe it. */
export interface AsmDog {
	id: number;
	shelterCode: string;
	/** ASM's short code, the other code shown on an animal's record. */
	shortCode: string;
	name: string;
	breed: string;
	/** ASM movement type of its current movement; null when on the shelter. */
	movementType: number | null;
	movementDate: string | null;
	deceasedDate: string | null;
}

/**
 * Title of a saved ASM report listing dogs that left or died, with ID, SHELTERCODE,
 * SHORTCODE, ANIMALNAME, DECEASEDDATE, ACTIVEMOVEMENTTYPE and ACTIVEMOVEMENTDATE columns.
 * It is the only way to reach a death older than about a month.
 */
export const DEFAULT_DEPARTURES_REPORT = 'App departures';

export function asmBase(): string | null {
	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;
	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) return null;
	return `${ASM_URL}/asmservice?account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`;
}

const day = (v: unknown) => {
	const m = typeof v === 'string' ? v.match(/(\d{4})[-/](\d{2})[-/](\d{2})/) : null;
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** One ASM service call, rows with upper-cased keys (report columns come in any case). */
async function asmGet(base: string, params: string): Promise<Record<string, unknown>[]> {
	const res = await fetch(`${base}&${params}`);
	const text = await res.text();
	if (!res.ok) throw new Error(`ASM returned ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
	let rows: unknown;
	try {
		rows = JSON.parse(text);
	} catch {
		throw new Error(`ASM returned something other than JSON: ${text.slice(0, 120)}`);
	}
	return Array.isArray(rows)
		? rows.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k.toUpperCase(), v])))
		: [];
}

export interface AsmDogsResult {
	dogs: AsmDog[];
	report: { title: string; rows: number; problem: string | null };
}

/**
 * Every dog ASM's lists can show: adoptions since `from` (asked a year at a time — ASM caps
 * a response at 1000 rows), recent changes, the departures report, and, with
 * `shelter: true`, the dogs on the shelter now. Only the adoptions are required to load.
 */
export async function loadAsmDogs(base: string, from: string, opts: { shelter?: boolean } = {}): Promise<AsmDogsResult> {
	const reportTitle = env.ASM_DEPARTURES_REPORT || DEFAULT_DEPARTURES_REPORT;
	const today = ymd(new Date());
	const windows: string[] = [];
	for (let start = from; start < today; ) {
		const [y, m, d] = start.split('-').map(Number);
		const next = ymd(new Date(y + 1, m - 1, d));
		windows.push(`method=json_adopted_animals&fromdate=${start}&todate=${next < today ? next : today}`);
		start = next;
	}
	if (windows.length === 0) windows.push(`method=json_adopted_animals&fromdate=${from}&todate=${today}`);

	const none = [] as Record<string, unknown>[];
	const [adopted, changes, shelter, report] = await Promise.all([
		Promise.all(windows.map((w) => asmGet(base, w))).then((chunks) => chunks.flat()),
		asmGet(base, 'method=json_recent_changes').catch(() => none),
		opts.shelter ? asmGet(base, 'method=json_shelter_animals').catch(() => none) : Promise.resolve(none),
		asmGet(base, `method=json_report&title=${encodeURIComponent(reportTitle)}`).then(
			(rows) => ({ rows, problem: null as string | null }),
			(e: Error) => ({ rows: none, problem: e.message })
		)
	]);

	const byId = new Map<string, AsmDog>();
	const add = (a: Record<string, unknown>, dogsOnly: boolean) => {
		// The report is expected to be dogs only; the lists carry every species.
		if (!dogsOnly && String(a.SPECIESNAME ?? '').toLowerCase() !== 'dog') return;
		const id = String(a.ID ?? '');
		if (!id) return;
		const type = Number(a.ACTIVEMOVEMENTTYPE);
		const prev = byId.get(id);
		byId.set(id, {
			id: Number(id),
			shelterCode: String(a.SHELTERCODE ?? prev?.shelterCode ?? ''),
			shortCode: String(a.SHORTCODE ?? prev?.shortCode ?? ''),
			name: String(a.ANIMALNAME ?? prev?.name ?? ''),
			breed: String(a.BREEDNAME ?? prev?.breed ?? ''),
			movementType: Number.isFinite(type) && type > 0 ? type : (prev?.movementType ?? null),
			movementDate: day(a.ACTIVEMOVEMENTDATE) ?? prev?.movementDate ?? null,
			deceasedDate: day(a.DECEASEDDATE) ?? prev?.deceasedDate ?? null
		});
	};
	for (const a of adopted) add(a, false);
	for (const a of shelter) add(a, false);
	for (const a of changes) add(a, false);
	for (const a of report.rows) add(a, true);

	return {
		dogs: [...byId.values()],
		report: { title: reportTitle, rows: report.rows.length, problem: report.problem }
	};
}
