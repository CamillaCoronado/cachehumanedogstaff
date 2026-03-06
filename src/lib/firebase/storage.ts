import { createId } from '$lib/utils/storage';
import { auth, storage } from '$lib/firebase/config';
import { deleteObject, getDownloadURL, ref, uploadString } from 'firebase/storage';

const DOG_PHOTO_ROOT = 'dog-photos';

function mimeToExtension(mimeType: string) {
	if (mimeType === 'image/png') return 'png';
	if (mimeType === 'image/webp') return 'webp';
	return 'jpg';
}

export async function uploadDogPhotoDataUrl(
	dataUrl: string,
	options?: { dogId?: string | null; mimeType?: string }
) {
	if (!storage) throw new Error('Firebase Storage is not available.');
	if (!auth?.currentUser) {
		const error = new Error('You must be signed in before uploading photos.');
		(error as Error & { code: string }).code = 'storage/unauthenticated';
		throw error;
	}
	const dogId = options?.dogId?.trim() || 'unassigned';
	const extension = mimeToExtension(options?.mimeType ?? 'image/jpeg');
	const fileId = createId('photo');
	const path = `${DOG_PHOTO_ROOT}/${dogId}/${fileId}.${extension}`;
	const photoRef = ref(storage, path);
	await uploadString(photoRef, dataUrl, 'data_url');
	return getDownloadURL(photoRef);
}

export async function deleteDogPhotoByUrl(photoUrl: string | null | undefined) {
	if (!storage || !photoUrl) return;
	if (!photoUrl.startsWith('http')) return;
	const photoRef = ref(storage, photoUrl);
	await deleteObject(photoRef);
}
