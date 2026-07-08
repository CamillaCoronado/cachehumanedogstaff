// Shared server-side access to the day-trip/volunteer Google Sheet.
//
// Two modes:
//  1. Service account (preferred): set GOOGLE_SERVICE_ACCOUNT_EMAIL,
//     GOOGLE_SERVICE_ACCOUNT_KEY, and SHEETS_SPREADSHEET_ID, and share the
//     real spreadsheet with the service-account email (Viewer). The sheet
//     stays private — only the service account can read it.
//  2. Fallback (no service account configured): reads Camilla's public copy
//     via link-visible CSV export / API key, exactly as before.
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createSign } from 'node:crypto';

// Camilla's public copy — used only until the service account is configured.
const FALLBACK_SHEET_ID = '115x6-x7z4IXXKfSW71GQrxfhGEjVRICDl1zKOljGE80';

function apiKey(): string {
	return publicEnv.PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyBYBJpvxuZ1XZjym7cu_nWG2SR-e-lmAZM';
}

export function sheetId(): string {
	return env.SHEETS_SPREADSHEET_ID || FALLBACK_SHEET_ID;
}

function serviceAccountConfigured(): boolean {
	return Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

// ─── Service-account OAuth (JWT bearer flow, no external deps) ───────────────

let cachedToken: { token: string; expiresAtMs: number } | null = null;

function base64url(input: string | Buffer): string {
	return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(): Promise<string | null> {
	if (!serviceAccountConfigured()) return null;
	if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) return cachedToken.token;

	const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
	// The key arrives via env with literal "\n" sequences — restore real newlines.
	const privateKey = env.GOOGLE_SERVICE_ACCOUNT_KEY!.replace(/\\n/g, '\n');

	const nowSec = Math.floor(Date.now() / 1000);
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const claims = base64url(
		JSON.stringify({
			iss: email,
			scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
			aud: 'https://oauth2.googleapis.com/token',
			iat: nowSec,
			exp: nowSec + 3600
		})
	);
	const unsigned = `${header}.${claims}`;
	const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey);
	const assertion = `${unsigned}.${base64url(signature)}`;

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion
		})
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Service-account token exchange failed: ${res.status} ${body.slice(0, 200)}`);
	}
	const data = (await res.json()) as { access_token: string; expires_in: number };
	cachedToken = { token: data.access_token, expiresAtMs: Date.now() + data.expires_in * 1000 };
	return cachedToken.token;
}

// ─── CSV parsing (RFC 4180 fields; rows split on newlines as before) ─────────

export function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
			else inQuotes = !inQuotes;
		} else if (ch === ',' && !inQuotes) {
			fields.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	fields.push(cur);
	return fields;
}

// ─── Readers ──────────────────────────────────────────────────────────────────

/**
 * Read a whole tab as rows of cells. Uses the Sheets values API (by tab title)
 * with the service account; falls back to public CSV export (by gid) against
 * the copy. Trailing empty cells may be absent — index defensively.
 */
export async function fetchTabRows(tabTitle: string, fallbackGid: string): Promise<string[][]> {
	const token = await getAccessToken();
	if (token) {
		const range = encodeURIComponent(`'${tabTitle}'`);
		const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${range}?majorDimension=ROWS`;
		const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) throw new Error(`Sheets values API ${res.status} for tab "${tabTitle}"`);
		const data = (await res.json()) as { values?: string[][] };
		return (data.values ?? []).map((row) => row.map((cell) => cell ?? ''));
	}

	const url = `https://docs.google.com/spreadsheets/d/${sheetId()}/export?format=csv&gid=${fallbackGid}`;
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`Sheet CSV fetch failed: ${res.status} for tab "${tabTitle}"`);
	const csv = await res.text();
	return csv.split(/\r?\n/).map(parseCsvLine);
}

/**
 * Read a range with cell formatting (background colors). Returns the raw
 * `rowData` array from the Sheets grid response.
 */
export async function fetchGridRowData(range: string): Promise<unknown[]> {
	const token = await getAccessToken();
	const encodedRange = encodeURIComponent(range);
	const fields = encodeURIComponent('sheets(data(rowData(values(userEnteredFormat/backgroundColor,formattedValue))))');
	const auth = token ? '' : `&key=${apiKey()}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}?ranges=${encodedRange}&fields=${fields}${auth}`;
	const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Sheets API ${res.status}: ${body.slice(0, 200)}`);
	}
	const data = (await res.json()) as { sheets?: { data?: { rowData?: unknown[] }[] }[] };
	return data?.sheets?.[0]?.data?.[0]?.rowData ?? [];
}
