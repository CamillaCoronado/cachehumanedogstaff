/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline-first app shell. The shelter's cell signal is weak, so everything this
// deploy needs to boot (JS, CSS, static files, the HTML shell) is cached on install
// and served from the phone, never waiting on the network. Firestore keeps its own
// cache; API calls and other origins pass straight through.
//
// Each deploy gets its own cache (keyed by `version`), so a cached shell only ever
// points at chunks from the same deploy. When a new deploy ships, the browser picks
// up the new worker in the background and it takes over on the next load.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `app-${version}`;
// Every route renders client-side (ssr = false), so one shell serves them all.
const SHELL = '/';
const ASSETS = new Set([...build, ...files]);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([...ASSETS, SHELL]))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin || url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(fromCache(SHELL).then((hit) => hit ?? fetch(request)));
		return;
	}
	if (ASSETS.has(url.pathname)) {
		event.respondWith(fromCache(url.pathname).then((hit) => hit ?? fetch(request)));
	}
});

async function fromCache(path: string): Promise<Response | undefined> {
	const cache = await caches.open(CACHE);
	return cache.match(path);
}
