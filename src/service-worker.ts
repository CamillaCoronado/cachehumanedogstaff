/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline-first app shell for the shelter's weak cell signal.
//
// Install saves only the HTML shell and the small static files, plus whatever of this
// deploy's build the previous deploy's cache already holds (hashed file names, so an
// unchanged file is the same file). Everything else is saved when the app loads it,
// or by a one-file-at-a-time fill after activation. An earlier version downloaded the whole build in one all-or-nothing batch
// on install; on a flaky signal that batch kept failing, so the cache never got made.
//
// Each deploy gets its own cache (keyed by `version`), and the previous one is kept
// until the next deploy so a page still running the old build can finish loading.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const PREFIX = 'app-';
const CACHE = `${PREFIX}${version}`;
// Every route renders client-side (ssr = false), so one shell serves them all.
const SHELL = '/';
const BUILD = new Set(build);
const STATIC = new Set(files);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.add(SHELL);
			await Promise.allSettled([...STATIC].map((path) => cache.add(path)));
			// Carry over unchanged build files instead of downloading them again.
			for (const key of await caches.keys()) {
				if (key === CACHE || !key.startsWith(PREFIX)) continue;
				const old = await caches.open(key);
				for (const request of await old.keys()) {
					const path = new URL(request.url).pathname;
					if (!BUILD.has(path) || (await cache.match(path))) continue;
					const hit = await old.match(request);
					if (hit) await cache.put(path, hit);
				}
			}
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Keep this deploy's cache and the newest one before it; drop the rest.
			const older = (await caches.keys())
				.filter((key) => key.startsWith(PREFIX) && key !== CACHE)
				.sort((a, b) => Number(b.slice(PREFIX.length)) - Number(a.slice(PREFIX.length)));
			await Promise.all(older.slice(1).map((key) => caches.delete(key)));
			await sw.clients.claim();
		})()
	);
	// Then, quietly, the rest of this deploy's files, one at a time. The cached shell
	// can only start pages whose files are cached once Vercel stops serving this
	// deploy, so they all need to land eventually. A file that fails is retried on
	// the next start; nothing is all-or-nothing.
	void fillCache();
});

let filling = false;
async function fillCache() {
	if (filling) return;
	filling = true;
	try {
		const cache = await caches.open(CACHE);
		for (const path of BUILD) {
			if (await caches.match(path)) continue;
			await cache.add(path).catch(() => {});
		}
	} finally {
		filling = false;
	}
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin || url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			caches
				.open(CACHE)
				.then((cache) => cache.match(SHELL))
				.then((hit) => hit ?? fetch(request))
		);
		return;
	}
	// Hashed build files never change, so any cache's copy is good, including the
	// previous deploy's for a page still running it.
	if (BUILD.has(url.pathname) || STATIC.has(url.pathname) || url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(fromCacheOrSave(event, url.pathname));
	}
});

// The first load runs before this worker controls the page, so its files never pass
// through the fetch handler. The page sends their paths once the worker is ready;
// they usually come straight from the browser's HTTP cache.
sw.addEventListener('message', (event) => {
	if (event.data?.type !== 'cache-loaded') return;
	const paths = (event.data.paths as string[]).filter((path) => BUILD.has(path));
	event.waitUntil(
		caches
			.open(CACHE)
			.then(async (cache) => {
				for (const path of paths) {
					if (!(await cache.match(path))) await cache.add(path).catch(() => {});
				}
			})
			.then(fillCache)
	);
});

async function fromCacheOrSave(event: FetchEvent, path: string): Promise<Response> {
	const hit = await caches.match(path);
	if (hit) return hit;
	const response = await fetch(event.request);
	if (response.ok && (BUILD.has(path) || STATIC.has(path))) {
		const copy = response.clone();
		event.waitUntil(caches.open(CACHE).then((cache) => cache.put(path, copy)));
	}
	return response;
}
