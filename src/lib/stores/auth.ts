import { writable } from 'svelte/store';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '$lib/firebase/config';
import { createUserProfile, getCachedUserProfile, getUserProfile } from '$lib/data/users';
import type { UserProfile } from '$lib/types';

export const authUser = writable<User | null>(null);
export const authProfile = writable<UserProfile | null>(null);
export const authReady = writable(false);
/** True once the profile has been read from the server this session, not just this device's copy. */
export const authProfileFresh = writable(false);

let initialized = false;

export function initAuthListener() {
	if (initialized) return;
	initialized = true;

	if (!auth) {
		authReady.set(true);
		return;
	}

	onAuthStateChanged(auth, async (user) => {
		authUser.set(user);
		authProfileFresh.set(false);
		if (user) {
			// Draw the app from this device's copy of the profile while the server read
			// is still out — on the shelter's signal that read can take many seconds.
			const cached = await getCachedUserProfile(user.uid);
			if (cached) {
				authProfile.set(cached);
				authReady.set(true);
			}
			try {
				let profile = await getUserProfile(user.uid);
				if (!profile) {
					// Least privilege on self sign-up: anyone with a Google account can reach
					// this, so a new profile starts as 'volunteer' and an admin promotes it
					// from the Admin page. Must stay in step with isValidSelfProfilePayload()
					// in firestore.rules, which pins the role a self-created profile may claim.
					await createUserProfile({
						uid: user.uid,
						email: user.email ?? '',
						displayName: user.displayName ?? user.email ?? 'New Member',
						role: 'volunteer',
						approved: false
					});
					profile = await getUserProfile(user.uid);
				}
				authProfile.set(profile);
				authProfileFresh.set(true);
			} catch (error) {
				console.error('Failed to load user profile', error);
				// Offline with a cached copy: keep working from it rather than locking the app.
				if (!cached) authProfile.set(null);
			}
		} else {
			authProfile.set(null);
		}
		authReady.set(true);
	});
}
