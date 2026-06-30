<script lang="ts">
	import type { Dog } from '$lib/types';
	import { dogStripeColor } from '$lib/utils/dates';
	import { setDogManualTripColor } from '$lib/data/dogs';
	import toast from 'svelte-french-toast';

	export let dogs: Dog[] = [];
	export let sheetColors: Record<string, 'green' | 'yellow' | 'red'> = {};
	export let refresh: () => Promise<void>;

	type Color = 'green' | 'yellow' | 'red';
	const columns: { color: Color; title: string }[] = [
		{ color: 'green', title: 'Green' },
		{ color: 'yellow', title: 'Yellow' },
		{ color: 'red', title: 'Red' }
	];

	let dragId: string | null = null;
	let dragOver: Color | null = null;
	let saving = false;

	$: byColor = (color: Color) =>
		dogs
			.filter((d) => dogStripeColor(d, sheetColors) === color)
			.sort((a, b) => a.name.localeCompare(b.name));

	function onDragStart(event: DragEvent, dog: Dog) {
		dragId = dog.id;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', dog.id);
		}
	}

	function onDragEnd() {
		dragId = null;
		dragOver = null;
	}

	async function dropOn(color: Color) {
		const id = dragId;
		dragOver = null;
		dragId = null;
		if (!id || saving) return;
		const dog = dogs.find((d) => d.id === id);
		if (!dog) return;
		if (dogStripeColor(dog, sheetColors) === color) return;

		saving = true;
		try {
			await setDogManualTripColor(id, color);
			toast.success(`${dog.name} set to ${color}.`);
			await refresh();
		} catch {
			toast.error('Could not set color.');
		} finally {
			saving = false;
		}
	}

	async function clearOverride(dog: Dog) {
		if (saving) return;
		saving = true;
		try {
			await setDogManualTripColor(dog.id, null);
			toast.success(`${dog.name} override cleared.`);
			await refresh();
		} catch {
			toast.error('Could not clear override.');
		} finally {
			saving = false;
		}
	}
</script>

<p class="ct-hint">Drag a dog between columns to set its color. The override beats the imported sheet color. Tap ✕ to clear it.</p>

<div class="ct-board">
	{#each columns as col}
		{@const dogsInCol = byColor(col.color)}
		<div
			class="ct-col ct-col-{col.color}"
			class:ct-col-over={dragOver === col.color}
			role="list"
			on:dragover|preventDefault={() => (dragOver = col.color)}
			on:dragleave={() => { if (dragOver === col.color) dragOver = null; }}
			on:drop|preventDefault={() => dropOn(col.color)}
		>
			<div class="ct-col-head">
				<span class="ct-dot ct-dot-{col.color}"></span>
				<span class="ct-col-title">{col.title}</span>
				<span class="ct-col-count">{dogsInCol.length}</span>
			</div>

			{#if dogsInCol.length === 0}
				<p class="ct-empty">Drop dogs here</p>
			{:else}
				{#each dogsInCol as dog (dog.id)}
					<div
						class="ct-card ct-card-{col.color}"
						class:ct-card-dragging={dragId === dog.id}
						role="listitem"
						draggable="true"
						on:dragstart={(e) => onDragStart(e, dog)}
						on:dragend={onDragEnd}
					>
						<span class="ct-grip" aria-hidden="true">⠿</span>
						<span class="ct-name">{dog.name}</span>
						{#if dog.manualTripColor}
							<span class="ct-badge">manual</span>
							<button class="ct-clear" title="Clear override" on:click={() => clearOverride(dog)}>✕</button>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/each}
</div>

<style>
	.ct-hint {
		font-size: 0.78rem;
		color: #5f6368;
		padding: 0.75rem 1rem 0;
		margin: 0;
	}

	.ct-board {
		display: grid;
		gap: 0.75rem;
		padding: 0.75rem 1rem 1rem;
	}

	.ct-col {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-height: 4rem;
		padding: 0.5rem;
		border: 2px dashed #dadce0;
		border-radius: 8px;
		background: #fafafa;
		transition: background 0.12s, border-color 0.12s;
	}

	.ct-col-green { border-color: #a8d5a2; }
	.ct-col-yellow { border-color: #f0d28a; }
	.ct-col-red { border-color: #e6a9a9; }
	.ct-col-over { background: #eef3ff; border-style: solid; }

	.ct-col-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.1rem 0.2rem 0.3rem;
	}

	.ct-dot { width: 0.7rem; height: 0.7rem; border-radius: 999px; }
	.ct-dot-green { background: #3aaf2a; }
	.ct-dot-yellow { background: #f29900; }
	.ct-dot-red { background: #cf4b4b; }

	.ct-col-title {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #3c4043;
	}

	.ct-col-count {
		margin-left: auto;
		font-size: 0.68rem;
		font-weight: 700;
		color: #9aa0a6;
	}

	.ct-empty {
		font-size: 0.74rem;
		color: #9aa0a6;
		text-align: center;
		padding: 0.6rem 0;
		margin: 0;
	}

	.ct-card {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.55rem;
		background: #fff;
		border: 1px solid #dadce0;
		border-left-width: 4px;
		border-radius: 6px;
		box-shadow: 0 1px 2px rgba(60, 64, 67, 0.06);
		cursor: grab;
		touch-action: none;
	}

	.ct-card-green { border-left-color: #3aaf2a; }
	.ct-card-yellow { border-left-color: #f29900; }
	.ct-card-red { border-left-color: #cf4b4b; }
	.ct-card-dragging { opacity: 0.45; }

	.ct-grip { color: #bdc1c6; font-size: 0.9rem; line-height: 1; cursor: grab; }

	.ct-name {
		font-size: 0.84rem;
		font-weight: 600;
		color: #202124;
	}

	.ct-badge {
		margin-left: auto;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #5f6368;
		background: #f1f3f4;
		padding: 0.08rem 0.35rem;
		border-radius: 999px;
	}

	.ct-clear {
		border: none;
		background: transparent;
		color: #9aa0a6;
		font-size: 0.85rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
	}

	.ct-clear:hover { color: #cf4b4b; }

	@media (min-width: 640px) {
		.ct-board {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			align-items: start;
		}
	}
</style>
