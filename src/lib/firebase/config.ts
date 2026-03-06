import { browser } from '$app/environment';
import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { env } from '$env/dynamic/public';

function normalizeHostLikeValue(value: string) {
	return value.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function normalizeStorageBucket(value: string) {
	return normalizeHostLikeValue(value).replace(/^gs:\/\//, '');
}

const firebaseConfig = {
	apiKey: env.PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyBYBJpvxuZ1XZjym7cu_nWG2SR-e-lmAZM',
	authDomain: normalizeHostLikeValue(
		env.PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'cachehumane-dogmanagement.firebaseapp.com'
	),
	projectId: env.PUBLIC_FIREBASE_PROJECT_ID ?? 'cachehumane-dogmanagement',
	storageBucket: normalizeStorageBucket(
		env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'cachehumane-dogmanagement.firebasestorage.app'
	),
	messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '914757695461',
	appId: env.PUBLIC_FIREBASE_APP_ID ?? '1:914757695461:web:54e5af021b78413133210c'
};

const firebaseEnabled =
	!!firebaseConfig.apiKey &&
	!!firebaseConfig.authDomain &&
	!!firebaseConfig.projectId &&
	!!firebaseConfig.storageBucket &&
	!!firebaseConfig.messagingSenderId &&
	!!firebaseConfig.appId;

let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

if (browser && firebaseEnabled) {
	firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
	auth = getAuth(firebaseApp);
	db = getFirestore(firebaseApp);
	storage = getStorage(firebaseApp);
}

export { firebaseApp, auth, db, storage, firebaseEnabled };
