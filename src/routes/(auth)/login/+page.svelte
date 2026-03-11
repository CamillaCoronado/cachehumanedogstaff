<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authReady, authUser, initAuthListener } from '$lib/stores/auth';
	import { signInWithGoogle } from '$lib/firebase/auth';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { getAuthErrorMessage } from '$lib/firebase/errors';

	let loading = false;
	let errorMessage = '';

	onMount(() => {
		initAuthListener();
	});

	$: if ($authReady && $authUser) {
		goto('/');
	}

	async function handleGoogleLogin() {
		errorMessage = '';
		loading = true;
		try {
			const result = await signInWithGoogle();
			if (result) {
				await goto('/');
			}
		} catch (error) {
			const hostname = typeof window === 'undefined' ? 'this domain' : window.location.hostname;
			errorMessage = getAuthErrorMessage(error, hostname);
		} finally {
			loading = false;
		}
	}
</script>

<div class="login-sheet">
	<span class="login-tape-left" aria-hidden="true"></span>
	<span class="login-tape-right" aria-hidden="true"></span>

	<div class="login-heading">
		<span class="label-maker label-maker-blue">Cache Humane Society</span>
		<h1 class="login-title">Staff Sign-In Board</h1>
	</div>

	{#if !firebaseEnabled}
		<p class="login-status login-warn whiteboard-hand">
			Firebase is not configured. Local mode is active, so no login is required.
		</p>
	{:else}
		<div class="login-form">
			<button type="button" on:click={handleGoogleLogin} disabled={loading} class="google-submit typewriter">
				{loading ? 'Signing in...' : 'Continue with Google'}
			</button>

			{#if errorMessage}
				<p class="login-status login-error">{errorMessage}</p>
			{/if}
		</div>
	{/if}

	<div class="login-foot">
		<span class="foot-note whiteboard-hand">Need access? Ask an admin.</span>
	</div>
</div>

<style>
	.login-sheet {
		position: relative;
		border: 1px solid #d5e0ea;
		border-radius: 1rem;
		background: #ffffff;
		padding: 1.2rem 1rem 1rem;
		box-shadow: 0 16px 32px rgba(15, 38, 59, 0.12);
		overflow: hidden;
	}

	.login-sheet::after {
		content: none;
	}

	.login-tape-left,
	.login-tape-right {
		display: none;
	}

	.login-tape-left {
		left: 0;
	}

	.login-tape-right {
		right: 0;
	}

	.login-heading,
	.login-form,
	.login-foot,
	.login-status {
		position: relative;
		z-index: 1;
	}

	.login-title {
		margin-top: 0.55rem;
		font-size: 1.6rem;
		line-height: 1.08;
		color: #132f45;
	}

	.login-form {
		margin-top: 1rem;
		display: grid;
		gap: 0.72rem;
	}

	.login-status {
		border: 1px solid transparent;
		border-radius: 0.65rem;
		padding: 0.56rem 0.62rem;
		font-size: 0.82rem;
		line-height: 1.2;
	}

	.login-error {
		background: #fff1ee;
		border-color: #e8c3be;
		color: #8d3d39;
	}

	.login-warn {
		margin-top: 0.92rem;
		background: #fff7d9;
		border-color: #ebd595;
		color: #6e5719;
	}

	.google-submit {
		min-height: 2.6rem;
		border: 1px solid #016ba5;
		border-radius: 0.72rem;
		background: #016ba5;
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #ffffff;
		font-weight: 600;
	}

	.google-submit:hover {
		filter: brightness(0.96);
	}

	.google-submit:disabled {
		opacity: 0.62;
		cursor: not-allowed;
	}

	.login-foot {
		margin-top: 0.92rem;
	}

	.foot-note {
		font-size: 0.76rem;
		color: #5a7389;
	}

	@media (min-width: 640px) {
		.login-sheet {
			padding: 1.45rem 1.45rem 1.3rem;
		}

		.login-title {
			font-size: 1.95rem;
		}

		.google-submit {
			min-height: 2.75rem;
			font-size: 0.7rem;
		}
	}
</style>
