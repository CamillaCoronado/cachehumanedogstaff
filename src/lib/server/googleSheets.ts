// Shared server-side access to the day-trip/volunteer Google Sheet.
//
// Reads the real (private) spreadsheet with a service account. Set
// GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY, and
// SHEETS_SPREADSHEET_ID, and share the spreadsheet with the service-account
// email (Viewer). There is no fallback: a missing var is an error naming it.
import { env } from '$env/dynamic/private';
import { createSign } from 'node:crypto';

const REQUIRED_VARS = ['SHEETS_SPREADSHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'] as const;

function requireSheetsConfig(): void {
	const missing = REQUIRED_VARS.filter((name) => !env[name]);
	if (missing.length > 0) {
		throw new Error(`Google Sheets not configured: missing ${missing.join(', ')}`);
	}
}

function sheetId(): string {
	requireSheetsConfig();
	return env.SHEETS_SPREADSHEET_ID!;
}

// ─── Service-account OAuth (JWT bearer flow, no external deps) ───────────────

let cachedToken: { token: string; expiresAtMs: number } | null = null;

function base64url(input: string | Buffer): string {
	return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(): Promise<string> {
	requireSheetsConfig();
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

// ─── Readers ──────────────────────────────────────────────────────────────────

/**
 * Read a whole tab as rows of cells, by tab title. Trailing empty cells may be
 * absent — index defensively.
 */
export async function fetchTabRows(tabTitle: string): Promise<string[][]> {
	const token = await getAccessToken();
	const range = encodeURIComponent(`'${tabTitle}'`);
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${range}?majorDimension=ROWS`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Sheets values API ${res.status} for tab "${tabTitle}": ${body.slice(0, 200)}`);
	}
	const data = (await res.json()) as { values?: string[][] };
	return (data.values ?? []).map((row) => row.map((cell) => cell ?? ''));
}

/**
 * Read a range with cell formatting (background colors). Returns the raw
 * `rowData` array from the Sheets grid response.
 */
export async function fetchGridRowData(range: string): Promise<unknown[]> {
	const token = await getAccessToken();
	const encodedRange = encodeURIComponent(range);
	const fields = encodeURIComponent('sheets(data(rowData(values(userEnteredFormat/backgroundColor,formattedValue))))');
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}?ranges=${encodedRange}&fields=${fields}`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Sheets API ${res.status}: ${body.slice(0, 200)}`);
	}
	const data = (await res.json()) as { sheets?: { data?: { rowData?: unknown[] }[] }[] };
	return data?.sheets?.[0]?.data?.[0]?.rowData ?? [];
}
