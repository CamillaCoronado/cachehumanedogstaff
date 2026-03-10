import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { UserRole } from '$lib/types';

const STORAGE_KEY = 'shelter.role';

const storedRole = browser ? (localStorage.getItem(STORAGE_KEY) as UserRole | null) : null;

export const localRole = writable<UserRole>(storedRole ?? 'staff');

if (browser) {
	localRole.subscribe((value) => {
		localStorage.setItem(STORAGE_KEY, value);
	});
}
