import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Standalone vitest config: keeps unit tests independent of the SvelteKit/PWA
// build pipeline in vite.config.js. Only pure modules under src/lib are tested.
export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib')
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
