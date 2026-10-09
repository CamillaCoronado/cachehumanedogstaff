// #medical-updates in Slack, read into the Medical page. The model turns a post into
// actions (parse); these pure steps match the names to dogs and work out each dog's
// writes, so the poll and the admin queue apply a post the same way.

import { storedDay, storedNoon } from '$lib/utils/medicalSync';

export type MedicalActionType = 'treatment' | 'fortiflora' | 'fleas' | 'monitor' | 'isolation' | 'note';

/** One thing a post says about one dog, before the name is matched. */
export interface RawMedicalAction {
	type: MedicalActionType;
	/** As written: a dog, or a name standing for several ("van trap puppies"). */
	dogName: string;
	/** treatment: the drug as written ("doxy", "cough tabs"). */
	drug: string | null;
	/** treatment / monitor / isolation: what it's for ("URI", "diarrhea"). */
	condition: string | null;
	/** fortiflora: course length when the post gives one. */
	days: number | null;
	/** note: the one-off ("given triple dewormer for tapeworms"). */
	note: string | null;
}

export interface MedicalAction extends Omit<RawMedicalAction, 'dogName'> {
	dogId: string;
	dogName: string;
}

export interface RosterDog {
	id: string;
	name: string;
	nicknames?: string[];
}

export interface RosterGroup {
	name: string;
	dogIds: string[];
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * The dogs a name stands for: one dog by name or nickname (a surname after it is fine,
 * "Bruiser Woods" is Bruiser), or every dog in a group of that name. Empty when it can't
 * be told, which sends the post to the admin queue rather than onto a guess.
 */
export function dogsNamed(name: string, roster: RosterDog[], groups: RosterGroup[] = []): RosterDog[] {
	const k = key(name);
	if (!k) return [];
	const group = groups.find((g) => key(g.name) === k);
	if (group) return roster.filter((d) => group.dogIds.includes(d.id));

	const names = (d: RosterDog) => [d.name, ...(d.nicknames ?? [])].map(key).filter(Boolean);
	const exact = roster.filter((d) => names(d).includes(k));
	if (exact.length > 0) return exact.length === 1 ? exact : [];
	// "Bruiser Woods" → Bruiser: the first word, if it names exactly one dog.
	const first = key(name.trim().split(/\s+/)[0] ?? '');
	const byFirst = first && first !== k ? roster.filter((d) => names(d).includes(first)) : [];
	return byFirst.length === 1 ? byFirst : [];
}

export function resolveMedicalActions(
	raw: RawMedicalAction[],
	roster: RosterDog[],
	groups: RosterGroup[] = []
): { actions: MedicalAction[]; unmatched: string[] } {
	const actions: MedicalAction[] = [];
	const unmatched: string[] = [];
	for (const a of raw) {
		const dogs = dogsNamed(a.dogName, roster, groups);
		if (dogs.length === 0) {
			if (!unmatched.includes(a.dogName)) unmatched.push(a.dogName);
			continue;
		}
		for (const d of dogs) actions.push({ ...a, dogId: d.id, dogName: d.name });
	}
	return { actions, unmatched };
}

type Doc = Record<string, unknown>;
type StoredTreatment = { id: string; name: string; condition?: string | null; startDate?: string | null; endDate?: string | null } & Doc;

/** Shorthand staff write for what ASM names in full, so ASM's entry replaces the Slack one. */
const DRUG_ALIASES: [RegExp, string][] = [
	[/^doxy$/i, 'Doxycycline'],
	[/^metro$/i, 'Metronidazole'],
	[/^clav(amox)?$/i, 'Clavamox'],
	[/^ceph(alexin)?$/i, 'Cephalexin'],
	[/^kp$/i, 'Kaopectate'],
	[/^lax(atone)?$/i, 'Laxatone']
];

export function drugName(drug: string): string {
	const d = drug.trim();
	const alias = DRUG_ALIASES.find(([re]) => re.test(d));
	if (alias) return alias[1];
	return d.charAt(0).toUpperCase() + d.slice(1);
}

const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sameDrug = (a: unknown, b: unknown) => {
	const x = nameKey(a);
	const y = nameKey(b);
	return Boolean(x && y) && (x.includes(y) || y.includes(x));
};

export const DEFAULT_FORTIFLORA_DAYS = 3;

/**
 * One dog's writes for a post's actions on that dog. Additive only: nothing already on
 * the dog is undone, so a re-read post or one ASM got to first changes nothing.
 * `day` is the post's shelter day (YYYY-MM-DD); `notes` go to the dog's notes.
 */
export function planSlackMedical(
	doc: Doc,
	actions: MedicalAction[],
	day: string,
	postedAtIso: string,
	newId: () => string
): { patch: Doc | null; notes: string[] } {
	const patch: Doc = {};
	const notes: string[] = [];
	const current = (Array.isArray(doc.treatments) ? doc.treatments : []) as StoredTreatment[];
	let treatments = current;

	for (const a of actions) {
		switch (a.type) {
			case 'treatment': {
				if (!a.drug?.trim()) break;
				const name = drugName(a.drug);
				const existing = treatments.find((t) => sameDrug(t.name, name) || sameDrug(t.name, a.drug));
				if (existing) {
					// Already on it (ASM or by hand): only fill in what it's for, if missing.
					if (!existing.condition && a.condition) {
						treatments = treatments.map((t) => (t === existing ? { ...t, condition: a.condition } : t));
					}
					break;
				}
				treatments = [
					...treatments,
					{ id: newId(), name, condition: a.condition ?? null, notes: null, startDate: storedNoon(day), endDate: null }
				];
				break;
			}
			case 'fortiflora':
				// A course already on (ASM's or one started here) is left as is.
				if (doc.fortifloraAsmRegimenId || fortifloraRunning(doc, day)) break;
				Object.assign(patch, {
					fortifloraDate: storedNoon(day),
					fortifloraDays: a.days && a.days > 0 ? a.days : DEFAULT_FORTIFLORA_DAYS,
					fortifloraTime: 'both'
				});
				break;
			case 'fleas':
				if (doc.hasFleas !== true) patch.hasFleas = true;
				break;
			case 'monitor':
				if (!doc.sickMonitor && !doc.sickHold && !patch.sickMonitor) {
					Object.assign(patch, { sickMonitor: true, sickMonitorReason: a.condition ?? null, sickMonitorSince: postedAtIso });
				}
				break;
			case 'isolation':
				if ((doc.isolationStatus ?? 'none') === 'none' && !patch.isolationStatus) {
					Object.assign(patch, { isolationStatus: 'iso', isolationReason: 'sick' });
				}
				break;
			case 'note':
				if (a.note?.trim()) notes.push(a.note.trim());
				break;
		}
	}

	if (treatments !== current) patch.treatments = treatments;
	return { patch: Object.keys(patch).length > 0 ? patch : null, notes };
}

function fortifloraRunning(doc: Doc, day: string): boolean {
	const start = storedDay(doc.fortifloraDate);
	if (!start) return false;
	const days = typeof doc.fortifloraDays === 'number' ? doc.fortifloraDays : 0;
	const end = new Date(`${start}T12:00:00Z`);
	end.setUTCDate(end.getUTCDate() + days);
	return day < end.toISOString().slice(0, 10);
}

/** A one-line reading of a post's actions, for the admin queue. */
export function describeAction(a: { type: MedicalActionType; dogName: string; drug: string | null; condition: string | null; days: number | null; note: string | null }): string {
	const why = a.condition ? ` for ${a.condition}` : '';
	switch (a.type) {
		case 'treatment':
			return `${a.dogName}: ${a.drug ? drugName(a.drug) : 'treatment'}${why}`;
		case 'fortiflora':
			return `${a.dogName}: FortiFlora ${a.days ?? DEFAULT_FORTIFLORA_DAYS} days`;
		case 'fleas':
			return `${a.dogName}: fleas`;
		case 'monitor':
			return `${a.dogName}: monitor${why}`;
		case 'isolation':
			return `${a.dogName}: into ISO${why}`;
		case 'note':
			return `${a.dogName}: note "${a.note ?? ''}"`;
	}
}
