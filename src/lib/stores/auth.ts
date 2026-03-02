import { writable } from 'svelte/store';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '$lib/firebase/config';
import { createUserProfile, getUserProfile, hasAnyUserProfiles } from '$lib/firebase/firestore';
import type { UserProfile } from '$lib/types';

export const authUser = writable<User | null>(null);
export const authProfile = writable<UserProfile | null>(null);
export const authReady = writable(false);

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
		if (user) {
			try {
				let profile = await getUserProfile(user.uid);
				if (!profile) {
					const anyProfilesExist = await hasAnyUserProfiles();
					const role = anyProfilesExist ? 'staff' : 'admin';
					await createUserProfile({
						uid: user.uid,
						email: user.email ?? '',
						displayName: user.displayName ?? user.email ?? 'Staff Member',
						role
					});
					profile = await getUserProfile(user.uid);
				}
				authProfile.set(profile);
			} catch (error) {
				console.error('Failed to load user profile', error);
				authProfile.set(null);
			}
		} else {
			authProfile.set(null);
		}
		authReady.set(true);
	});
}
