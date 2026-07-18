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

function logProbeResult(
	label: string,
	ms: number,
	result: { kind: 'ok'; res: Response } | { kind: 'timeout' } | { kind: 'error'; message: string }
) {
	const detail =
		result.kind === 'ok'
			? `${label} → responded, status=${result.res.status || '(opaque)'} type=${result.res.type} (${ms}ms)`
			: result.kind === 'timeout'
				? `${label} → TIMED OUT after ${ms}ms`
				: `${label} → network error (${ms}ms): ${result.message}`;
	pushEntry({ dogId: null, dogName: null, event: 'probe', detail });
}

async function timedFetch(label: string, url: string, options: RequestInit) {
	const start = Date.now();
	const result = await fetchWithTimeout(url, options, PROBE_TIMEOUT_MS);
	logProbeResult(label, Date.now() - start, result);
}

/**
 * Runs several independent tests in parallel to narrow down WHY a host is
 * unreachable, not just confirm that it is:
 *  - our own server (baseline — already proven to reach ASM fine)
 *  - a well-known external host (Apple's own captive-portal check URL) —
 *    if THIS also fails, it's not sheltermanager-specific, it's "nothing
 *    external works except our app" (allowlist-only network / MDM)
 *  - the ASM entry host directly (service.sheltermanager.com)
 *  - the actual media CDN host ASM redirects to (us06d.sheltermanager.com)
 *    — if this one works but the entry host doesn't, the block is keyed to
 *    that specific hostname, not the whole sheltermanager.com domain
 *  - DNS-over-HTTPS lookup for the ASM host via Cloudflare — if even this
 *    fails, the network is blocking arbitrary external HTTPS, not just DNS
 *    for that one name
 */
export async function runConnectivityProbe(sampleAsmUrl: string) {
	pushEntry({ dogId: null, dogName: null, event: 'probe', detail: 'Network diagnostic starting — running 5 tests in parallel…' });

	let asmHost = 'service.sheltermanager.com';
	try {
		asmHost = new URL(sampleAsmUrl).host;
	} catch { /* keep default */ }

	await Promise.all([
		timedFetch('our server (/api/asm)', '/api/asm/recent-adoptions?days=1', { cache: 'no-store' }),
		timedFetch('known-external host (apple.com captive check)', 'https://www.apple.com/library/test/success.html', {
			cache: 'no-store',
			mode: 'no-cors'
		}),
		timedFetch(`ASM entry host (${asmHost})`, sampleAsmUrl, { cache: 'no-store', mode: 'no-cors' }),
		timedFetch(
			'ASM media CDN host (us06d.sheltermanager.com)',
			'https://us06d.sheltermanager.com/service?account=sl2799&method=media_image&mediaid=1&ts=0',
			{ cache: 'no-store', mode: 'no-cors' }
		),
		(async () => {
			const start = Date.now();
			const result = await fetchWithTimeout(
				`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(asmHost)}&type=A`,
				{ headers: { Accept: 'application/dns-json' }, cache: 'no-store' },
				PROBE_TIMEOUT_MS
			);
			const ms = Date.now() - start;
			if (result.kind !== 'ok') {
				logProbeResult('DNS-over-HTTPS lookup (via Cloudflare)', ms, result);
				return;
			}
			try {
				const body = await result.res.json();
				const ips = Array.isArray(body?.Answer) ? body.Answer.map((a: { data: string }) => a.data).join(', ') : '(no answer)';
				pushEntry({
					dogId: null,
					dogName: null,
					event: 'probe',
					detail: `DNS-over-HTTPS lookup (via Cloudflare) → ${asmHost} resolves to: ${ips} (${ms}ms)`
				});
			} catch (e) {
				pushEntry({
					dogId: null,
					dogName: null,
					event: 'probe',
					detail: `DNS-over-HTTPS lookup (via Cloudflare) → got a response but couldn't parse it (${ms}ms): ${e instanceof Error ? e.message : String(e)}`
				});
			}
		})()
	]);

	pushEntry({ dogId: null, dogName: null, event: 'probe', detail: 'Network diagnostic finished.' });
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
