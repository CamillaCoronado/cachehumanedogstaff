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
	url?: string;
}

/** Fetch with a hard timeout — a plain fetch() to a blocked host can hang
 *  far longer than anyone will wait around to find out, which is itself
 *  the finding (a clean reject/403/404 would return in well under a second). */
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<{ kind: 'ok'; res: Response } | { kind: 'timeout' } | { kind: 'error'; message: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	return fetch(url, { ...options, signal: controller.signal })
		.then((res) => ({ kind: 'ok' as const, res }))
		.catch((err) => {
			if (err instanceof DOMException && err.name === 'AbortError') return { kind: 'timeout' as const };
			return { kind: 'error' as const, message: err instanceof Error ? err.message : String(err) };
		})
		.finally(() => clearTimeout(timer));
}

const PROBE_TIMEOUT_MS = 8000;

/**
 * Confirms (or rules out) a network-level block against a specific host:
 * fetches a known-reliable endpoint on our own server (already proven to
 * reach ASM fine, server-side) and a direct ASM image URL, side by side,
 * both capped at 8s. If ours succeeds fast and the direct ASM fetch times
 * out, that's a device/network-level block on that host — not app data,
 * not a code bug.
 */
export async function runConnectivityProbe(sampleAsmUrl: string) {
	pushEntry({ dogId: null, dogName: null, event: 'probe', detail: 'Connectivity test starting…' });

	const ownStart = Date.now();
	const own = await fetchWithTimeout('/api/asm/recent-adoptions?days=1', { cache: 'no-store' }, PROBE_TIMEOUT_MS);
	const ownMs = Date.now() - ownStart;
	pushEntry({
		dogId: null,
		dogName: null,
		event: 'probe',
		detail:
			own.kind === 'ok'
				? `our server (/api/asm) → ${own.res.status} (${ownMs}ms)`
				: own.kind === 'timeout'
					? `our server (/api/asm) → TIMED OUT after ${ownMs}ms`
					: `our server (/api/asm) → network error (${ownMs}ms): ${own.message}`
	});

	const asmStart = Date.now();
	const direct = await fetchWithTimeout(sampleAsmUrl, { cache: 'no-store', mode: 'no-cors' }, PROBE_TIMEOUT_MS);
	const asmMs = Date.now() - asmStart;
	pushEntry({
		dogId: null,
		dogName: null,
		event: 'probe',
		detail:
			direct.kind === 'ok'
				? `direct ASM fetch → responded, type=${direct.res.type} (${asmMs}ms)`
				: direct.kind === 'timeout'
					? `direct ASM fetch → TIMED OUT after ${asmMs}ms`
					: `direct ASM fetch → network error (${asmMs}ms): ${direct.message}`
	});
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
			? `[${context}] photoUrl set: ${photoUrl}`
			: `[${context}] no photoUrl — showing fallback`,
		url: photoUrl ?? undefined
	});
}

export function logPhotoError(context: string, dogId: string | null, photoUrl: string | null | undefined) {
	console.warn(`[photo] load failed (${context})`, { dogId, photoUrl });
	pushEntry({ dogId, dogName: null, event: 'error', detail: `[${context}] load failed: ${photoUrl ?? '(no url)'}` });
	if (!photoUrl || typeof fetch === 'undefined') return;
	const startedAt = Date.now();
	// A blocked/dropped connection can hang far longer than a normal error —
	// that's diagnostic in itself, but only if we cap the wait and say so.
	fetchWithTimeout(photoUrl, { method: 'GET', cache: 'no-store' }, PROBE_TIMEOUT_MS).then((result) => {
		const ms = Date.now() - startedAt;
		const detail =
			result.kind === 'ok'
				? `[${context}] probe → ${result.res.status} ${result.res.statusText} (${ms}ms)`
				: result.kind === 'timeout'
					? `[${context}] probe → TIMED OUT after ${ms}ms (no response — likely blocked, not rejected)`
					: `[${context}] probe network error (${ms}ms): ${result.message}`;
		console.warn(`[photo] ${detail}`, { dogId, photoUrl });
		pushEntry({ dogId, dogName: null, event: 'probe', detail });
	});
}

export function logPhotoLoaded(context: string, dogId: string | null) {
	console.debug(`[photo] loaded (${context})`, { dogId });
	pushEntry({ dogId, dogName: null, event: 'loaded', detail: `[${context}] loaded successfully` });
}
