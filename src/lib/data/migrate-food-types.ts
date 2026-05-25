import { getDocs, collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '$lib/firebase/config';

const VALID_FOOD_TYPES = new Set(['Normal', 'Puppy', 'No Fish', 'No Chicken']);
const SUPPLEMENT_KEYWORDS = ['supplement', 'probiotic', 'pumpkin', 'vitamin', 'topper', 'joint', 'cosequin', 'omega', 'glucosamine'];

function migrateFoodType(foodType: string, dietaryNotes: string): string {
	const merged = `${foodType} ${dietaryNotes}`.toLowerCase();
	if (merged.includes('no chicken')) return 'No Chicken';
	if (merged.includes('no fish')) return 'No Fish';
	if (merged.includes('puppy')) return 'Puppy';
	return 'Normal';
}

function detectSupplements(foodType: string, dietaryNotes: string): boolean {
	const merged = `${foodType} ${dietaryNotes}`.toLowerCase();
	return SUPPLEMENT_KEYWORDS.some((kw) => merged.includes(kw));
}

export async function migrateFoodTypes(): Promise<{ updated: number }> {
	if (!db) throw new Error('Firestore not available');

	const snapshot = await getDocs(collection(db, 'dogs'));
	const toUpdate: { id: string; foodType: string; hasSupplements: boolean }[] = [];

	for (const d of snapshot.docs) {
		const data = d.data();
		const foodType: string = data.foodType ?? '';
		const dietaryNotes: string = data.dietaryNotes ?? '';

		if (VALID_FOOD_TYPES.has(foodType) && data.hasSupplements !== undefined && data.satinBalls !== undefined) {
			continue;
		}

		const newFoodType = VALID_FOOD_TYPES.has(foodType) ? foodType : migrateFoodType(foodType, dietaryNotes);
		const newHasSupplements = data.hasSupplements ?? detectSupplements(foodType, dietaryNotes);

		toUpdate.push({ id: d.id, foodType: newFoodType, hasSupplements: newHasSupplements });
	}

	const BATCH_SIZE = 499;
	for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
		const batch = writeBatch(db);
		for (const { id, foodType, hasSupplements } of toUpdate.slice(i, i + BATCH_SIZE)) {
			batch.set(doc(db, 'dogs', id), { foodType, hasSupplements, satinBalls: false }, { merge: true });
		}
		await batch.commit();
	}

	return { updated: toUpdate.length };
}
