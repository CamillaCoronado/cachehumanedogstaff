import { writable } from 'svelte/store';

export const dogColors = writable<Record<string, 'green' | 'yellow' | 'red'>>({});

export async function loadDogColors(): Promise<void> {
	try {
		const res = await fetch('/api/sheets/dog-colors');
		if (res.ok) dogColors.set(await res.json());
	} catch {
		// fall back to computed colors silently
	}
}
