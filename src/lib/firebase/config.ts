import { browser } from '$app/environment';
import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { env } from '$env/dynamic/public';

const firebaseConfig = {
	apiKey: env.PUBLIC_FIREBASE_API_KEY ?? '',
	authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
	projectId: env.PUBLIC_FIREBASE_PROJECT_ID ?? '',
	storageBucket: env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
	messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
	appId: env.PUBLIC_FIREBASE_APP_ID ?? ''
};

const firebaseEnabled =
	!!env.PUBLIC_FIREBASE_API_KEY &&
	!!env.PUBLIC_FIREBASE_AUTH_DOMAIN &&
	!!env.PUBLIC_FIREBASE_PROJECT_ID &&
	!!env.PUBLIC_FIREBASE_STORAGE_BUCKET &&
	!!env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID &&
	!!env.PUBLIC_FIREBASE_APP_ID;

let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (browser && firebaseEnabled) {
	firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
	auth = getAuth(firebaseApp);
	db = getFirestore(firebaseApp);
}

export { firebaseApp, auth, db, firebaseEnabled };
