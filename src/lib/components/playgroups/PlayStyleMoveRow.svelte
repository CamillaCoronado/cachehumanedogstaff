<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Dog, DogPlayStyle } from '$lib/types';
	import { PLAY_STYLE_LABELS, sizeCategory, sizeLabelShort } from '$lib/utils/playgroupRecommendations';

	export let dog: Dog;
	export let value: DogPlayStyle | 'both' | 'unassessed';
	export let editable = true;
	// Locked = the column is driven by something other than playStyles (e.g. not
	// dog-social), so moving them here wouldn't actually change anything.
	export let locked = false;
	export let lockedNote = '';

	const dispatch = createEventDispatcher<{ move: DogPlayStyle | 'both' | 'unassessed' }>();

	const options: { value: DogPlayStyle | 'both' | 'unassessed'; label: string }[] = [
		{ value: 'rough_and_rowdy', label: PLAY_STYLE_LABELS.rough_and_rowdy },
		{ value: 'both', label: 'Both (Rough & Gentle)' },
		{ value: 'gentle_and_dainty', label: PLAY_STYLE_LABELS.gentle_and_dainty },
		{ value: 'solo', label: PLAY_STYLE_LABELS.solo },
		{ value: 'unassessed', label: 'Needs Assessment' }
	];

	function handleChange(event: Event) {
		const next = (event.currentTarget as HTMLSelectElement).value as DogPlayStyle | 'both' | 'unassessed';
		dispatch('move', next);
	}
</script>

<div class="playstyle-move-row">
	<a href={`/dogs/${dog.id}`} class="dog-link">
		{dog.name}
		<span class="size-badge size-badge-{sizeCategory(dog)}">{sizeLabelShort(dog)}</span>
	</a>
	{#if locked}
		<span class="playstyle-locked-note">{lockedNote}</span>
	{:else if editable}
		<select class="playstyle-move-select" {value} on:change={handleChange}>
			{#each options as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	{/if}
</div>

<style>
	.playstyle-move-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding: 0.2rem 0;
	}

	.dog-link {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.76rem;
		font-weight: 600;
	}

	.size-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1em;
		height: 1.1em;
		border-radius: 50%;
		font-size: 0.6rem;
		font-weight: 900;
		line-height: 1;
	}

	.size-badge-tiny {
		background: #fce8e8;
		color: #8a3e3c;
		border: 1px solid #e6b8b8;
	}

	.size-badge-small {
		background: #fdf3e3;
		color: #7a4f10;
		border: 1px solid #f0c87a;
	}

	.size-badge-medium {
		background: #e8f4fc;
		color: #016aa5;
		border: 1px solid #b0d4ee;
	}

	.size-badge-large {
		background: #ede8fc;
		color: #5a3a8a;
		border: 1px solid #c5b4e8;
	}

	.size-badge-unknown {
		background: #f0f2f5;
		color: #7a8fa6;
		border: 1px solid #c8d3df;
	}

	.playstyle-move-select {
		font-size: 0.68rem;
		border: 1px solid #c6d4e4;
		border-radius: 999px;
		padding: 0.12rem 0.4rem;
		background: #fff;
	}

	.playstyle-locked-note {
		font-size: 0.66rem;
		color: #5a6b7d;
		font-style: italic;
	}
</style>
