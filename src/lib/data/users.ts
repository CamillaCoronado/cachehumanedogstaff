import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { UserProfile, UserRole } from '$lib/types';
import { db } from '$lib/firebase/config';

export async function getUserProfile(uid: string) {
	if (!db) throw new Error('Firestore is not available.');
	const ref = doc(db, 'users', uid);
	const snap = await getDoc(ref);
	if (!snap.exists()) return null;
	return snap.data() as UserProfile;
}

export async function listUserProfiles() {
	if (!db) throw new Error('Firestore is not available.');
	const usersRef = collection(db, 'users');
	const snapshot = await getDocs(usersRef);
	return snapshot.docs
		.map((docSnap) => docSnap.data() as UserProfile)
		.sort((first, second) => {
			const firstLabel = (first.displayName || first.email || first.uid).toLowerCase();
			const secondLabel = (second.displayName || second.email || second.uid).toLowerCase();
			return firstLabel.localeCompare(secondLabel);
		});
}

export async function createUserProfile(params: {
	uid: string;
	email: string;
	displayName: string;
	role: UserRole;
	approved: boolean;
}) {
	if (!db) throw new Error('Firestore is not available.');
	const ref = doc(db, 'users', params.uid);
	await setDoc(ref, {
		uid: params.uid,
		email: params.email,
		displayName: params.displayName,
		role: params.role,
		approved: params.approved,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp()
	});
}

/** Let an account in, or put it back to pending. Admin only — enforced by the rules. */
export async function setUserApproved(uid: string, approved: boolean) {
	if (!db) throw new Error('Firestore is not available.');
	await updateDoc(doc(db, 'users', uid), { approved, updatedAt: serverTimestamp() });
}

/** Accounts predating the approval gate have no field — undefined means approved. */
export function isProfileApproved(profile: UserProfile | null | undefined): boolean {
	return Boolean(profile) && profile!.approved !== false;
}

export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
	if (!db) throw new Error('Firestore is not available.');
	const ref = doc(db, 'users', uid);
	await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
}
