<script>
	import '../app.css';
	import { Toaster } from 'svelte-french-toast';
	import { onMount } from 'svelte';

	// The static loading screen in app.html, up until the app could draw itself.
	onMount(() => {
		document.getElementById('boot')?.remove();
		try {
			sessionStorage.removeItem('boot-reloaded');
		} catch {
			// Storage blocked: the boot screen just won't auto-reload.
		}
		// Have the service worker save the files this load fetched before it was in charge.
		navigator.serviceWorker?.ready
			.then((registration) => {
				const paths = performance
					.getEntriesByType('resource')
					.map((entry) => new URL(entry.name).pathname)
					.filter((path) => path.startsWith('/_app/'));
				registration.active?.postMessage({ type: 'cache-loaded', paths });
			})
			.catch(() => {});
	});
</script>

<slot />
<Toaster position="top-right" />
