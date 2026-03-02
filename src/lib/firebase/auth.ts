import {
	GoogleAuthProvider,
	signInWithPopup,
	signInWithRedirect,
	signOut,
	type UserCredential
} from 'firebase/auth';
import { auth } from './config';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle(): Promise<UserCredential | null> {
	if (!auth) throw new Error('Authentication is not available.');
	try {
		return await signInWithPopup(auth, googleProvider);
	} catch (error) {
		const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
		if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
			await signInWithRedirect(auth, googleProvider);
			return null;
		}
		throw error;
	}
}

export async function signOutUser() {
	if (!auth) throw new Error('Authentication is not available.');
	return signOut(auth);
}
