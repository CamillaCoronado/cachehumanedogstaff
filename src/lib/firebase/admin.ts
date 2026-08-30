import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { env } from '$env/dynamic/private';

function getAdminApp() {
	if (getApps().length > 0) return getApp();
	const { FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY, PUBLIC_FIREBASE_PROJECT_ID } =
		env;
	if (!FIREBASE_ADMIN_CLIENT_EMAIL || !FIREBASE_ADMIN_PRIVATE_KEY || !PUBLIC_FIREBASE_PROJECT_ID) {
		throw new Error('Firebase Admin credentials not configured');
	}
	return initializeApp({
		credential: cert({
			projectId: PUBLIC_FIREBASE_PROJECT_ID,
			clientEmail: FIREBASE_ADMIN_CLIENT_EMAIL,
			// Vercel stores multi-line keys as a single string with literal \n
			privateKey: FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n')
		})
	});
}

export function getAdminDb() {
	return getFirestore(getAdminApp());
}

/** Auth bound to the same credentialed app, for verifying client ID tokens. */
export function getAdminAuth() {
	return getAuth(getAdminApp());
}
