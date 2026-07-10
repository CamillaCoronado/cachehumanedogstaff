// Expected-dog placeholders for the kennels board: dogs the shelter knows are
// coming but that don't exist in ASM yet. They live in their own collection so
// they never appear on the roster, feeding, or attention pages, and the ASM
// sync can neither overwrite nor archive them. When the real dog arrives via
// sync, staff delete the placeholder (or drag the real dog onto its run).
import { readJson, writeJson, createId } from '$lib/utils/storage';
import { db } from '$lib/firebase/config';
import { collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const STORAGE_KEY = 'shelter.kennelPlaceholders';

export interface KennelPlaceholder {
	id: string;
	name: string;
	/** Same format as Dog.outdoorKennelAssignment ('' = unassigned). */
	run: string;
	createdAt: string;
	createdByName: string;
}

// The 'ph-' prefix lets shared drag/drop code tell placeholders from dogs by id.
export function isPlaceholderId(id: string): boolean {
	return id.startsWith('ph-');
}

export async function listKennelPlaceholders(): Promise<KennelPlaceholder[]> {
	if (db) {
		const snapshot = await getDocs(collection(db, 'kennelPlaceholders'));
		return snapshot.docs
			.map((d) => ({ ...(d.data() as Omit<KennelPlaceholder, 'id'>), id: d.id }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}
	return readJson<KennelPlaceholder[]>(STORAGE_KEY, []);
}

export async function addKennelPlaceholder(name: string, createdByName: string): Promise<KennelPlaceholder> {
	const entry: KennelPlaceholder = {
		id: `ph-${createId('ph')}`,
		name: name.trim(),
		run: '',
		createdAt: new Date().toISOString(),
		createdByName
	};

	if (db) {
		const { id, ...data } = entry;
		await setDoc(doc(db, 'kennelPlaceholders', id), data);
		return entry;
	}

	const stored = readJson<KennelPlaceholder[]>(STORAGE_KEY, []);
	stored.push(entry);
	writeJson(STORAGE_KEY, stored);
	return entry;
}

export async function setKennelPlaceholderRun(id: string, run: string): Promise<void> {
	if (db) {
		await updateDoc(doc(db, 'kennelPlaceholders', id), { run });
		return;
	}
	const stored = readJson<KennelPlaceholder[]>(STORAGE_KEY, []);
	writeJson(STORAGE_KEY, stored.map((p) => (p.id === id ? { ...p, run } : p)));
}

export async function deleteKennelPlaceholder(id: string): Promise<void> {
	if (db) {
		await deleteDoc(doc(db, 'kennelPlaceholders', id));
		return;
	}
	const stored = readJson<KennelPlaceholder[]>(STORAGE_KEY, []);
	writeJson(STORAGE_KEY, stored.filter((p) => p.id !== id));
}
