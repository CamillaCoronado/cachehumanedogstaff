import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Confirmed on a shelter iPad: our own server reaches ASM fine (~1s), but a
// direct browser fetch to service.sheltermanager.com times out completely
// (network-level block, not a data or CORS issue). Proxy the image through
// here so the browser only ever talks to our own domain.
export async function GET({ url }: RequestEvent) {
	const { ASM_URL } = env;
	if (!ASM_URL) throw error(503, 'ASM not configured');

	const target = url.searchParams.get('url');
	if (!target) throw error(400, 'Missing url param');

	let targetUrl: URL;
	let asmHost: string;
	try {
		targetUrl = new URL(target);
		asmHost = new URL(ASM_URL).host;
	} catch {
		throw error(400, 'Invalid url');
	}

	// Only ever proxy to the configured ASM host — otherwise this endpoint
	// would be an open proxy for arbitrary URLs (SSRF).
	if (targetUrl.host !== asmHost) {
		throw error(400, 'URL not allowed');
	}

	let res: Response;
	try {
		res = await fetch(targetUrl.toString());
	} catch (e) {
		throw error(502, `Image fetch failed: ${e instanceof Error ? e.message : String(e)}`);
	}

	if (!res.ok || !res.body) {
		throw error(res.status || 502, 'Image not available');
	}

	return new Response(res.body, {
		status: 200,
		headers: {
			'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
			'Cache-Control': 'public, max-age=86400, s-maxage=86400'
		}
	});
}
