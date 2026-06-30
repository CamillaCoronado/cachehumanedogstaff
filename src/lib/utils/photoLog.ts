/**
 * Diagnostics for dog-photo load failures.
 *
 * Photos are Firebase Storage download URLs. When an <img> fails to load we
 * can't tell from the error event alone whether it was a transient network
 * blip, a 503 (rate-limited), or a 403 (revoked/expired token). This probes
 * the URL with a fetch so the console shows the actual cause.
 */
export function logPhotoError(context: string, dogId: string | null, photoUrl: string | null | undefined) {
	console.warn(`[photo] load failed (${context})`, { dogId, photoUrl });
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
		})
		.catch((err) => {
			console.warn(`[photo] probe network error (${context})`, {
				dogId,
				ms: Date.now() - startedAt,
				error: err instanceof Error ? err.message : String(err),
				photoUrl
			});
		});
}

export function logPhotoLoaded(context: string, dogId: string | null) {
	console.debug(`[photo] loaded (${context})`, { dogId });
}
