import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		sveltekit(),
		VitePWA({
			registerType: 'autoUpdate',
			workbox: {
				// Cache all JS, CSS, HTML, fonts, and images
				globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
				// Don't cache Vercel analytics or external APIs
				navigateFallbackDenylist: [/^\/api\//],
				runtimeCaching: [
					{
						// Firestore REST — network first, fall back to cache
						urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'firestore',
							networkTimeoutSeconds: 4,
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						// Firebase Auth — network first
						urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com\/.*/i,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'firebase-auth',
							networkTimeoutSeconds: 4,
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						// Google Sheets (dog colors) — stale-while-revalidate, 5 min TTL
						urlPattern: /^https:\/\/sheets\.googleapis\.com\/.*/i,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'sheets',
							expiration: { maxAgeSeconds: 300 },
							cacheableResponse: { statuses: [0, 200] }
						}
					}
				]
			},
			manifest: {
				name: 'Cache Humane Society',
				short_name: 'CHS Dogs',
				description: 'Staff management for Cache Humane Society',
				theme_color: '#016aa5',
				background_color: '#f0f5fa',
				display: 'standalone',
				start_url: '/',
				icons: [
					{
						src: '/favicon.svg',
						sizes: 'any',
						type: 'image/svg+xml',
						purpose: 'any maskable'
					}
				]
			}
		})
	]
});
