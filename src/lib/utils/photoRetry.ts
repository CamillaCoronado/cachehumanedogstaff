import { logPhotoError, logPhotoLoaded } from '$lib/utils/photoLog';

export interface PhotoRetryParams {
	/** The image URL (kept in sync with the element's bound src). */
	src: string;
	context: string;
	dogId: string | null;
	/** Number of retries before giving up (default 2). */
	retries?: number;
	/** Called once retries are exhausted so the caller can show a fallback. */
	onFail?: () => void;
}

/**
 * Svelte action for dog-photo <img> elements. Firebase Storage URLs
 * occasionally fail to load on a transient network blip or 503; this retries
 * a couple of times (with a short backoff and cache-busting) before calling
 * onFail. Keeping this an action rather than a wrapper component means the
 * <img> stays in the host component, so its scoped CSS still applies.
 */
export function retryablePhoto(node: HTMLImageElement, params: PhotoRetryParams) {
	let current = params;
	let attempt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function onLoad() {
		logPhotoLoaded(current.context, current.dogId);
	}

	function onError() {
		logPhotoError(current.context, current.dogId, current.src);
		const max = current.retries ?? 2;
		if (attempt < max) {
			attempt += 1;
			const sep = current.src.includes('?') ? '&' : '?';
			const next = `${current.src}${sep}_retry=${attempt}`;
			// Cache-bust so the browser actually re-requests. Svelte won't
			// overwrite this unless the bound src expression itself changes.
			timer = setTimeout(() => {
				node.src = next;
			}, 500 * attempt);
		} else {
			current.onFail?.();
		}
	}

	node.addEventListener('load', onLoad);
	node.addEventListener('error', onError);

	return {
		update(next: PhotoRetryParams) {
			// A new photo (e.g. recycled node in an unkeyed each) resets retries.
			if (next.src !== current.src) attempt = 0;
			current = next;
		},
		destroy() {
			if (timer) clearTimeout(timer);
			node.removeEventListener('load', onLoad);
			node.removeEventListener('error', onError);
		}
	};
}
