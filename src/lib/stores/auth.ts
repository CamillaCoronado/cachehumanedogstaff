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
/** True while sign-in is taking long enough that the loading screen should say so and offer a retry. */
export const authStalled = writable(false);

const STALL_MS = 10000;
const READ_TIMEOUT_MS = 12000;

let initialized = false;
let generation = 0;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('timed out')), ms);
		p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
	});
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readOrCreateProfile(user: User) {
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
	return profile;
}

export function initAuthListener() {
	if (initialized) return;
	initialized = true;

	if (!auth) {
		authReady.set(true);
		return;
	}

	// If Firebase never reports a sign-in state (bad signal, stuck storage), say so
	// instead of sitting on "Preparing your workspace..." forever.
	let heard = false;
	setTimeout(() => { if (!heard) authStalled.set(true); }, STALL_MS);

	onAuthStateChanged(auth, async (user) => {
		heard = true;
		const gen = ++generation;
		authUser.set(user);
		authProfileFresh.set(false);
		authStalled.set(false);
		if (!user) {
			authProfile.set(null);
			authReady.set(true);
			return;
		}

		// Draw the app from this device's copy of the profile while the server read
		// is still out — on the shelter's signal that read can take many seconds.
		const cached = await withTimeout(getCachedUserProfile(user.uid), 3000).catch(() => null);
		if (gen !== generation) return;
		if (cached) {
			authProfile.set(cached);
			authReady.set(true);
		}

		// Without a cached copy the app can't know whether this account is approved,
		// so it keeps the loading screen up, but never silently: after a few seconds
		// it says it's still trying, and it keeps retrying the server until it answers.
		const stallTimer = cached ? null : setTimeout(() => { if (gen === generation) authStalled.set(true); }, STALL_MS);
		let delay = 3000;
		for (;;) {
			try {
				const profile = await withTimeout(readOrCreateProfile(user), READ_TIMEOUT_MS);
				if (gen !== generation) return;
				authProfile.set(profile);
				authProfileFresh.set(true);
				break;
			} catch (error) {
				if (gen !== generation) return;
				console.error('Failed to load user profile, retrying', error);
				// Offline with a cached copy: the app keeps working from it while this retries.
				if (!cached) authStalled.set(true);
				await wait(delay);
				if (gen !== generation) return;
				delay = Math.min(delay * 2, 30000);
			}
		}
		if (stallTimer) clearTimeout(stallTimer);
		authStalled.set(false);
		authReady.set(true);
	});
}
