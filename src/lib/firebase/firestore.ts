import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { UserProfile, UserRole } from '$lib/types';
import { db } from './config';

export async function getUserProfile(uid: string) {
	if (!db) throw new Error('Firestore is not available.');
	const ref = doc(db, 'users', uid);
	const snap = await getDoc(ref);
	if (!snap.exists()) return null;
	return snap.data() as UserProfile;
}

export async function hasAnyUserProfiles() {
	if (!db) throw new Error('Firestore is not available.');
	const usersRef = collection(db, 'users');
	const snapshot = await getDocs(query(usersRef, limit(1)));
	return !snapshot.empty;
}

export async function createUserProfile(params: {
	uid: string;
	email: string;
	displayName: string;
	role: UserRole;
}) {
	if (!db) throw new Error('Firestore is not available.');
	const ref = doc(db, 'users', params.uid);
	await setDoc(ref, {
		uid: params.uid,
		email: params.email,
		displayName: params.displayName,
		role: params.role,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp()
	});
}

export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
	if (!db) throw new Error('Firestore is not available.');
	const ref = doc(db, 'users', uid);
	await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
}
