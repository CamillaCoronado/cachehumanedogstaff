import type { ParsedAction, RawAction } from './types';
import { matchDogByName } from '$lib/utils/dogs';
import type { Dog } from '$lib/types';

export interface ResolveResult {
	actions: ParsedAction[];
	/** Dog names the roster couldn't match — any entry means needs_review. */
	unmatchedNames: string[];
}

/**
 * Resolves raw dog names against the live roster (same fuzzy matcher as the
 * Slack import). Feeding defaults to the current meal when the message didn't
 * say. Env-free so the pipeline stays unit-testable.
 */
export function resolveActions(
	raw: RawAction[],
	roster: Array<{ id: string; name: string }>,
	now: Date
): ResolveResult {
	const dogs = roster as unknown as Dog[]; // matchDogByName only reads id/name
	const defaultMeal: 'am' | 'pm' = now.getHours() >= 12 ? 'pm' : 'am';
	const actions: ParsedAction[] = [];
	const unmatchedNames: string[] = [];

	for (const action of raw) {
		if (action.type === 'handoff_note') {
			actions.push({ type: 'handoff_note', note: action.note });
			continue;
		}
		const dog = matchDogByName(action.dogName, dogs);
		if (!dog) {
			unmatchedNames.push(action.dogName);
			continue;
		}
		if (action.type === 'feeding') {
			actions.push({
				type: 'feeding',
				dogId: dog.id,
				dogName: dog.name,
				amountEaten: action.amountEaten,
				mealTime: action.mealTime ?? defaultMeal,
				notes: action.notes
			});
		} else if (action.type === 'trip_return') {
			actions.push({ type: 'trip_return', dogId: dog.id, dogName: dog.name, note: action.note });
		} else {
			actions.push({ type: 'dog_note', dogId: dog.id, dogName: dog.name, note: action.note });
		}
	}

	return { actions, unmatchedNames };
}
