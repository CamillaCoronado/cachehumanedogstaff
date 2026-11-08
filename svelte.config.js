import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// The service worker answers every page with the one cached copy of '/', so its
		// links to the app's code must be absolute. Relative ones ('./_app/...') would
		// point at '/dogs/_app/...' when that copy opens /dogs/123.
		paths: { relative: false }
	}
};

export default config;
