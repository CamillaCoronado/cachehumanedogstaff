import { env } from '$env/dynamic/private';

/**
 * ASM's service API has no animal search (there is no json_find_animals; unknown methods
 * fail with "Invalid method"). What it does have are lists: animals on the shelter,
 * adoptions between two dates, and records changed in the last month. Everything that
 * needs to find an animal reads these and matches locally, and falls back to searching
 * ASM's website (searchAsmWebsite) for what they don't show.
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
	/** YYYY-MM-DD of its latest intake, to tell same-name dogs apart. */
	intakeDate: string | null;
}

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
}

/**
 * Every dog ASM's lists can show: adoptions since `from` (asked a year at a time — ASM caps
 * a response at 1000 rows), recent changes, and, with `shelter: true`, the dogs on the
 * shelter now. Only the adoptions are required to load.
 */
export async function loadAsmDogs(base: string, from: string, opts: { shelter?: boolean } = {}): Promise<AsmDogsResult> {
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
	const [adopted, changes, shelter] = await Promise.all([
		Promise.all(windows.map((w) => asmGet(base, w))).then((chunks) => chunks.flat()),
		asmGet(base, 'method=json_recent_changes').catch(() => none),
		opts.shelter ? asmGet(base, 'method=json_shelter_animals').catch(() => none) : Promise.resolve(none)
	]);

	const byId = new Map<string, AsmDog>();
	const add = (a: Record<string, unknown>) => {
		if (String(a.SPECIESNAME ?? '').toLowerCase() !== 'dog') return;
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
			deceasedDate: day(a.DECEASEDDATE) ?? prev?.deceasedDate ?? null,
			intakeDate: day(a.MOSTRECENTENTRYDATE ?? a.DATEBROUGHTIN) ?? prev?.intakeDate ?? null
		});
	};
	for (const a of adopted) add(a);
	for (const a of shelter) add(a);
	for (const a of changes) add(a);

	return { dogs: [...byId.values()] };
}

/** Turns one ASM row (upper-cased keys) into an AsmDog, or null for another species. */
function toAsmDog(a: Record<string, unknown>): AsmDog | null {
	const species = String(a.SPECIESNAME ?? '').toLowerCase();
	if (species && species !== 'dog') return null;
	const id = Number(a.ID);
	if (!Number.isFinite(id) || id <= 0) return null;
	const type = Number(a.ACTIVEMOVEMENTTYPE);
	return {
		id,
		shelterCode: String(a.SHELTERCODE ?? ''),
		shortCode: String(a.SHORTCODE ?? ''),
		name: String(a.ANIMALNAME ?? ''),
		breed: String(a.BREEDNAME ?? ''),
		movementType: Number.isFinite(type) && type > 0 ? type : null,
		movementDate: day(a.ACTIVEMOVEMENTDATE),
		deceasedDate: day(a.DECEASEDDATE),
		intakeDate: day(a.MOSTRECENTENTRYDATE ?? a.DATEBROUGHTIN)
	};
}

/**
 * ASM's website — the one staff sign in to — can search every animal, deceased ones
 * included, and answers in JSON when asked with json=true. The service API can't, so
 * for a dog its lists don't show (a death older than a month), the server signs in to
 * the website with the same ASM account (approved by an admin) and searches there.
 */
type WebSession = { origin: string; cookies: Map<string, string>; at: number };
let webSession: WebSession | null = null;
const SESSION_MS = 20 * 60 * 1000;

const cookieHeader = (s: WebSession) => [...s.cookies].map(([k, v]) => `${k}=${v}`).join('; ');

/** One request that keeps ASM's cookies across its redirects (the hosted site routes sign-ins). */
async function webFetch(s: WebSession, path: string, init: RequestInit = {}): Promise<Response> {
	let url = new URL(path, s.origin).toString();
	let req: RequestInit = init;
	for (let hop = 0; hop < 6; hop++) {
		const res = await fetch(url, {
			...req,
			redirect: 'manual',
			headers: { ...((req.headers as Record<string, string>) ?? {}), cookie: cookieHeader(s) }
		});
		for (const c of res.headers.getSetCookie?.() ?? []) {
			const [pair] = c.split(';');
			const eq = pair.indexOf('=');
			if (eq > 0) s.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
		}
		const location = res.headers.get('location');
		if (res.status < 300 || res.status >= 400 || !location) return res;
		const next = new URL(location, url);
		s.origin = next.origin;
		url = next.toString();
		req = { method: 'GET' };
	}
	throw new Error('ASM website redirected too many times');
}

async function webSignIn(): Promise<WebSession> {
	if (webSession && Date.now() - webSession.at < SESSION_MS) return webSession;
	const { ASM_URL, ASM_WEB_URL, ASM_ACCOUNT, ASM_USER, ASM_PASS } = env;
	const origin = ASM_WEB_URL || ASM_URL;
	if (!origin || !ASM_ACCOUNT || !ASM_USER || !ASM_PASS) throw new Error('ASM credentials not configured');
	const s: WebSession = { origin: new URL(origin).origin, cookies: new Map(), at: Date.now() };
	const res = await webFetch(s, '/login', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ database: ASM_ACCOUNT, username: ASM_USER, password: ASM_PASS }).toString()
	});
	const text = (await res.text()).trim();
	const problems: Record<string, string> = {
		FAIL: 'ASM rejected the username or password',
		BADIP: 'ASM does not allow sign-ins from this server’s address',
		ASK2FA: 'the ASM user has two-factor sign-in turned on',
		BAD2FA: 'the ASM user has two-factor sign-in turned on'
	};
	if (problems[text]) throw new Error(`Couldn't sign in to the ASM website: ${problems[text]}`);
	if (!res.ok) throw new Error(`Couldn't sign in to the ASM website (${res.status})`);
	webSession = s;
	return s;
}

/**
 * What one website search returned, in brief, so a miss can say what ASM actually sent
 * back instead of a bare "not found".
 */
export interface AsmSearchSummary {
	q: string;
	/** Dogs returned; other species are left out. */
	rows: number;
	/** The dogs it returned (up to 50), as "code name (species)". */
	sample: string[];
	/** Top-level keys of the response, in case the rows are somewhere else. */
	keys: string[];
}

/**
 * ASM's species id for dogs: 1 in its standard data. Set ASM_DOG_SPECIES_ID if this
 * shelter's differs.
 */
const dogSpeciesId = () => Number(env.ASM_DOG_SPECIES_ID) || 1;

/** A shelter code or short code has digits; a name searched for doesn't. */
const looksLikeCode = (q: string) => /\d/.test(q);

/**
 * Searches every animal in ASM, deceased included. A name is searched for among dogs only,
 * by name only (ASM's advanced search); a code goes through the simple search box, which
 * also matches codes.
 */
export async function searchAsmWebsite(q: string): Promise<AsmDog[]> {
	return (await searchAsmWebsiteWithSummary(q)).dogs;
}

/** One website search, rows with upper-cased keys. */
async function webSearch(params: URLSearchParams): Promise<{ rows: Record<string, unknown>[]; keys: string[] }> {
	const run = (s: WebSession) => webFetch(s, `/animal_find_results?${params}`);
	let s = await webSignIn();
	let res = await run(s);
	let text = await res.text();
	if (!res.ok || !text.trim().startsWith('{')) {
		// Probably an expired session sent back to the sign-in page: sign in again once.
		webSession = null;
		s = await webSignIn();
		res = await run(s);
		text = await res.text();
	}
	if (!res.ok) throw new Error(`ASM website search returned ${res.status}`);
	let data: { rows?: unknown };
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`ASM website search didn't return JSON: ${text.slice(0, 120)}`);
	}
	return {
		rows: (Array.isArray(data.rows) ? (data.rows as Record<string, unknown>[]) : []).map((r) =>
			Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toUpperCase(), v]))
		),
		keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 8) : []
	};
}

const isDogRow = (r: Record<string, unknown>) => String(r.SPECIESNAME ?? 'dog').toLowerCase() === 'dog';

export async function searchAsmWebsiteWithSummary(q: string): Promise<{ dogs: AsmDog[]; summary: AsmSearchSummary }> {
	const simple = new URLSearchParams({ mode: 'SIMPLE', json: 'true', q });
	let found = await webSearch(
		looksLikeCode(q)
			? simple
			: new URLSearchParams({
					mode: 'ADVANCED',
					json: 'true',
					animalname: q,
					speciesid: String(dogSpeciesId()),
					// Without these the advanced search leaves out deceased and non-shelter animals.
					filter: 'includedeceased includenonshelter'
				})
	);
	// No dogs by name: perhaps this shelter's dog species id isn't 1. The simple search
	// finds every species; the dogs are picked out below.
	if (!looksLikeCode(q) && !found.rows.some(isDogRow)) found = await webSearch(simple);
	// Dogs only, whatever the search: a code can belong to a cat.
	const rows = found.rows.filter(isDogRow);
	return {
		dogs: rows.map(toAsmDog).filter((d): d is AsmDog => d !== null),
		summary: {
			q,
			rows: rows.length,
			sample: rows.slice(0, 50).map((r) => `${r.SHELTERCODE ?? r.CODE ?? '?'} ${r.ANIMALNAME ?? '?'} (${r.SPECIESNAME ?? 'no species'})`),
			keys: found.keys
		}
	};
}
