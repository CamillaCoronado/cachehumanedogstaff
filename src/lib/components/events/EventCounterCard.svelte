<script lang="ts">
	import { onMount } from 'svelte';
	import { confetti } from '@neoconfetti/svelte';
	import {
		subscribeVisitorCounter,
		adjustVisitorCounter,
		resetVisitorCounter,
		type CounterId
	} from '$lib/data/events';

	export let counterId: CounterId;
	export let eyebrow: string;
	export let heading: string;
	export let unitSingular: string;
	export let unitPlural: string;
	export let buttonLabel: string;
	export let trailEmoji: string;
	export let milestone = 25;
	export let theme: 'green' | 'purple' = 'green';

	let count = 0;
	let updatedAtIso: string | null = null;
	let loaded = false;
	let bumping = false;
	let confirmingReset = false;
	let celebrating = false;
	let bumpTimer: ReturnType<typeof setTimeout> | undefined;
	let celebrateTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		const unsubscribe = subscribeVisitorCounter(counterId, (counter) => {
			applyCount(counter.count);
			updatedAtIso = counter.updatedAt;
			loaded = true;
		});
		return () => {
			unsubscribe();
			clearTimeout(bumpTimer);
			clearTimeout(celebrateTimer);
		};
	});

	// Single entry point for count changes (local taps and other devices via
	// the subscription) so the bump/confetti animations fire for both.
	function applyCount(next: number) {
		if (next === count) return;
		if (next > count && loaded) {
			bumping = false;
			clearTimeout(bumpTimer);
			requestAnimationFrame(() => {
				bumping = true;
				bumpTimer = setTimeout(() => (bumping = false), 350);
			});
			if (next % milestone === 0) {
				celebrating = false;
				clearTimeout(celebrateTimer);
				requestAnimationFrame(() => {
					celebrating = true;
					celebrateTimer = setTimeout(() => (celebrating = false), 3000);
				});
			}
		}
		count = next;
	}

	function addOne() {
		confirmingReset = false;
		applyCount(count + 1);
		updatedAtIso = new Date().toISOString();
		void adjustVisitorCounter(counterId, 1);
	}

	function removeOne() {
		if (count === 0) return;
		confirmingReset = false;
		applyCount(count - 1);
		updatedAtIso = new Date().toISOString();
		void adjustVisitorCounter(counterId, -1);
	}

	function resetCounter() {
		if (!confirmingReset) {
			confirmingReset = true;
			return;
		}
		confirmingReset = false;
		applyCount(0);
		updatedAtIso = new Date().toISOString();
		void resetVisitorCounter(counterId);
	}

	$: pawTrail = Math.min(count, 12);
	$: updatedAtLabel = updatedAtIso
		? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(
				new Date(updatedAtIso)
			)
		: null;
</script>

<div class={`counter-card theme-${theme}`}>
	{#if celebrating}
		<div class="confetti-anchor" use:confetti={{ particleCount: 120, force: 0.6, stageHeight: 700 }}></div>
	{/if}

	<p class="counter-eyebrow typewriter">{eyebrow}</p>
	<h2 class="counter-heading whiteboard-hand erase-marker-blue">{heading}</h2>

	<div class={`counter-number ${bumping ? 'counter-bump' : ''}`} aria-live="polite">
		{loaded ? count : '·'}
	</div>
	<p class="counter-caption">
		{count === 1 ? unitSingular : unitPlural}
		{#if count > 0 && count % milestone === 0}
			— woohoo! 🎉
		{/if}
	</p>

	<div class="paw-trail" aria-hidden="true">
		{#each Array(pawTrail) as _, i}
			<span class="paw" style={`transform: rotate(${(i % 2 === 0 ? -1 : 1) * 18}deg)`}>{trailEmoji}</span>
		{/each}
	</div>

	<button class="count-btn" type="button" on:click={addOne}>
		<span class="count-btn-plus" aria-hidden="true">+1</span>
		<span class="count-btn-label">{buttonLabel}</span>
	</button>

	<div class="counter-tools">
		<button class="tool-btn typewriter" type="button" on:click={removeOne} disabled={count === 0}>
			−1 oops
		</button>
		<button
			class={`tool-btn typewriter ${confirmingReset ? 'tool-btn-danger' : ''}`}
			type="button"
			on:click={resetCounter}
			on:blur={() => (confirmingReset = false)}
		>
			{confirmingReset ? 'Tap again to reset' : 'Reset to 0'}
		</button>
	</div>

	{#if updatedAtLabel}
		<p class="counter-updated typewriter">Last counted at {updatedAtLabel} · shared across all devices</p>
	{/if}
</div>

<style>
	.counter-card {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		text-align: center;
		padding: 2rem 1.4rem 1.7rem;
		border: 1px solid #d1dfec;
		border-radius: 1.4rem;
		background:
			radial-gradient(30rem 16rem at 50% -20%, var(--card-halo) 0%, transparent 60%),
			rgba(255, 255, 255, 0.97);
		box-shadow:
			0 18px 40px rgba(14, 38, 61, 0.12),
			0 1px 0 rgba(255, 255, 255, 0.85) inset;
	}

	.theme-green {
		--card-halo: rgba(147, 57, 128, 0.09);
		--card-heading: #016aa5;
		--btn-top: #45c235;
		--btn-mid: #3aaf2a;
		--btn-bottom: #329c24;
		--btn-shadow: rgba(58, 175, 42, 0.38);
		--btn-shadow-hover: rgba(58, 175, 42, 0.42);
		--btn-shadow-active: rgba(58, 175, 42, 0.32);
	}

	.theme-purple {
		--card-halo: rgba(1, 106, 165, 0.08);
		--card-heading: #933980;
		--btn-top: #a8449a;
		--btn-mid: #933980;
		--btn-bottom: #7e2f6d;
		--btn-shadow: rgba(147, 57, 128, 0.38);
		--btn-shadow-hover: rgba(147, 57, 128, 0.42);
		--btn-shadow-active: rgba(147, 57, 128, 0.32);
	}

	.confetti-anchor {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		pointer-events: none;
	}

	.counter-eyebrow {
		margin: 0;
		font-size: 0.6rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #526b81;
	}

	.counter-heading {
		margin: 0;
		font-size: clamp(1.3rem, 4.5vw, 1.8rem);
		color: var(--card-heading);
	}

	.counter-number {
		margin-top: 0.3rem;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: clamp(5.5rem, 24vw, 9.5rem);
		line-height: 1;
		letter-spacing: -0.03em;
		color: #133149;
		font-variant-numeric: tabular-nums;
	}

	.counter-bump {
		animation: numberBump 320ms ease-out;
	}

	@keyframes numberBump {
		0% { transform: scale(1); }
		35% { transform: scale(1.14); color: var(--btn-mid); }
		100% { transform: scale(1); }
	}

	.counter-caption {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 1rem;
		font-weight: 600;
		color: #526b81;
	}

	.paw-trail {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.15rem;
		min-height: 1.4rem;
		margin-top: 0.2rem;
	}

	.paw {
		font-size: 1rem;
		opacity: 0.75;
		animation: pawPop 260ms ease-out;
	}

	@keyframes pawPop {
		0% { transform: scale(0); }
		70% { transform: scale(1.3); }
		100% { transform: scale(1); }
	}

	.count-btn {
		margin-top: 0.9rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		width: min(100%, 20rem);
		padding: 1.3rem 1rem 1.15rem;
		border: 0;
		border-radius: 1.1rem;
		background: linear-gradient(180deg, var(--btn-top) 0%, var(--btn-mid) 60%, var(--btn-bottom) 100%);
		color: #ffffff;
		cursor: pointer;
		box-shadow:
			0 10px 24px var(--btn-shadow),
			0 1px 0 rgba(255, 255, 255, 0.35) inset;
		transition: transform 120ms ease, box-shadow 120ms ease;
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
	}

	.count-btn:hover {
		transform: translateY(-2px);
		box-shadow:
			0 14px 28px var(--btn-shadow-hover),
			0 1px 0 rgba(255, 255, 255, 0.35) inset;
	}

	.count-btn:active {
		transform: translateY(1px) scale(0.985);
		box-shadow:
			0 6px 14px var(--btn-shadow-active),
			0 1px 0 rgba(255, 255, 255, 0.3) inset;
	}

	.count-btn-plus {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: clamp(2.2rem, 8vw, 3rem);
		line-height: 1;
	}

	.count-btn-label {
		font-family: var(--font-ui);
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		opacity: 0.92;
	}

	.counter-tools {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.9rem;
	}

	.tool-btn {
		border: 1px solid #c4d6e8;
		border-radius: 999px;
		padding: 0.42rem 1rem;
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 700;
		background: rgba(1, 106, 165, 0.06);
		color: #016aa5;
		cursor: pointer;
	}

	.tool-btn:hover:not(:disabled) {
		background: rgba(1, 106, 165, 0.14);
	}

	.tool-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.tool-btn-danger {
		border-color: rgba(207, 75, 75, 0.5);
		background: rgba(207, 75, 75, 0.1);
		color: #cf4b4b;
	}

	.counter-updated {
		margin: 0.7rem 0 0;
		font-size: 0.52rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #8aa0b4;
	}
</style>
