import type { ParsedAction } from './types';

// All SMS copy in one place. Keep replies short — they render on phones.

export function describeAction(action: ParsedAction): string {
	switch (action.type) {
		case 'feeding': {
			const meal = action.mealTime.toUpperCase();
			if (action.amountEaten === 'none') return `${action.dogName} — didn't eat (${meal})`;
			return `${action.dogName} — ate ${action.amountEaten} (${meal})${action.notes ? `: ${action.notes}` : ''}`;
		}
		case 'dog_note':
			return `${action.dogName} — note: ${action.note}`;
		case 'trip_return':
			return `${action.dogName} — back from day trip${action.note ? `: ${action.note}` : ''}`;
		case 'handoff_note':
			return `Handoff note: ${action.note}`;
	}
}

export function proposalReply(actions: ParsedAction[]): string {
	const lines = actions.map((a) => `• ${describeAction(a)}`);
	return `Ready to log:\n${lines.join('\n')}\nReply YES to save, NO to cancel.`;
}

export function savedReply(actions: ParsedAction[]): string {
	return actions.length === 1 ? 'Saved ✓' : `Saved all ${actions.length} ✓`;
}

export function unknownSenderReply(): string {
	return 'This number is not registered with the Cache Humane update line. Ask an admin to add your number to your staff profile.';
}

export function nothingPendingReply(): string {
	return 'Nothing waiting to confirm — send your update first.';
}

export function canceledReply(): string {
	return 'Canceled — nothing was saved.';
}

export function notUnderstoodReply(): string {
	return "Couldn't make that out — it's been saved for review in the app. You can also try again, e.g. \"Buddy didn't eat\" or \"Luna back from trip, great with kids\".";
}

export function isYes(text: string): boolean {
	return /^\s*(yes|y|yep|yeah|confirm|ok|okay)\s*[.!]*\s*$/i.test(text);
}

export function isNo(text: string): boolean {
	return /^\s*(no|n|nope|cancel|stop)\s*[.!]*\s*$/i.test(text);
}
