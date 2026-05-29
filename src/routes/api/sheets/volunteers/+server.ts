import { json, error } from '@sveltejs/kit';

const SHEET_ID = '115x6-x7z4IXXKfSW71GQrxfhGEjVRICDl1zKOljGE80';
const SHEET_NAME = 'Day Trip Volunteer Responses';

// Robust CSV parser that handles quoted fields with embedded commas/newlines
function parseCsvRow(line: string): string[] {
	const cells: string[] = [];
	let i = 0;
	while (i < line.length) {
		if (line[i] === '"') {
			let val = '';
			i++; // skip opening quote
			while (i < line.length) {
				if (line[i] === '"' && line[i + 1] === '"') {
					val += '"';
					i += 2;
				} else if (line[i] === '"') {
					i++; // skip closing quote
					break;
				} else {
					val += line[i++];
				}
			}
			cells.push(val);
			if (line[i] === ',') i++;
		} else {
			const end = line.indexOf(',', i);
			if (end === -1) {
				cells.push(line.slice(i).trim());
				break;
			}
			cells.push(line.slice(i, end).trim());
			i = end + 1;
		}
	}
	return cells;
}

function parseBool(val: string): boolean {
	return val.trim().toLowerCase() === 'yes' || val.trim() === '✓' || val.trim() === 'x';
}

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
	// Liz's status columns
	emailed: boolean;
	scheduled: boolean;
	waiverSigned: boolean;
	answeredNo: boolean;
	noShowed: boolean;
}

export async function GET() {
	const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

	let res: Response;
	try {
		res = await fetch(url, { redirect: 'follow' });
	} catch (e) {
		throw error(502, `Sheet fetch error: ${e instanceof Error ? e.message : String(e)}`);
	}

	if (!res.ok) {
		throw error(502, `Sheet fetch failed: ${res.status}`);
	}

	const csv = await res.text();
	const lines = csv.split(/\r?\n/).filter((l) => l.trim());
	if (lines.length < 2) return json([]);

	// Parse header row to find column indices
	const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase().trim());

	const colIdx = (keyword: string) => headers.findIndex((h) => h.includes(keyword));

	const idxTimestamp = 0;
	const idxEmail = colIdx('email address') !== -1 ? colIdx('email address') : 1;
	const idxName = colIdx('first and last name') !== -1 ? colIdx('first and last name') : 2;
	const idxLicense = colIdx("driver's license");
	const idx18 = colIdx('18 years');
	const idxExperience = colIdx('experience');
	const idxAdventures = colIdx('adventures');
	const idxPhotos = colIdx('pictures');
	const idxLeash = colIdx('leash');
	const idxEmailed = colIdx('emailed');
	const idxScheduled = colIdx('scheduled');
	const idxWaiver = colIdx('signed waiver');
	const idxAnsweredNo = colIdx("answered 'no'");
	const idxNoShowed = colIdx('no show');

	const volunteers: VolunteerSheetRow[] = [];

	for (let i = 1; i < lines.length; i++) {
		const row = parseCsvRow(lines[i]);
		const name = (idxName >= 0 ? row[idxName] : '').trim();
		const email = (idxEmail >= 0 ? row[idxEmail] : row[1] ?? '').trim().toLowerCase();
		if (!name && !email) continue;

		volunteers.push({
			name,
			email,
			submittedAt: row[idxTimestamp]?.trim() || null,
			hasDriversLicense: idxLicense >= 0 ? parseBool(row[idxLicense] ?? '') : false,
			is18Plus: idx18 >= 0 ? parseBool(row[idx18] ?? '') : false,
			dogExperience: (idxExperience >= 0 ? row[idxExperience] : '').trim(),
			adventurePlans: (idxAdventures >= 0 ? row[idxAdventures] : '').trim(),
			photosOk: idxPhotos >= 0 ? parseBool(row[idxPhotos] ?? '') : false,
			leashCommitment: idxLeash >= 0 ? parseBool(row[idxLeash] ?? '') : false,
			emailed: idxEmailed >= 0 ? !!(row[idxEmailed] ?? '').trim() : false,
			scheduled: idxScheduled >= 0 ? !!(row[idxScheduled] ?? '').trim() : false,
			waiverSigned: idxWaiver >= 0 ? !!(row[idxWaiver] ?? '').trim() : false,
			answeredNo: idxAnsweredNo >= 0 ? !!(row[idxAnsweredNo] ?? '').trim() : false,
			noShowed: idxNoShowed >= 0 ? !!(row[idxNoShowed] ?? '').trim() : false
		});
	}

	return json(volunteers);
}
