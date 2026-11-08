/**
 * A dog's returns, from its movements in ASM. ASM records a return on the movement that
 * took the dog out (an adoption, a transfer...): the return date, a category, and the
 * reason staff typed. Foster and retailer movements are left out: a dog in foster is
 * still ours, so coming back from one isn't a re-entry.
 */
export interface AsmReturn {
	/** YYYY-MM-DD the dog came back. */
	returnedAt: string;
	/** YYYY-MM-DD it left on that movement. */
	leftAt: string | null;
	/** ASM's name for the movement, e.g. "Adoption", "Trial Adoption", "Transfer". */
	movement: string;
	/** ASM's return category ("Return Category" on the movement). */
	category: string;
	/** What staff wrote in the movement's "Reason". */
	reason: string;
}

const FOSTER = 2;
const RETAILER = 8;

const day = (v: unknown): string | null => {
	const m = typeof v === 'string' ? v.match(/(\d{4})[-/](\d{2})[-/](\d{2})/) : null;
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Returns in date order, from ASM's animal_movements rows (any key case). */
export function parseAsmReturns(rows: Record<string, unknown>[], today: string): AsmReturn[] {
	const out: AsmReturn[] = [];
	for (const raw of rows) {
		const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toUpperCase(), v]));
		const type = Number(r.MOVEMENTTYPE);
		if (!(type > 0) || type === FOSTER || type === RETAILER) continue;
		const returnedAt = day(r.RETURNDATE);
		// A return dated ahead hasn't happened yet; ASM doesn't count it either.
		if (!returnedAt || returnedAt > today) continue;
		out.push({
			returnedAt,
			leftAt: day(r.MOVEMENTDATE),
			movement: text(r.MOVEMENTNAME),
			category: text(r.RETURNEDREASONNAME),
			reason: text(r.REASONFORRETURN)
		});
	}
	return out.sort((a, b) => a.returnedAt.localeCompare(b.returnedAt));
}

/**
 * The dogs whose returns need reading from ASM: ones whose latest intake is later than
 * the first (only those have been returned), and whose history wasn't already read for
 * that intake. returnHistoryFor holds the intake the stored history was read at.
 * With neverRead, every ASM dog not read yet is taken too.
 */
export function dogsNeedingReturns(
	docs: Map<string, Record<string, unknown>>,
	opts: { neverRead?: boolean } = {}
): { id: string; asmId: number; intake: string }[] {
	const out: { id: string; asmId: number; intake: string }[] = [];
	for (const [id, d] of docs) {
		const asmId = typeof d.asmId === 'number' ? d.asmId : /^\d+$/.test(id) ? Number(id) : NaN;
		if (!Number.isFinite(asmId)) continue;
		const intake = day(d.intakeDate);
		const original = day(d.originalIntakeDate);
		if (!intake) continue;
		// neverRead (the Admin backfill) also takes dogs whose dates don't show a return
		// yet: ASM caches the shelter list for up to an hour, but its movements are live.
		const returned = Boolean(original && intake > original);
		const unread = d.returnHistoryFor === undefined;
		if (!returned && !(opts.neverRead && unread)) continue;
		if (d.returnHistoryFor === intake) continue;
		out.push({ id, asmId, intake });
	}
	return out;
}

const LEFT_AS: Record<string, string> = {
	adoption: 'Adopted',
	'trial adoption': 'Trial adoption',
	transfer: 'Transferred',
	reclaimed: 'Reclaimed',
	escaped: 'Escaped',
	stolen: 'Stolen',
	'released to wild': 'Released',
	released: 'Released'
};

/** How the dog left, as a past-tense verb: "Adopted", "Transferred"... */
export function leftAsLabel(movement: string): string {
	const known = LEFT_AS[movement.trim().toLowerCase()];
	if (known) return known;
	return movement.trim() ? `Left (${movement.trim()})` : 'Left';
}

/** How long the dog was gone, e.g. "2 years", "3 days". Null without both dates. */
export function timeAway(leftAt: string | null, returnedAt: string): string | null {
	if (!leftAt) return null;
	const [ly, lm, ld] = leftAt.split('-').map(Number);
	const [ry, rm, rd] = returnedAt.split('-').map(Number);
	const days = Math.round((Date.UTC(ry, rm - 1, rd) - Date.UTC(ly, lm - 1, ld)) / 86_400_000);
	if (!(days >= 0)) return null;
	const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
	const months = (ry - ly) * 12 + (rm - lm) - (rd < ld ? 1 : 0);
	if (months >= 12) return plural(Math.floor(months / 12), 'year');
	if (months >= 1) return plural(months, 'month');
	return days === 0 ? 'the same day' : plural(days, 'day');
}
