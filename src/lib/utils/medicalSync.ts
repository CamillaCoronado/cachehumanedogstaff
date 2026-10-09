/**
 * Fills the Medical page from ASM's medical book on every sync. ASM keeps spay/neuters,
 * flea treatments and FortiFlora as medical regimens like any other, so each regimen is
 * sorted by its name into the card it belongs on. ASM wins for anything that came from
 * it; what staff entered only in the app is left alone, except a surgery ASM never
 * shows as done, which is dropped once its day is over.
 */

/** One ASM medical regimen (a course of treatment), as the medical book shows it. */
export interface AsmRegimen {
	regimenId: number;
	animalId: number;
	shelterCode: string;
	shortCode: string;
	treatmentName: string;
	dosage: string;
	/** "One Off", "1 treatments every 1 days"… as ASM words it. */
	frequency: string;
	comments: string;
	/** YYYY-MM-DD the regimen started. */
	startDate: string | null;
	/** YYYY-MM-DD of the next dose still to give. */
	nextDue: string | null;
	/** Hour (0–23) the next dose is due, when ASM has a time on it. */
	nextDueHour: number | null;
	/** Doses left, the next one included. */
	remaining: number;
	/** Doses per period; 0 is a one-off. */
	perPeriod: number;
	/** ASM's period unit: 0 days, 4 weekdays, 1 weeks, 2 months, 3 years. */
	unit: number;
	/** Periods between doses ("every 2 weeks" is 2). */
	every: number;
	/** How many periods the whole course runs. */
	totalPeriods: number;
	/** No set length in ASM ("unspecified"), so no end. */
	openEnded: boolean;
}

/** A dose ASM shows as given, from the medical book's recently-given view. */
export interface AsmGivenDose {
	regimenId: number;
	animalId: number;
	treatmentName: string;
	/** YYYY-MM-DD it was given. */
	given: string;
	openEnded: boolean;
}

export type RegimenKind = 'surgery' | 'fortiflora' | 'fleas' | 'treatment';

const SURGERY = /spay|neuter|castrat|ovariohyster|\bohe\b|orchiect|surgery|surgical|dental|amputat|enucleat|cystotomy|mass removal|lump removal|cherry eye|entropion|hernia/i;

/** Which Medical page card a regimen belongs on, from its name. */
export function regimenKind(name: string, openEnded: boolean): RegimenKind {
	if (/fortiflora/i.test(name)) return 'fortiflora';
	if (SURGERY.test(name)) return 'surgery';
	// A flea treatment means fleas; an ongoing monthly preventative does not.
	if (/flea|capstar/i.test(name) && !openEnded && !/prevent/i.test(name)) return 'fleas';
	return 'treatment';
}

/**
 * Treatments that suggest a dog could spread what it has, and what to call it. Matched on
 * the treatment's name, reason and notes (ASM's dosage and comments land in the notes), so
 * "Doxycycline" and "Clavamox — for kennel cough" both count. Routine dewormers don't:
 * fenbendazole alone isn't here, giardia is.
 */
export const CONTAGIOUS: { label: string; match: RegExp }[] = [
	{ label: 'URI', match: /\buri\b|upper resp|kennel cough|\bcirdc\b|bordetella|canine flu|influenza|doxycycline|\bdoxy\b/i },
	{ label: 'parvo', match: /parvo/i },
	{ label: 'distemper', match: /distemper/i },
	{ label: 'giardia', match: /giardia|metronidazole|flagyl/i },
	{ label: 'coccidia', match: /coccidi|ponazuril|marquis|albon|sulfadimethoxine/i },
	{ label: 'ringworm', match: /ringworm|dermatophyt|lime sulfur|terbinafine|itraconazole/i },
	{ label: 'mange', match: /sarcoptic|scabies/i }
];

/** What a treatment's text says the dog could spread, or null. */
export function contagionOf(...text: (string | null | undefined)[]): string | null {
	const all = text.filter(Boolean).join(' ');
	return CONTAGIOUS.find((c) => c.match.test(all))?.label ?? null;
}

/**
 * What a dog's treatments say it could spread ("URI, giardia"), or null. The Medical page
 * suggests marking such a dog sick; it never marks it on its own.
 */
export function dogContagion(treatments: { name: string; condition?: string | null; notes?: string | null }[]): string | null {
	const found = [...new Set(treatments.map((t) => contagionOf(t.name, t.condition, t.notes)).filter((c): c is string => Boolean(c)))].sort();
	return found.length > 0 ? found.join(', ') : null;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s: string) => {
	const [y, m, d] = s.split('-').map(Number);
	return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
	const d = fromYmd(s);
	d.setDate(d.getDate() + n);
	return ymd(d);
};

/**
 * The day of a regimen's last dose. ASM only creates the next dose, so this counts on
 * from it: one period per remaining batch of doses. Null when the course has no end.
 */
export function lastDoseDate(r: AsmRegimen): string | null {
	if (!r.nextDue) return null;
	if (r.perPeriod <= 0) return r.nextDue;
	if (r.openEnded) return null;
	const periods = Math.max(1, Math.ceil(r.remaining / r.perPeriod)) - 1;
	const d = fromYmd(r.nextDue);
	const steps = periods * r.every;
	if (r.unit === 1) d.setDate(d.getDate() + steps * 7);
	else if (r.unit === 2) d.setMonth(d.getMonth() + steps);
	else if (r.unit === 3) d.setFullYear(d.getFullYear() + steps);
	else if (r.unit === 4) d.setDate(d.getDate() + Math.ceil((steps * 7) / 5));
	else d.setDate(d.getDate() + steps);
	return ymd(d);
}

/** How many days a course runs, for the FortiFlora card. Null when it has no end. */
function courseDays(r: AsmRegimen): number | null {
	if (r.perPeriod <= 0) return 1;
	if (r.openEnded || r.totalPeriods <= 0) return null;
	const per = r.unit === 1 ? 7 : r.unit === 2 ? 30 : r.unit === 3 ? 365 : 1;
	return r.totalPeriods * r.every * per;
}

const SHELTER_TZ = 'America/Denver';
const shelterDay = new Intl.DateTimeFormat('en-CA', { timeZone: SHELTER_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today on the shelter's clock (the server runs in UTC). */
export const shelterToday = (now = new Date()) => shelterDay.format(now);

/** The shelter day of a stored date: a date-only value as is, a timestamp on the shelter's clock. */
export function storedDay(v: unknown): string | null {
	if (typeof v !== 'string' || !v) return null;
	const dateOnly = v.match(/^(\d{4}-\d{2}-\d{2})(T00:00:00(\.0+)?Z?)?$/);
	if (dateOnly) return dateOnly[1];
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : shelterDay.format(d);
}

/** Midday on the shelter's clock as stored, so the day reads the same everywhere in the US. */
export const storedNoon = (day: string | null) => (day ? `${day}T18:00:00.000Z` : null);

type Doc = Record<string, unknown>;
type StoredTreatment = {
	id: string;
	name: string;
	condition?: string | null;
	notes?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	asmRegimenId?: number | null;
};

const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sameName = (a: unknown, b: unknown) => {
	const x = nameKey(a);
	const y = nameKey(b);
	return Boolean(x && y) && (x.includes(y) || y.includes(x));
};
const sameCode = (a: string, b: unknown) => Boolean(a.trim()) && a.trim().toUpperCase() === String(b ?? '').trim().toUpperCase();

/** The ASM animal id a stored dog is linked to: its asmId, or a synced dog's own id. */
function linkedAsmId(id: string, doc: Doc): number | null {
	if (typeof doc.asmId === 'number') return doc.asmId;
	return /^\d+$/.test(id) ? Number(id) : null;
}

function belongsTo(id: string, doc: Doc, r: { animalId: number; shelterCode?: string; shortCode?: string }): boolean {
	return linkedAsmId(id, doc) === r.animalId || sameCode(r.shelterCode ?? '', doc.asmShelterCode) || sameCode(r.shortCode ?? '', doc.asmShelterCode);
}

function treatmentFrom(r: AsmRegimen, t: StoredTreatment | undefined, newId: () => string): StoredTreatment {
	return {
		id: t?.id ?? newId(),
		name: r.treatmentName,
		condition: t?.condition ?? null,
		notes: [r.dosage, r.frequency, r.comments].filter(Boolean).join(' · ') || null,
		startDate: storedNoon(r.startDate),
		endDate: storedNoon(lastDoseDate(r)),
		asmRegimenId: r.regimenId
	};
}

const byDue = (a: AsmRegimen, b: AsmRegimen) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999');

/**
 * The fields to write on one dog so its Medical page matches ASM, or null when nothing
 * changes. `regimens` are the dog's active ones; `given`, its doses given lately.
 */
export function planDogMedical(doc: Doc, regimens: AsmRegimen[], given: AsmGivenDose[], today: string, newId: () => string): Doc | null {
	const patch: Doc = {};
	const kind = (r: { treatmentName: string; openEnded: boolean }) => regimenKind(r.treatmentName, r.openEnded);

	// Under Care: ASM's regimens replace their app copies; ones ASM has finished go; the
	// app's own entries stay. An app entry named like an ASM regimen becomes its copy.
	const txRegimens = regimens.filter((r) => kind(r) === 'treatment' && r.treatmentName);
	const current = (Array.isArray(doc.treatments) ? doc.treatments : []) as StoredTreatment[];
	const used = new Set<number>();
	const next: StoredTreatment[] = [];
	for (const t of current) {
		if (t.asmRegimenId) {
			const r = txRegimens.find((x) => x.regimenId === t.asmRegimenId);
			if (r && !used.has(r.regimenId)) {
				used.add(r.regimenId);
				next.push(treatmentFrom(r, t, newId));
			}
			continue;
		}
		const r = txRegimens.find((x) => !used.has(x.regimenId) && sameName(t.name, x.treatmentName));
		if (r) {
			used.add(r.regimenId);
			next.push(treatmentFrom(r, t, newId));
		} else next.push(t);
	}
	for (const r of txRegimens) if (!used.has(r.regimenId)) next.push(treatmentFrom(r, undefined, newId));
	const norm = (list: StoredTreatment[]) => JSON.stringify(list.map((t) => ({ ...t, asmRegimenId: t.asmRegimenId ?? null })));
	if (norm(next) !== norm(current)) patch.treatments = next;

	// FortiFlora: the course ASM has on, else clear what ASM put there before.
	const ff = regimens.filter((r) => kind(r) === 'fortiflora').sort(byDue)[0];
	if (ff) {
		const time = ff.perPeriod >= 2 ? 'both' : ff.nextDueHour !== null && ff.nextDueHour >= 12 ? 'pm' : 'am';
		const want = { fortifloraDate: storedNoon(ff.startDate ?? ff.nextDue), fortifloraDays: courseDays(ff), fortifloraTime: time, fortifloraAsmRegimenId: ff.regimenId };
		if (storedDay(doc.fortifloraDate) !== (ff.startDate ?? ff.nextDue) || doc.fortifloraDays !== want.fortifloraDays || doc.fortifloraTime !== time || doc.fortifloraAsmRegimenId !== ff.regimenId) Object.assign(patch, want);
	} else if (doc.fortifloraAsmRegimenId) {
		Object.assign(patch, { fortifloraDate: null, fortifloraDays: null, fortifloraTime: null, fortifloraAsmRegimenId: null });
	}

	// Fleas: a flea treatment on now, or one given today or yesterday (a single Capstar
	// is done the moment it's given). Cleared once ASM's is over, if ASM set it.
	const flea =
		regimens.find((r) => kind(r) === 'fleas')?.regimenId ??
		given.find((g) => kind(g) === 'fleas' && g.given >= addDays(today, -1))?.regimenId;
	if (flea) {
		if (doc.hasFleas !== true || doc.fleaAsmRegimenId !== flea) Object.assign(patch, { hasFleas: true, fleaAsmRegimenId: flea });
	} else if (doc.fleaAsmRegimenId) {
		Object.assign(patch, { hasFleas: false, fleaAsmRegimenId: null });
		// Coming off the flea hold restores the handling level it forced, as the app does.
		if (!doc.sickHold && doc.handlingLevelBeforeHold) Object.assign(patch, { handlingLevel: doc.handlingLevelBeforeHold, handlingLevelBeforeHold: null });
	}

	// Surgery: a spay/neuter (or other surgery) ASM has booked for today or later goes on
	// the list on its day. One ASM shows done today goes on as today's. Any surgery whose
	// day is over without ASM showing it done — a surgery dose given or a neuter date on
	// or after that day — didn't happen and comes off.
	let surgeryDay = storedDay(doc.surgeryDate);
	const booked = regimens.filter((r) => kind(r) === 'surgery' && r.nextDue && r.nextDue >= today).sort(byDue)[0];
	const doneDays = [...given.filter((g) => kind(g) === 'surgery').map((g) => g.given), storedDay(doc.fixedDate)].filter((d): d is string => Boolean(d));
	const lastSurgery = storedDay(doc.lastSurgeryDate);
	if (booked && surgeryDay !== booked.nextDue && !(surgeryDay && surgeryDay >= today && doneDays.includes(surgeryDay))) {
		surgeryDay = booked.nextDue;
		Object.assign(patch, { surgeryDate: storedNoon(surgeryDay), surgeryAsmRegimenId: booked.regimenId });
	} else if (!surgeryDay && doneDays.includes(today) && lastSurgery !== today) {
		surgeryDay = today;
		Object.assign(patch, { surgeryDate: storedNoon(today), surgeryAsmRegimenId: null });
	}
	if (surgeryDay && surgeryDay < today && !doneDays.some((d) => d >= surgeryDay! && d <= today)) {
		Object.assign(patch, { surgeryDate: null, surgeryRestDays: null, surgeryAsmRegimenId: null });
	}

	return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Every active dog's Medical page fields against ASM. Permanent fosters are left out,
 * as the Medical page leaves them out.
 */
export function planMedicalSync(
	docs: Map<string, Doc>,
	asm: { regimens: AsmRegimen[]; given: AsmGivenDose[] },
	today: string,
	newId: () => string
): { id: string; data: Doc }[] {
	const writes: { id: string; data: Doc }[] = [];
	for (const [id, doc] of docs) {
		if (doc.status !== 'active' || doc.permanentFoster === true) continue;
		const regimens = asm.regimens.filter((r) => belongsTo(id, doc, r));
		const given = asm.given.filter((g) => belongsTo(id, doc, g));
		const data = planDogMedical(doc, regimens, given, today, newId);
		if (data) writes.push({ id, data });
	}
	return writes;
}
