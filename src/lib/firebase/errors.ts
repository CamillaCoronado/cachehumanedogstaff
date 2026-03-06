function getCode(error: unknown) {
	if (typeof error === 'object' && error && 'code' in error) {
		return String((error as { code?: unknown }).code);
	}
	return '';
}

export function getAuthErrorMessage(error: unknown, hostname: string) {
	const code = getCode(error);
	if (code === 'auth/unauthorized-domain') {
		return `Sign-in is blocked for ${hostname}. Add this domain in Firebase Console > Authentication > Settings > Authorized domains.`;
	}
	if (code === 'auth/operation-not-allowed') {
		return 'Google sign-in is not enabled in Firebase Authentication.';
	}
	if (code === 'auth/popup-blocked') {
		return 'Popup blocked by browser. Allow popups and try again.';
	}
	if (code === 'auth/popup-closed-by-user') {
		return 'Sign-in popup was closed before completion.';
	}
	if (error instanceof Error && error.message) return error.message;
	return 'Unable to sign in.';
}

export function getStorageUploadErrorMessage(error: unknown) {
	const code = getCode(error);
	if (code === 'storage/unauthorized') {
		return 'Upload blocked by Firebase Storage rules. Sign in, then deploy storage.rules to this Firebase project.';
	}
	if (code === 'storage/unauthenticated') {
		return 'You must be signed in before uploading photos.';
	}
	if (code === 'storage/quota-exceeded') {
		return 'Firebase Storage quota has been exceeded.';
	}
	if (code === 'storage/retry-limit-exceeded') {
		return 'Upload timed out. Check connection and try again.';
	}
	if (error instanceof Error && error.message.includes('CORS')) {
		return 'Upload request was blocked by bucket CORS/auth response. Confirm this bucket is correct and storage rules are deployed.';
	}
	if (error instanceof Error && error.message) return error.message;
	return 'Unable to upload photo to Firebase Storage.';
}
