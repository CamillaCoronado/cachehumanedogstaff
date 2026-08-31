import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

// $env/dynamic/private deliberately excludes everything prefixed PUBLIC_, so reading the
// project id from it always yielded undefined and every admin call threw "credentials not
// configured" — including on Vercel, where the variable is not set at all. It comes from
// the public env now, with the same fallback the client config uses.
const PROJECT_ID = publicEnv.PUBLIC_FIREBASE_PROJECT_ID ?? 'cachehumane-dogmanagement';

function getAdminApp() {
	if (getApps().length > 0) return getApp();
	const { FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY } = env;
	if (!FIREBASE_ADMIN_CLIENT_EMAIL || !FIREBASE_ADMIN_PRIVATE_KEY) {
		throw new Error('Firebase Admin credentials not configured');
	}
	return initializeApp({
		credential: cert({
			projectId: PROJECT_ID,
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
