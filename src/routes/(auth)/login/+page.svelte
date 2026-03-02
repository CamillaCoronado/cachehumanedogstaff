<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authReady, authUser, initAuthListener } from '$lib/stores/auth';
	import { signInWithGoogle } from '$lib/firebase/auth';
	import { firebaseEnabled } from '$lib/firebase/config';

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
			errorMessage = error instanceof Error ? error.message : 'Unable to sign in.';
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
		<p class="login-sub whiteboard-hand erase-marker-blue">Sign in with your Google account to manage shelter operations.</p>
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
			<p class="login-status login-info">Email/password login is disabled. Google sign-in only.</p>
		</div>
	{/if}

	<div class="login-foot">
		<span class="foot-note whiteboard-hand">Need access? Ask an admin.</span>
	</div>
</div>

<style>
	.login-sheet {
		position: relative;
		border: 2px solid var(--marker-black);
		border-radius: 0.42rem;
		background: var(--paper);
		padding: 0.95rem 0.82rem 0.84rem;
		box-shadow:
			0 4px 8px rgba(0, 0, 0, 0.08),
			0 14px 28px rgba(0, 0, 0, 0.14);
		overflow: hidden;
	}

	.login-sheet::after {
		content: '';
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			0deg,
			transparent 0,
			transparent 23px,
			rgba(170, 190, 210, 0.09) 23px,
			rgba(170, 190, 210, 0.09) 24px
		);
		pointer-events: none;
	}

	.login-tape-left,
	.login-tape-right {
		position: absolute;
		top: -0.36rem;
		width: 2.35rem;
		height: 0.55rem;
		border-radius: 0.06rem;
		z-index: 2;
		box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.08);
	}

	.login-tape-left {
		left: 0.72rem;
		background: var(--washi-yellow);
		transform: rotate(-3deg);
	}

	.login-tape-right {
		right: 1.05rem;
		background: var(--washi-blue);
		transform: rotate(3deg);
	}

	.login-heading,
	.login-form,
	.login-foot,
	.login-status {
		position: relative;
		z-index: 1;
	}

	.login-title {
		margin-top: 0.42rem;
		font-size: 1.5rem;
		line-height: 1.06;
		color: var(--marker-black);
	}

	.login-sub {
		margin-top: 0.36rem;
		font-size: 0.9rem;
		line-height: 1.2;
	}

	.login-form {
		margin-top: 0.86rem;
		display: grid;
		gap: 0.62rem;
		text-align: center;
	}

	.login-status {
		border: 1.5px solid transparent;
		border-radius: 0.24rem;
		padding: 0.46rem 0.56rem;
		font-size: 0.84rem;
		line-height: 1.2;
	}

	.login-error {
		background: #fff1ee;
		border-color: #e8c3be;
		color: #8d3d39;
	}

	.login-warn {
		margin-top: 0.84rem;
		background: #fff7d9;
		border-color: #ebd595;
		color: #6e5719;
	}

	.login-info {
		background: #eef4fb;
		border-color: #bfd1e8;
		color: #29567f;
	}

	.google-submit {
		min-height: 2.3rem;
		border: 1.5px solid var(--marker-black);
		border-radius: 0.25rem;
		background: #ffffff;
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: #1f2937;
		font-weight: 700;
	}

	.google-submit:hover {
		filter: brightness(0.97);
	}

	.google-submit:disabled {
		opacity: 0.62;
		cursor: not-allowed;
	}

	.login-foot {
		margin-top: 0.78rem;
	}

	.foot-note {
		font-size: 0.78rem;
		color: var(--ink-soft);
	}

	@media (min-width: 640px) {
		.login-sheet {
			padding: 1.2rem 1.2rem 1.08rem;
		}

		.login-title {
			font-size: 1.82rem;
		}

		.login-sub {
			font-size: 0.94rem;
		}

		.google-submit {
			min-height: 2.5rem;
			font-size: 0.64rem;
		}
	}
</style>
