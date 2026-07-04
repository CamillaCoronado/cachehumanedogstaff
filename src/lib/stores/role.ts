import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { UserRole } from '$lib/types';
import { readString, writeString } from '$lib/utils/storage';

const STORAGE_KEY = 'shelter.role';

const storedRole = readString(STORAGE_KEY) as UserRole | null;

export const localRole = writable<UserRole>(storedRole ?? 'staff');

if (browser) {
	localRole.subscribe((value) => {
		writeString(STORAGE_KEY, value);
	});
}
