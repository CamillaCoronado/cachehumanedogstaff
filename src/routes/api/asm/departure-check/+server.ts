import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin';
import type { AsmFeedAnimal } from '$lib/utils/departureCheck';

export const config = { maxDuration: 60 };

const day = (v: unknown) => {
	const m = typeof v === 'string' ? v.match(/(\d{4})[-/](\d{2})[-/](\d{2})/) : null;
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/**
 * Title of a saved ASM report listing dogs that left or died, with ID, SHELTERCODE,
 * SHORTCODE, ANIMALNAME, DECEASEDDATE, ACTIVEMOVEMENTTYPE and ACTIVEMOVEMENTDATE columns.
 * ASM's service has no animal search and no feed of older deaths, so a report is the only
 * way to reach a dog euthanized more than about a month ago.
 */
const DEFAULT_REPORT = 'App departures';

export async function POST({ request }: RequestEvent) {
	const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	if (!token) throw error(401, 'Missing auth token');
	let uid: string;
	try {
		uid = (await getAdminAuth().verifyIdToken(token)).uid;
	} catch {
		throw error(401, 'Invalid auth token');
	}
	const profile = await getAdminDb().collection('users').doc(uid).get();
	if (profile.data()?.role !== 'admin') throw error(403, 'Admins only');

	const { ASM_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;
	if (!ASM_URL || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) throw error(503, 'ASM credentials not configured');
	const base = `${ASM_URL}/asmservice?account=${encodeURIComponent(ASM_ACCOUNT)}&username=${encodeURIComponent(ASM_USER)}&password=${encodeURIComponent(ASM_PASS)}`;

	const body = (await request.json().catch(() => ({}))) as { from?: string };
	const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from ?? '') ? body.from! : `${new Date().getFullYear()}-01-01`;
	const t = new Date();
	const to = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
	const reportTitle = env.ASM_DEPARTURES_REPORT || DEFAULT_REPORT;

	const get = async (params: string): Promise<Record<string, unknown>[]> => {
		const res = await fetch(`${base}&${params}`);
		const text = await res.text();
		if (!res.ok) throw new Error(`ASM returned ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
		let rows: unknown;
		try {
			rows = JSON.parse(text);
		} catch {
			throw new Error(`ASM returned something other than JSON: ${text.slice(0, 120)}`);
		}
		// Report columns come back in whatever case the SQL used; the feeds use upper case.
		return Array.isArray(rows)
			? rows.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k.toUpperCase(), v])))
			: [];
	};

	// Adoptions since `from`, ASM's recent changes (deaths from about the last month), and
	// the saved report for everything else. Only the adoptions feed is required.
	const [adopted, changes, report] = await Promise.all([
		get(`method=json_adopted_animals&fromdate=${from}&todate=${to}`).catch((e: Error) => {
			throw error(502, `ASM adoptions feed failed: ${e.message}`);
		}),
		get('method=json_recent_changes').catch(() => [] as Record<string, unknown>[]),
		get(`method=json_report&title=${encodeURIComponent(reportTitle)}`).then(
			(rows) => ({ rows, problem: null as string | null }),
			(e: Error) => ({ rows: [] as Record<string, unknown>[], problem: e.message })
		)
	]);

	const byId = new Map<string, AsmFeedAnimal>();
	const add = (a: Record<string, unknown>, fromReport: boolean) => {
		// The report is expected to be dogs only; the feeds carry every species.
		if (!fromReport && String(a.SPECIESNAME ?? '').toLowerCase() !== 'dog') return;
		const id = String(a.ID ?? '');
		if (!id) return;
		const type = Number(a.ACTIVEMOVEMENTTYPE);
		const prev = byId.get(id);
		byId.set(id, {
			id: Number(id),
			shelterCode: String(a.SHELTERCODE ?? prev?.shelterCode ?? ''),
			shortCode: String(a.SHORTCODE ?? prev?.shortCode ?? ''),
			name: String(a.ANIMALNAME ?? prev?.name ?? ''),
			movementType: Number.isFinite(type) && type > 0 ? type : (prev?.movementType ?? null),
			movementDate: day(a.ACTIVEMOVEMENTDATE) ?? prev?.movementDate ?? null,
			deceasedDate: day(a.DECEASEDDATE) ?? prev?.deceasedDate ?? null
		});
	};
	for (const a of adopted) add(a, false);
	for (const a of changes) add(a, false);
	for (const a of report.rows) add(a, true);

	return json({
		from,
		animals: [...byId.values()],
		report: { title: reportTitle, rows: report.rows.length, problem: report.problem }
	});
}