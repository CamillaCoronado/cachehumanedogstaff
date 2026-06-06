import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

const SHEET_ID = '115x6-x7z4IXXKfSW71GQrxfhGEjVRICDl1zKOljGE80';
const API_KEY = env.PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyBYBJpvxuZ1XZjym7cu_nWG2SR-e-lmAZM';

interface CellColor { red: number; green: number; blue: number; }
interface CellData { text: string; color: CellColor | null; }

function isGreen(c: CellColor | null): boolean {
	if (!c) return false;
	return c.green > 0.6 && c.red < 0.7 && c.blue < 0.65;
}

function isYellow(c: CellColor | null): boolean {
	if (!c) return false;
	return c.red > 0.9 && c.green > 0.8 && c.blue < 0.55;
}

function isRed(c: CellColor | null): boolean {
	if (!c) return false;
	return c.red > 0.8 && c.green < 0.5 && c.blue < 0.5;
}


export interface IHVSheetRow {
	name: string;
	email: string;
	phone: string;
	isEstablished: boolean;
	isNonActive: boolean;
	noShowed: boolean;
	trainingSteps: { point: boolean; pointPending: boolean; trained: boolean; computer: boolean; moved: boolean };
	orientationDate: string | null;
	sheetNotes: string;
	rsvpGroup?: string;
	sourceSheet: string;
}

function parseCSVLine(line: string): string[] {
	const fields: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
			else inQuotes = !inQuotes;
		} else if (ch === ',' && !inQuotes) {
			fields.push(cur); cur = '';
		} else {
			cur += ch;
		}
	}
	fields.push(cur);
	return fields.map((f) => f.trim());
}

function isDateHeader(row: string[]): boolean {
	const nonEmpty = row.filter((c) => c.trim());
	if (nonEmpty.length !== 1) return false;
	const val = nonEmpty[0].trim();
	return /\b(st|nd|rd|th)\b/i.test(val) || /^(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(val);
}

function looksLikeEmail(s: string): boolean {
	return s.includes('@') && s.includes('.');
}

function toTitleCase(s: string): string {
	return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONTH_MAP: Record<string, number> = {
	january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
	july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

// "November 15th" or "January 3rd" → "YYYY-MM-DD" (always current year)
function parseGroupDate(raw: string): string | null {
	const match = raw.trim().match(/^(\w+)\s+(\d+)/i);
	if (!match) return null;
	const monthIdx = MONTH_MAP[match[1].toLowerCase()];
	const day = parseInt(match[2], 10);
	if (monthIdx === undefined || isNaN(day)) return null;
	const year = new Date().getFullYear();
	return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// "In House Volunteers" — established active IHVs
async function fetchActiveIHVs(): Promise<IHVSheetRow[]> {
	const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=311017137`;
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`In House Volunteers fetch failed: ${res.status}`);
	const csv = await res.text();
	const lines = csv.split(/\r?\n/).slice(2); // skip color-legend row + column-headers row

	const rows: IHVSheetRow[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		const cols = parseCSVLine(line);
		const firstName = cols[0] ?? '';
		const lastName  = cols[1] ?? '';
		const phone     = cols[2] ?? '';
		const email     = cols[3] ?? '';
		const name = toTitleCase(`${firstName} ${lastName}`.trim());
		if (!name && !email) continue;
		rows.push({
			name,
			email: email.toLowerCase().trim(),
			phone: phone.trim(),
			isEstablished: true,
			isNonActive: false,
			noShowed: false,
			trainingSteps: { point: true, pointPending: false, trained: true, computer: true, moved: true },
			orientationDate: null,
			sheetNotes: '',
			sourceSheet: 'In House Volunteers'
		});
	}
	return rows;
}

// "IHV RSVP & Training" — reads via Sheets API to get per-cell colors
async function fetchIHVTraining(): Promise<IHVSheetRow[]> {
	const range = encodeURIComponent("'IHV RSVP & Training'!A:H");
	const fields = encodeURIComponent('sheets(data(rowData(values(userEnteredFormat/backgroundColor,formattedValue))))');
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?ranges=${range}&fields=${fields}&key=${API_KEY}`;

	const res = await fetch(url);
	if (!res.ok) throw new Error(`Sheets API ${res.status}`);
	const data = await res.json();

	const rawRows: unknown[] = data?.sheets?.[0]?.data?.[0]?.rowData ?? [];
	const sheetRows: CellData[][] = (rawRows as Record<string, unknown>[]).map((row) => {
		const values = (row?.values as Record<string, unknown>[] | undefined) ?? [];
		return values.map((v) => ({
			text: ((v?.formattedValue as string | undefined) ?? '').trim(),
			color: ((v?.userEnteredFormat as Record<string, unknown> | undefined)?.backgroundColor as CellColor | undefined) ?? null
		}));
	});

	const rows: IHVSheetRow[] = [];
	let currentGroup = '';
	let currentGroupDate: string | null = null;

	for (let i = 1; i < sheetRows.length; i++) { // skip row 0 (Pending/Completed header)
		const row = sheetRows[i];
		if (!row || row.length === 0) continue;

		const name  = row[0]?.text ?? '';
		const phone = row[1]?.text ?? '';
		const email = row[2]?.text ?? '';

		// Date header rows: only the first cell has text, rest empty
		const nonEmpty = row.filter((c) => c.text);
		if (nonEmpty.length === 1 && isDateHeader(row.map((c) => c.text))) {
			currentGroup = name;
			currentGroupDate = parseGroupDate(name);
			continue;
		}

		if (!name && !email) continue;
		if (!looksLikeEmail(email) && !name) continue;

		// Step completion = individual cell is green
		const point        = isGreen(row[3]?.color ?? null);
		const pointPending = !point && isYellow(row[3]?.color ?? null);
		const trained  = isGreen(row[4]?.color ?? null);
		const computer = isGreen(row[5]?.color ?? null);
		const moved    = isGreen(row[6]?.color ?? null);

		// Red name cell = no-showed; green = established
		const noShowed   = isRed(row[0]?.color ?? null);
		const established = moved;

		rows.push({
			name: toTitleCase(name.trim()),
			email: email.toLowerCase().trim(),
			phone: phone.trim(),
			isEstablished: established,
			isNonActive: false,
			noShowed,
			trainingSteps: { point, pointPending, trained, computer, moved },
			orientationDate: currentGroupDate,
			sheetNotes: row[7]?.text ?? '',
			rsvpGroup: currentGroup,
			sourceSheet: 'IHV RSVP & Training'
		});
	}
	return rows;
}

// "Non Active Volunteers"
async function fetchNonActiveVolunteers(): Promise<IHVSheetRow[]> {
	const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1188818996`;
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`Non Active Volunteers fetch failed: ${res.status}`);
	const csv = await res.text();
	const lines = csv.split(/\r?\n/).slice(1); // skip header row

	const rows: IHVSheetRow[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		const cols = parseCSVLine(line);

		let name = '';
		let phone = '';
		let email = '';
		let rowNote = '';

		if (looksLikeEmail(cols[4] ?? '')) {
			// Notes | First | Last | Phone | Email  (rows 73-94 pattern)
			rowNote = cols[0] ?? '';
			name    = `${cols[1] ?? ''} ${cols[2] ?? ''}`.trim();
			phone   = cols[3] ?? '';
			email   = cols[4] ?? '';
		} else if (looksLikeEmail(cols[3] ?? '')) {
			// First | Last | Phone | Email
			name  = `${cols[0] ?? ''} ${cols[1] ?? ''}`.trim();
			phone = cols[2] ?? '';
			email = cols[3] ?? '';
		} else if (looksLikeEmail(cols[2] ?? '')) {
			// Full Name | Phone | Email
			name  = cols[0] ?? '';
			phone = cols[1] ?? '';
			email = cols[2] ?? '';
		} else {
			// Last resort: find email in any column
			const emailCol = cols.findIndex(looksLikeEmail);
			if (emailCol < 0) continue;
			email = cols[emailCol] ?? '';
			name  = `${cols[0] ?? ''} ${cols[1] ?? ''}`.trim();
			phone = cols[2] ?? '';
		}

		if (!name && !email) continue;

		rows.push({
			name: toTitleCase(name.trim()),
			email: email.toLowerCase().trim(),
			phone: phone.trim(),
			isEstablished: false,
			isNonActive: true,
			noShowed: false,
			trainingSteps: { point: false, pointPending: false, trained: false, computer: false, moved: false },
			orientationDate: null,
			sheetNotes: rowNote.trim(),
			sourceSheet: 'Non Active Volunteers'
		});
	}
	return rows;
}

export async function GET() {
	const [activeIHVs, trainingIHVs, nonActiveIHVs] = await Promise.all([
		fetchActiveIHVs(),
		fetchIHVTraining(),
		fetchNonActiveVolunteers()
	]);

	// Deduplicate: active list is the source of truth — prefer isEstablished=true
	const seen = new Map<string, IHVSheetRow>();

	function key(r: IHVSheetRow): string {
		return (r.email || r.name).toLowerCase().replace(/\s+/g, '');
	}

	for (const row of [...activeIHVs, ...trainingIHVs, ...nonActiveIHVs]) {
		const k = key(row);
		if (!k) continue;
		const existing = seen.get(k);
		if (!existing || row.isEstablished) seen.set(k, row);
	}

	return json([...seen.values()]);
}
