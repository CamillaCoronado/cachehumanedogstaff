import { writable } from 'svelte/store';

/**
 * Diagnostics for dog-photo rendering, visible in the UI (see
 * PhotoDebugPanel.svelte) so this can be read on devices without dev tools
 * access, like an iPad. Temporary — remove once the photo issue is found.
 */

export interface PhotoLogEntry {
	time: string;
	dogId: string | null;
	dogName: string | null;
	event: 'render' | 'loaded' | 'error' | 'probe';
	detail: string;
}

const MAX_ENTRIES = 100;
export const photoDebugLog = writable<PhotoLogEntry[]>([]);

function pushEntry(entry: Omit<PhotoLogEntry, 'time'>) {
	photoDebugLog.update((log) => [
		{ ...entry, time: new Date().toLocaleTimeString() },
		...log
	].slice(0, MAX_ENTRIES));
}

/** Log what a card decided to render for a dog: a real photoUrl, or the fallback. */
export function logPhotoRender(
	context: string,
	dogId: string | null,
	dogName: string | null,
	photoUrl: string | null | undefined
) {
	pushEntry({
		dogId,
		dogName,
		event: 'render',
		detail: photoUrl
			? `[${context}] photoUrl set: ${photoUrl.slice(0, 90)}`
			: `[${context}] no photoUrl — showing fallback`
	});
}

export function logPhotoError(context: string, dogId: string | null, photoUrl: string | null | undefined) {
	console.warn(`[photo] load failed (${context})`, { dogId, photoUrl });
	pushEntry({ dogId, dogName: null, event: 'error', detail: `[${context}] load failed: ${photoUrl ?? '(no url)'}` });
	if (!photoUrl || typeof fetch === 'undefined') return;
	const startedAt = Date.now();
	fetch(photoUrl, { method: 'GET', cache: 'no-store' })
		.then((res) => {
			console.warn(`[photo] probe ${res.status} ${res.statusText} (${context})`, {
				dogId,
				ok: res.ok,
				ms: Date.now() - startedAt,
				photoUrl
			});
			pushEntry({
				dogId,
				dogName: null,
				event: 'probe',
				detail: `[${context}] probe → ${res.status} ${res.statusText} (${Date.now() - startedAt}ms)`
			});
		})
		.catch((err) => {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[photo] probe network error (${context})`, {
				dogId,
				ms: Date.now() - startedAt,
				error: message,
				photoUrl
			});
			pushEntry({ dogId, dogName: null, event: 'probe', detail: `[${context}] probe network error: ${message}` });
		});
}

export function logPhotoLoaded(context: string, dogId: string | null) {
	console.debug(`[photo] loaded (${context})`, { dogId });
	pushEntry({ dogId, dogName: null, event: 'loaded', detail: `[${context}] loaded successfully` });
}
