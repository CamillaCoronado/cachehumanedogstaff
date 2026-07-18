/**
 * ASM-hosted dog photos are fetched directly by the browser from
 * service.sheltermanager.com. Confirmed on a shelter iPad: that host is
 * unreachable from the device's network (times out completely) while
 * everything else — including our own server, which reaches ASM fine — works.
 * Route ASM photo URLs through our own image proxy so the browser only ever
 * talks to our own domain. Firebase Storage URLs (app uploads) are untouched
 * — they aren't affected and don't need proxying.
 */
export function resolveDogPhotoUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	if (!url.includes('sheltermanager.com')) return url;
	return `/api/asm/image-proxy?url=${encodeURIComponent(url)}`;
}
