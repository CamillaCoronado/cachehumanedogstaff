// #medical-updates in Slack, read into the Medical page. Only "on monitor" comes from
// Slack (Camilla, 2026-10-15): treatments and the rest come from ASM. The model finds
// the monitor calls in a post (parse); these pure steps match the names to dogs and
// work out each dog's write, so the poll and the admin queue apply a post the same way.

export type MedicalActionType = 'monitor';

/** A post putting one dog (or a named group) on monitor, before the name is matched. */
export interface RawMedicalAction {
	type: MedicalActionType;
	/** As written: a dog, or a name standing for several ("van trap puppies"). */
	dogName: string;
	/** What to watch for ("diarrhea"), or null. */
	condition: string | null;
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

/**
 * One dog's write for a post: on monitor with the reason, from when it was posted.
 * A dog already on monitor or flagged sick is left as is, so a re-read post changes
 * nothing; taking a dog off monitor stays with staff.
 */
export function planSlackMedical(doc: Doc, actions: MedicalAction[], postedAtIso: string): Doc | null {
	const monitor = actions.find((a) => a.type === 'monitor');
	if (!monitor || doc.sickMonitor || doc.sickHold) return null;
	return { sickMonitor: true, sickMonitorReason: monitor.condition ?? null, sickMonitorSince: postedAtIso };
}

/** A one-line reading of an action, for the admin queue. */
export function describeAction(a: { dogName: string; condition: string | null }): string {
	return `${a.dogName}: monitor${a.condition ? ` for ${a.condition}` : ''}`;
}
