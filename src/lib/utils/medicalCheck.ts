import type { Dog, Treatment } from '$lib/types';
import { toDate } from '$lib/utils/dates';

/** One active ASM medical regimen (a course of treatment), as ASM's medical book shows it. */
export interface AsmRegimen {
	regimenId: number;
	animalId: number;
	shelterCode: string;
	shortCode: string;
	animalName: string;
	treatmentName: string;
	dosage: string;
	/** "One Off", "1 treatments every 1 days"… as ASM words it. */
	frequency: string;
	comments: string;
	/** YYYY-MM-DD the regimen started. */
	startDate: string | null;
	/** YYYY-MM-DD of the next dose still to give. */
	nextDue: string | null;
	/** Doses left, the next one included. */
	remaining: number;
	/** Doses per period; 0 is a one-off. */
	perPeriod: number;
	/** ASM's period unit: 0 days, 4 weekdays, 1 weeks, 2 months, 3 years. */
	unit: number;
	/** Periods between doses ("every 2 weeks" is 2). */
	every: number;
	/** No set length in ASM ("unspecified"), so no end date. */
	openEnded: boolean;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The day of a regimen's last dose. ASM only creates the next dose, so this counts on
 * from it: one period per remaining batch of doses. Null when the course has no end.
 */
export function lastDoseDate(r: AsmRegimen): string | null {
	if (!r.nextDue) return null;
	if (r.perPeriod <= 0) return r.nextDue;
	if (r.openEnded) return null;
	const periods = Math.max(1, Math.ceil(r.remaining / r.perPeriod)) - 1;
	const d = toDate(r.nextDue)!;
	const steps = periods * r.every;
	if (r.unit === 1) d.setDate(d.getDate() + steps * 7);
	else if (r.unit === 2) d.setMonth(d.getMonth() + steps);
	else if (r.unit === 3) d.setFullYear(d.getFullYear() + steps);
	else if (r.unit === 4) d.setDate(d.getDate() + Math.ceil((steps * 7) / 5));
	else d.setDate(d.getDate() + steps);
	return ymd(d);
}

const sameCode = (a: string, b: string | undefined) => Boolean(a.trim()) && a.trim().toUpperCase() === (b ?? '').trim().toUpperCase();

/** The app dog this regimen belongs to: by ASM id or shelter code. */
export function dogForRegimen(r: AsmRegimen, dogs: Dog[]): Dog | null {
	return (
		dogs.find((d) => {
			const asmId = d.asmId ?? (/^\d+$/.test(d.id) ? Number(d.id) : null);
			return asmId === r.animalId || sameCode(r.shelterCode, d.asmShelterCode) || sameCode(r.shortCode, d.asmShelterCode);
		}) ?? null
	);
}

const key = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** An app treatment that is this regimen: filled from it before, or named the same. */
function sameTreatment(t: Treatment, r: AsmRegimen): boolean {
	if (t.asmRegimenId) return t.asmRegimenId === r.regimenId;
	const a = key(t.name);
	const b = key(r.treatmentName);
	return Boolean(a && b) && (a.includes(b) || b.includes(a));
}

/** What a regimen fills in: ASM's own wording for dose and timing goes in the notes. */
function fromRegimen(r: AsmRegimen) {
	const notes = [r.dosage, r.frequency, r.comments].filter(Boolean).join(' · ') || null;
	return { name: r.treatmentName, notes, startDate: r.startDate, endDate: lastDoseDate(r) };
}

export type MedicalFix = {
	dog: Dog;
	regimen: AsmRegimen;
	/** add: a treatment the app doesn't have. fill: one it has, with blanks ASM can fill. */
	kind: 'add' | 'fill';
	/** The treatment as it will be saved. */
	treatment: Treatment;
	/** What changes, in a line. */
	detail: string;
	/** No end date in ASM, so it would sit on the list until removed by hand. */
	openEnded: boolean;
};

const dateOrNull = (s: string | null) => (s ? new Date(`${s}T12:00:00`) : null);

/**
 * Compares the app's active dogs with ASM's active regimens. A regimen the dog has no
 * treatment for is an add; one it has with a blank start, end or notes is a fill, and
 * only the blanks are filled. Nothing typed in the app is overwritten. Regimens for
 * animals the app doesn't have (another species, a permanent foster) are counted apart.
 */
export function checkMedical(dogs: Dog[], regimens: AsmRegimen[], newId: () => string): { fixes: MedicalFix[]; unmatched: AsmRegimen[] } {
	const active = dogs.filter((d) => d.status === 'active' && !d.permanentFoster);
	const fixes: MedicalFix[] = [];
	const unmatched: AsmRegimen[] = [];
	for (const r of regimens) {
		if (!r.treatmentName) continue;
		const dog = dogForRegimen(r, active);
		if (!dog) {
			unmatched.push(r);
			continue;
		}
		const asm = fromRegimen(r);
		const existing = (dog.treatments ?? []).find((t) => sameTreatment(t, r));
		const openEnded = !asm.endDate;
		if (!existing) {
			const parts = [asm.startDate && `from ${asm.startDate}`, asm.endDate ? `to ${asm.endDate}` : 'no end date in ASM', asm.notes].filter(Boolean);
			fixes.push({
				dog,
				regimen: r,
				kind: 'add',
				openEnded,
				treatment: { id: newId(), name: asm.name, condition: null, notes: asm.notes, startDate: dateOrNull(asm.startDate), endDate: dateOrNull(asm.endDate), asmRegimenId: r.regimenId },
				detail: `Add ${asm.name}: ${parts.join(', ')}.`
			});
			continue;
		}
		const filled: Treatment = { ...existing, asmRegimenId: r.regimenId };
		const parts: string[] = [];
		if (!toDate(existing.startDate ?? null) && asm.startDate) {
			filled.startDate = dateOrNull(asm.startDate);
			parts.push(`start ${asm.startDate}`);
		}
		if (!toDate(existing.endDate ?? null) && asm.endDate) {
			filled.endDate = dateOrNull(asm.endDate);
			parts.push(`end ${asm.endDate}`);
		}
		if (!existing.notes?.trim() && asm.notes) {
			filled.notes = asm.notes;
			parts.push(`notes "${asm.notes}"`);
		}
		if (parts.length === 0) continue;
		fixes.push({ dog, regimen: r, kind: 'fill', openEnded: false, treatment: filled, detail: `${existing.name}: fill ${parts.join(', ')}.` });
	}
	fixes.sort((a, b) => a.dog.name.localeCompare(b.dog.name) || a.treatment.name.localeCompare(b.treatment.name));
	return { fixes, unmatched };
}
