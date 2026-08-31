import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import type { DogGroup } from '$lib/types';
import { db } from '$lib/firebase/config';
import { createId } from '$lib/utils/storage';

const COLLECTION = 'dogGroups';

/** Names that stand for several dogs at once — litters, mostly. */
export async function listDogGroups(): Promise<DogGroup[]> {
	if (!db) return [];
	const snapshot = await getDocs(collection(db, COLLECTION));
	return snapshot.docs
		.map((d) => ({ id: d.id, ...(d.data() as Omit<DogGroup, 'id'>) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveDogGroup(group: { id?: string; name: string; dogIds: string[] }) {
	if (!db) return;
	const id = group.id ?? createId('group');
	const now = new Date().toISOString();
	await setDoc(
		doc(db, COLLECTION, id),
		{ name: group.name.trim(), dogIds: group.dogIds, updatedAt: now, ...(group.id ? {} : { createdAt: now }) },
		{ merge: true }
	);
	return id;
}

export async function deleteDogGroup(id: string) {
	if (!db) return;
	await deleteDoc(doc(db, COLLECTION, id));
}
