<script lang="ts">
	import { onMount } from 'svelte';
	import { listDogs } from '$lib/data/dogs';
	import { isDayTripEligible } from '$lib/utils/attention';
	import type { Dog } from '$lib/types';
	import TripLogForm from '$lib/components/daytrips/TripLogForm.svelte';

	let dogs: Dog[] = [];
	let loading = true;
	let submitted = false;
	let copyText = '';

	onMount(async () => {
		try {
			const all = await listDogs();
			dogs = all
				.filter((d) => d.status === 'active' && !d.inFoster && isDayTripEligible(d))
				.sort((a, b) => a.name.localeCompare(b.name));
		} catch (e) {
			console.error(e);
		} finally {
			loading = false;
		}
	});

	async function copyToClipboard() {
		try { await navigator.clipboard.writeText(copyText); } catch { /* ignore */ }
	}
</script>

<svelte:head>
	<title>Log a Day Trip — Cache Humane Society</title>
</svelte:head>

<div class="tl-page">
	<div class="tl-card">

		<div class="tl-header">
			<div class="tl-header-icon">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="110 180 420 340" width="74" height="60" fill="#3aaf2a">
				<g transform="translate(410,330) rotate(-12) scale(0.35) translate(-256,-256)">
					<path d="M226.5 92.9c14.3 42.9-.3 86.2-32.6 96.8s-70.1-15.6-84.4-58.5s.3-86.2 32.6-96.8s70.1 15.6 84.4 58.5zM100.4 198.6c18.9 32.4 14.3 70.1-10.2 84.1s-59.7-.9-78.5-33.3S-2.7 179.3 21.8 165.3s59.7 .9 78.5 33.3zM69.2 401.2C121.6 259.9 214.7 224 256 224s134.4 35.9 186.8 177.2c3.6 9.7 5.2 20.1 5.2 30.5l0 1.6c0 25.8-20.9 46.7-46.7 46.7c-11.5 0-22.9-1.4-34-4.2l-88-22c-15.3-3.8-31.3-3.8-46.6 0l-88 22c-11.1 2.8-22.5 4.2-34 4.2C84.9 480 64 459.1 64 433.3l0-1.6c0-10.4 1.6-20.8 5.2-30.5zM421.8 282.7c-24.5-14-29.1-51.7-10.2-84.1s54-47.3 78.5-33.3s29.1 51.7 10.2 84.1s-54 47.3-78.5 33.3zM310.1 189.7c-32.3-10.6-46.9-53.9-32.6-96.8s52.1-69.1 84.4-58.5s46.9 53.9 32.6 96.8s-52.1 69.1-84.4 58.5z"/>
				</g>
				<g transform="translate(215,370) rotate(12) scale(0.35) translate(-256,-256)">
					<path d="M226.5 92.9c14.3 42.9-.3 86.2-32.6 96.8s-70.1-15.6-84.4-58.5s.3-86.2 32.6-96.8s70.1 15.6 84.4 58.5zM100.4 198.6c18.9 32.4 14.3 70.1-10.2 84.1s-59.7-.9-78.5-33.3S-2.7 179.3 21.8 165.3s59.7 .9 78.5 33.3zM69.2 401.2C121.6 259.9 214.7 224 256 224s134.4 35.9 186.8 177.2c3.6 9.7 5.2 20.1 5.2 30.5l0 1.6c0 25.8-20.9 46.7-46.7 46.7c-11.5 0-22.9-1.4-34-4.2l-88-22c-15.3-3.8-31.3-3.8-46.6 0l-88 22c-11.1 2.8-22.5 4.2-34 4.2C84.9 480 64 459.1 64 433.3l0-1.6c0-10.4 1.6-20.8 5.2-30.5zM421.8 282.7c-24.5-14-29.1-51.7-10.2-84.1s54-47.3 78.5-33.3s29.1 51.7 10.2 84.1s-54 47.3-78.5 33.3zM310.1 189.7c-32.3-10.6-46.9-53.9-32.6-96.8s52.1-69.1 84.4-58.5s46.9 53.9 32.6 96.8s-52.1 69.1-84.4 58.5z"/>
				</g>
			</svg>
		</div>
			<h1 class="tl-title">Day Trip Log</h1>
			<p class="tl-sub">Cache Humane Society</p>
		</div>

		{#if submitted}
			<div class="tl-success">
				<div class="tl-success-icon">🎉</div>
				<p class="tl-success-title">Trip logged — thank you!</p>
				<p class="tl-success-sub">You're making a difference for shelter dogs.</p>
				<button class="tl-btn tl-btn-new" on:click={() => { submitted = false; copyText = ''; }}>
					Log another trip
				</button>
			</div>
		{:else if loading}
			<p class="tl-loading">Loading dogs…</p>
		{:else}
			<div class="tl-form-wrap">
				<TripLogForm
					{dogs}
					source="qr"
					on:submitted={(e) => { copyText = e.detail.copyText; submitted = true; }}
				/>
			</div>
		{/if}
	</div>
</div>

<style>
	.tl-page {
		min-height: 100vh;
		background: #f0f4f8;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 24px 16px 64px;
	}

	.tl-card {
		width: 100%;
		max-width: 780px;
		background: #fff;
		border-radius: 20px;
		box-shadow: 0 4px 0 #d0d8e0, 0 8px 32px rgba(0,0,0,.08);
		overflow: hidden;
	}

	/* ── Header ── */
	.tl-header {
		padding: 20px 28px 16px;
		background: #016aa5;
		text-align: center;
	}

	.tl-header-icon {
		display: flex;
		justify-content: center;
		margin-bottom: 6px;
	}

	.tl-title {
		font-size: 1.3rem;
		font-weight: 800;
		color: #fff;
		margin: 0 0 2px;
		letter-spacing: -0.01em;
	}

	.tl-sub {
		font-size: 0.78rem;
		font-weight: 600;
		color: rgba(255,255,255,0.8);
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* ── Form ── */
	.tl-form-wrap { padding: 28px 28px 32px; }

	/* ── Loading ── */
	.tl-loading {
		padding: 40px 28px;
		font-size: 15px;
		font-weight: 600;
		color: #afafaf;
		text-align: center;
	}

	/* ── Success ── */
	.tl-success {
		padding: 40px 28px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
	}

	.tl-success-icon { font-size: 3rem; line-height: 1; }

	.tl-success-title {
		font-size: 1.25rem;
		font-weight: 800;
		color: #3aaf2a;
		margin: 0;
	}

	.tl-success-sub {
		font-size: 0.9rem;
		color: #777777;
		margin: 0;
	}

	.tl-copy-pre {
		width: 100%;
		margin: 8px 0 0;
		padding: 16px;
		background: #fafafa;
		border: 2px solid #e5e5e5;
		border-radius: 12px;
		font-size: 0.8rem;
		line-height: 1.6;
		white-space: pre-wrap;
		color: #4b4b4b;
		text-align: left;
		box-sizing: border-box;
	}

	.tl-btn {
		width: 100%;
		height: 52px;
		border-radius: 12px;
		font-size: 15px;
		font-weight: 800;
		border: none;
		cursor: pointer;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.tl-btn-new {
		background: #933980;
		color: #fff;
		box-shadow: 0 4px 0 #6b2a5e;
		transition: transform 0.1s, box-shadow 0.1s;
		margin-top: 8px;
	}

	.tl-btn-new:active {
		transform: translateY(4px);
		box-shadow: none;
	}
</style>
