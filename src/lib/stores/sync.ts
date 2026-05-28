import { writable } from 'svelte/store';

// Incremented each time an ASM sync completes with changes.
// Pages subscribe to re-fetch their data when the sync updates Firestore.
export const syncVersion = writable(0);
