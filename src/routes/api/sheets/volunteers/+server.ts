import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

const API_KEY = env.PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyBYBJpvxuZ1XZjym7cu_nWG2SR-e-lmAZM';
const SHEET_ID = '115x6-x7z4IXXKfSW71GQrxfhGEjVRICDl1zKOljGE80';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VolunteerSheetRow {
	name: string;
	email: string;
	submittedAt: string | null;
	hasDriversLicense: boolean;
	is18Plus: boolean;
	dogExperience: string;
	adventurePlans: string;
	photosOk: boolean;
	leashCommitment: boolean;
	orientationStatus: 'pending' | 'emailed' | 'scheduled' | 'signed_waiver' | 'answered_no' | 'no_showed';
	isEstablished: boolean;
	orientationDate: string | null;
	sourceSheet?: string;
	sourceRow?: number;
}

// ─── Sheets API helpers ───────────────────────────────────────────────────────

interface CellColor { red: number; green: number; blue: number; }
interface CellData { text: string; color: CellColor | null; }

function colorDist(a: CellColor, b: CellColor): number {
	return Math.sqrt(
		(a.red - b.red) ** 2 +
		(a.green - b.green) ** 2 +
		(a.blue - b.blue) ** 2
	);
}

function isWhite(c: CellColor): boolean {
	return c.red > 0.95 && c.green > 0.95 && c.blue > 0.95;
}

function normalizeIdentityPart(value: string): string {
	return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function volunteerIdentityKey(name: string, email: string): string {
	return `${normalizeIdentityPart(name)}|${normalizeIdentityPart(email)}`;
}

// Parse a date string like "6/15/2025", "June 15", "6/15" → "YYYY-MM-DD" or null
function parseSheetDate(raw: string): string | null {
	if (!raw.trim()) return null;
	const s = raw.trim();
	// Try M/D/YYYY or M/D/YY
	const mdy = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
	if (mdy) {
		const m = parseInt(mdy[1], 10);
		const d = parseInt(mdy[2], 10);
		const y = mdy[3] ? (mdy[3].length === 2 ? 2000 + parseInt(mdy[3], 10) : parseInt(mdy[3], 10)) : new Date().getFullYear();
		if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
			return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
		}
	}
	// Try native Date parse (handles "June 15, 2025" etc.)
	const dt = new Date(s);
	if (!isNaN(dt.getTime())) {
		return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
	}
	return null;
}

async function fetchSheetRows(sheetName: string): Promise<CellData[][]> {
	const range = encodeURIComponent(`'${sheetName}'!A:O`);
	const fields = encodeURIComponent('sheets(data(rowData(values(userEnteredFormat/backgroundColor,formattedValue))))');
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?ranges=${range}&fields=${fields}&key=${API_KEY}`;

	const res = await fetch(url);
	if (!res.ok) throw new Error(`Sheets API ${res.status}`);
	const data = await res.json();

	const rowData: unknown[] = data?.sheets?.[0]?.data?.[0]?.rowData ?? [];
	return (rowData as Record<string, unknown>[]).map((row) => {
		const values = (row?.values as Record<string, unknown>[] | undefined) ?? [];
		return values.map((v) => {
			const bg = (v?.userEnteredFormat as Record<string, unknown> | undefined)?.backgroundColor as CellColor | undefined;
			return {
				text: ((v?.formattedValue as string | undefined) ?? '').trim(),
				color: bg ?? null
			};
		});
	});
}

// ─── CSV helper for Established DTVs ─────────────────────────────────────────

interface EstablishedRow { name: string; email: string; rowNumber: number; }

export interface SkippedSheetRow {
	sheet: string;
	rowNumber: number;
	reason: string;
	name?: string;
	email?: string;
}

export interface VolunteerSheetDiagnostics {
	skippedRows: SkippedSheetRow[];
	establishedRawDataRows: number;
	establishedRowsRead: number;
	establishedRowsReturned: number;
	establishedRowsExpected: number;
	volunteerRowsReturned: number;
}

export interface VolunteerSheetResponse {
	rows: VolunteerSheetRow[];
	diagnostics: VolunteerSheetDiagnostics;
}

// Proper RFC-4180 CSV field parser — handles quoted fields containing commas/newlines
function parseCSVLine(line: string): string[] {
	const fields: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
			else inQuotes = !inQuotes;
		} else if (ch === ',' && !inQuotes) {
			fields.push(cur); cur = '';
		} else {
			cur += ch;
		}
	}
	fields.push(cur);
	return fields;
}

async function fetchEstablishedVolunteers(): Promise<{ rows: EstablishedRow[]; skippedRows: SkippedSheetRow[]; rawDataRows: number; nonBlankRows: number }> {
	const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=538722785`;
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) return { rows: [], skippedRows: [], rawDataRows: 0, nonBlankRows: 0 };
	const csv = await res.text();
	const lines = csv.split(/\r?\n/).slice(1); // skip header
	const seen = new Set<string>();
	const rows: EstablishedRow[] = [];
	const skippedRows: SkippedSheetRow[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const rowNumber = i + 2;
		if (!line.trim()) {
			skippedRows.push({ sheet: 'Established DTVs', rowNumber, reason: 'blank row' });
			continue;
		}
		// columns: First name, Last Name, Email, Strikes
		const parts = parseCSVLine(line);
		const firstName = parts[0]?.trim() ?? '';
		const lastName  = parts[1]?.trim() ?? '';
		const email     = parts[2]?.trim().toLowerCase() ?? '';
		const name = `${firstName} ${lastName}`.trim();
		if (!email) {
			rows.push({ name, email, rowNumber });
			continue;
		}
		const identity = volunteerIdentityKey(name, email);
		if (seen.has(identity)) {
			skippedRows.push({ sheet: 'Established DTVs', rowNumber, reason: 'duplicate name and email in Established DTVs export', name, email });
			continue;
		}
		seen.add(identity);
		rows.push({ name, email, rowNumber });
	}
	logSkippedSheetRows(skippedRows);
	return {
		rows,
		skippedRows,
		rawDataRows: lines.length,
		nonBlankRows: lines.filter((line) => line.trim()).length
	};
}

function logSkippedSheetRows(skippedRows: SkippedSheetRow[]): void {
	if (skippedRows.length === 0) return;
	console.warn(`[DTV sheet sync] Skipped ${skippedRows.length} row${skippedRows.length === 1 ? '' : 's'}:`);
	for (const skipped of skippedRows) {
		console.warn('[DTV sheet sync] skipped row', skipped);
	}
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
	if (!API_KEY) throw error(503, 'API key not configured');

	let rows: CellData[][];
	let establishedVolunteers: EstablishedRow[];
	let establishedSkippedRows: SkippedSheetRow[];
	let establishedRawDataRows = 0;
	let establishedRowsRead = 0;

	try {
		const [responseRows, establishedResult] = await Promise.all([
			fetchSheetRows('Day Trip Volunteer Responses'),
			fetchEstablishedVolunteers()
		]);
		rows = responseRows;
		establishedVolunteers = establishedResult.rows;
		establishedSkippedRows = establishedResult.skippedRows;
		establishedRawDataRows = establishedResult.rawDataRows;
		establishedRowsRead = establishedResult.nonBlankRows;
	} catch (e) {
		throw error(502, `Sheet fetch error: ${e instanceof Error ? e.message : String(e)}`);
	}

	const establishedIdentities = new Set(establishedVolunteers.map((r) => volunteerIdentityKey(r.name, r.email)));

	if (rows.length < 3) {
		return json({
			rows: [],
			diagnostics: {
				skippedRows: establishedSkippedRows,
				establishedRawDataRows,
				establishedRowsRead,
				establishedRowsReturned: establishedVolunteers.length,
				establishedRowsExpected: establishedVolunteers.length,
				volunteerRowsReturned: 0
			}
		} satisfies VolunteerSheetResponse);
	}

	// Row 0 = column headers (Timestamp, Email Address, Name, Email, ...)
	// Row 1 = color legend: each cell has a label + color
	// Rows 2+ = volunteer data

	// Build color → status map from the legend row
	const statusLabels: Record<string, 'emailed' | 'scheduled' | 'signed_waiver' | 'answered_no' | 'no_showed'> = {
		'emailed': 'emailed',
		'scheduled': 'scheduled',
		'signed waiver': 'signed_waiver',
		"answered 'no'": 'answered_no',
		"answered no": 'answered_no',
		'no showed to overview': 'no_showed',
		'no showed': 'no_showed'
	};

	const legendEntries: { color: CellColor; status: VolunteerSheetRow['orientationStatus'] }[] = [];
	for (const cell of rows[1] ?? []) {
		if (!cell.color || isWhite(cell.color)) continue;
		const label = cell.text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/['']/, "'");
		const status = statusLabels[label];
		if (status) legendEntries.push({ color: cell.color, status });
	}

	// Purple (#8e7cc3) = private orientation with Shivani — not in legend, treat as scheduled
	// col0 on purple rows is descriptive text ("private orientation with Shivani"), NOT a date
	const PURPLE: CellColor = { red: 142 / 255, green: 124 / 255, blue: 195 / 255 };

	function resolveStatus(rowColor: CellColor | null): VolunteerSheetRow['orientationStatus'] {
		if (!rowColor || isWhite(rowColor)) return 'pending';
		// Purple check first — not in legend but is a scheduled private orientation
		if (colorDist(rowColor, PURPLE) < 0.15) return 'scheduled';
		let best: VolunteerSheetRow['orientationStatus'] = 'pending';
		let bestDist = 0.4;
		for (const entry of legendEntries) {
			const d = colorDist(rowColor, entry.color);
			if (d < bestDist) { bestDist = d; best = entry.status; }
		}
		return best;
	}

	// True only for yellow legend "Scheduled" rows — col0 on these rows holds the orientation date
	function isYellowScheduled(rowColor: CellColor | null): boolean {
		if (!rowColor) return false;
		const entry = legendEntries.find((e) => e.status === 'scheduled');
		return entry ? colorDist(rowColor, entry.color) < 0.4 : false;
	}

	// Column indices from header row — normalize curly apostrophes so searches work
	const headers = (rows[0] ?? []).map((c) =>
		c.text.toLowerCase().replace(/[‘’‚‛]/g, "'")
	);
	const idx = (kw: string) => headers.findIndex((h) => h.includes(kw));

	const iTimestamp = 0;
	const iEmail = idx('email address') !== -1 ? idx('email address') : 1;
	const iName = idx('first and last') !== -1 ? idx('first and last') : 2;
	const iLicense = idx("driver's license");
	const i18 = idx('18 years');
	const iExp = idx('experience');
	const iAdv = idx('adventures');
	const iPhotos = idx('pictures');
	const iLeash = idx('leash');

	const yesVals = new Set(['yes', '✓', 'x', 'true']);
	const parseBool = (s: string) => yesVals.has(s.toLowerCase().trim());

	// True if col0 looks like a full Google Form timestamp ("M/D/YYYY HH:MM:SS")
	// vs a short orientation date Liz enters manually ("2/27", "4/3", etc.)
	function isFullTimestamp(s: string): boolean {
		return s.includes(':') && /\d{4}/.test(s);
	}

	const statusPriority: Record<string, number> = {
		signed_waiver: 5, no_showed: 4, answered_no: 3, scheduled: 2, emailed: 1, pending: 0
	};

	// Map from email → best row seen so far (deduplicate by email, keep most-advanced status)
	const responseByIdentity = new Map<string, VolunteerSheetRow>();
	const skippedRows: SkippedSheetRow[] = [];

	for (let i = 2; i < rows.length; i++) {
		const row = rows[i];
		const rowNumber = i + 1;
		if (!row || row.length === 0) {
			skippedRows.push({ sheet: 'Day Trip Volunteer Responses', rowNumber, reason: 'empty row' });
			continue;
		}
		const get = (idx: number) => (idx >= 0 && idx < row.length ? row[idx].text : '');
		const name = get(iName);
		const email = get(iEmail).toLowerCase();
		if (!name && !email) {
			skippedRows.push({ sheet: 'Day Trip Volunteer Responses', rowNumber, reason: 'missing name and email' });
			continue;
		}

		const rowColor = row[0]?.color ?? null;
		const col0 = get(iTimestamp);
		const col0HasDate = col0.trim() !== '' && !isFullTimestamp(col0);

		// Base status from color; dark red maps to answered_no by distance (they replied
		// to Liz's email saying they can't make orientation), but if col0 was overwritten
		// with a short date it means they were scheduled and no-showed instead
		let status = resolveStatus(rowColor);
		if (status === 'answered_no' && col0HasDate) status = 'no_showed';

		// Orientation date: yellow scheduled rows AND no-show rows both store
		// the orientation date in col0 (overwriting the original timestamp)
		const orientationDate =
			isYellowScheduled(rowColor) || status === 'no_showed'
				? parseSheetDate(col0)
				: null;

		// submittedAt is only valid when col0 is still a real form timestamp
		const submittedAt =
			status === 'scheduled' || col0HasDate ? null : (col0 || null);

		const candidate: VolunteerSheetRow = {
			name,
			email,
			submittedAt,
			hasDriversLicense: parseBool(get(iLicense)),
			is18Plus: parseBool(get(i18)),
			dogExperience: get(iExp),
			adventurePlans: get(iAdv),
			photosOk: parseBool(get(iPhotos)),
			leashCommitment: parseBool(get(iLeash)),
			orientationStatus: status,
			isEstablished: establishedIdentities.has(volunteerIdentityKey(name, email)),
			orientationDate,
			sourceSheet: 'Day Trip Volunteer Responses',
			sourceRow: rowNumber
		};

		const key = volunteerIdentityKey(name, email);
		const existing = responseByIdentity.get(key);
		if (!existing || (statusPriority[status] ?? 0) >= (statusPriority[existing.orientationStatus] ?? 0)) {
			if (existing) {
				skippedRows.push({ sheet: 'Day Trip Volunteer Responses', rowNumber: existing.sourceRow ?? 0, reason: `duplicate name+email — superseded by row ${rowNumber}`, name: existing.name, email: existing.email });
			}
			responseByIdentity.set(key, candidate);
		} else {
			skippedRows.push({ sheet: 'Day Trip Volunteer Responses', rowNumber, reason: `duplicate name+email — kept row ${existing.sourceRow ?? '?'} (more advanced status)`, name, email });
		}
	}

	const volunteers = [...responseByIdentity.values()];

	// Add established volunteers who never submitted the sign-up form
	const responseIdentities = new Set(volunteers.map((v) => volunteerIdentityKey(v.name, v.email)));
	for (const est of establishedVolunteers) {
		if (responseIdentities.has(volunteerIdentityKey(est.name, est.email))) continue;
		volunteers.push({
			name: est.name,
			email: est.email,
			submittedAt: null,
			hasDriversLicense: false,
			is18Plus: false,
			dogExperience: '',
			adventurePlans: '',
			photosOk: false,
			leashCommitment: false,
			orientationStatus: 'signed_waiver',
			isEstablished: true,
			orientationDate: null,
			sourceSheet: 'Established DTVs',
			sourceRow: est.rowNumber
		});
	}

	logSkippedSheetRows(skippedRows);

	return json({
		rows: volunteers,
		diagnostics: {
			skippedRows: [...establishedSkippedRows, ...skippedRows],
			establishedRawDataRows,
			establishedRowsRead,
			establishedRowsReturned: establishedVolunteers.length,
			establishedRowsExpected: establishedVolunteers.length,
			volunteerRowsReturned: volunteers.length
		}
	} satisfies VolunteerSheetResponse);
}
