<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { listDogs, updateDog } from '$lib/data/dogs';
	import type { Dog } from '$lib/types';
	import { formatDate, daysSince, toDate } from '$lib/utils/dates';
	import { differenceInDays, startOfDay } from 'date-fns';
	import toast from 'svelte-french-toast';

	const today = new Date();

	let loading = true;
	let dogs: Dog[] = [];
	let addDogId = '';
	let addDate = today.toISOString().slice(0, 10);
	let addRestDays = '';
	let adding = false;

	$: eligibleToAdd = dogs
		.filter((d) => d.status === 'active' && !d.surgeryDate)
		.sort((a, b) => a.name.localeCompare(b.name));

	async function addToSurgery() {
		if (!addDogId || !addDate) return;
		adding = true;
		try {
			const restDays = addRestDays.trim() ? Number(addRestDays) : null;
			await updateDog(addDogId, {
				surgeryDate: new Date(addDate + 'T12:00:00'),
				surgeryRestDays: Number.isFinite(restDays) && restDays! >= 0 ? restDays : null
			});
			dogs = await listDogs();
			addDogId = '';
			addDate = new Date().toISOString().slice(0, 10);
			addRestDays = '';
			toast.success('Added to surgery list.');
		} catch {
			toast.error('Could not add to surgery list.');
		} finally {
			adding = false;
		}
	}

	onMount(async () => {
		dogs = await listDogs();
		loading = false;
	});

	$: surgeryDogs = dogs
		.filter((d) => d.status === 'active' && d.surgeryDate !== null)
		.map((d) => {
			const surgeryDateObj = toDate(d.surgeryDate)!;
			const daysAgo = differenceInDays(startOfDay(today), startOfDay(surgeryDateObj));
			const restDays = d.surgeryRestDays ?? 0;
			const daysLeft = Math.max(0, restDays - daysAgo);
			const isToday = daysAgo === 0;
			const isResting = daysAgo >= 0 && daysAgo < restDays;
			const isComplete = daysAgo >= restDays;
			return { dog: d, surgeryDateObj, daysAgo, restDays, daysLeft, isToday, isResting, isComplete };
		})
		.sort((a, b) => {
			// Active rest first, sorted by days left descending; then surgery-day; then complete
			if (a.isResting && !b.isResting) return -1;
			if (!a.isResting && b.isResting) return 1;
			if (a.isResting && b.isResting) return b.daysLeft - a.daysLeft;
			if (a.isToday && !b.isToday) return -1;
			if (!a.isToday && b.isToday) return 1;
			return a.daysAgo - b.daysAgo;
		});

	async function clearSurgery(dog: Dog) {
		try {
			await updateDog(dog.id, { lastSurgeryDate: dog.surgeryDate, surgeryDate: null, surgeryRestDays: null });
			dogs = await listDogs();
			toast.success(`${dog.name} cleared from surgery list.`);
		} catch {
			toast.error('Could not clear surgery record.');
		}
	}
</script>

<svelte:head>
	<title>Medical | Cache Humane Society</title>
</svelte:head>

<section class="medical-page">
	<div class="medical-header">
		<div>
			<p class="section-kicker typewriter">Medical</p>
			<h2 class="section-title">Surgery list</h2>
		</div>
		{#if !loading}
			<span class="section-badge">{surgeryDogs.length} dog{surgeryDogs.length !== 1 ? 's' : ''}</span>
		{/if}
	</div>

	{#if !loading}
		<form class="surgery-add-form" on:submit|preventDefault={addToSurgery}>
			<select class="surgery-add-select" bind:value={addDogId} required>
				<option value="" disabled>Select dog…</option>
				{#each eligibleToAdd as dog}
					<option value={dog.id}>{dog.name}</option>
				{/each}
			</select>
			<input class="surgery-add-input" type="date" bind:value={addDate} required />
			<input class="surgery-add-input surgery-add-rest" type="number" min="0" max="60" placeholder="Rest days" bind:value={addRestDays} />
			<button class="surgery-add-btn typewriter" type="submit" disabled={adding || !addDogId}>
				{adding ? '…' : 'Add'}
			</button>
		</form>
	{/if}

	{#if loading}
		<p class="medical-state">Loading…</p>
	{:else if surgeryDogs.length === 0}
		<p class="medical-state">No dogs on the surgery list.</p>
	{:else}
		<div class="surgery-list">
			{#each surgeryDogs as { dog, surgeryDateObj, daysAgo, daysLeft, isToday, isResting, isComplete }}
				<div class="surgery-card {isToday ? 'surgery-card-today' : isResting ? 'surgery-card-rest' : 'surgery-card-done'}">
					<div class="surgery-card-left">
						<button class="surgery-name-link" on:click={() => goto(`/dogs/${dog.id}`)}>
							{dog.name}
						</button>
						{#if dog.outdoorKennelAssignment}
							<span class="surgery-kennel typewriter">Kennel {dog.outdoorKennelAssignment}</span>
						{/if}
					</div>

					<div class="surgery-card-center">
						<span class="surgery-date">Surgery: {formatDate(surgeryDateObj)}</span>
						{#if isToday && (dog.surgeryRestDays ?? 0) === 0}
							<span class="surgery-status surgery-status-today">Surgery today</span>
						{:else if isToday}
							<span class="surgery-status surgery-status-today">Day 0 — {dog.surgeryRestDays} day rest</span>
						{:else if isResting}
							<span class="surgery-status surgery-status-rest">{daysLeft} day{daysLeft !== 1 ? 's' : ''} left</span>
						{:else}
							<span class="surgery-status surgery-status-done">Rest complete ({daysAgo}d ago)</span>
						{/if}
					</div>

					<div class="surgery-card-right">
						<button class="surgery-clear-btn typewriter" on:click={() => clearSurgery(dog)}>
							Clear
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.medical-page {
		padding: 1.2rem 0.2rem;
		max-width: 640px;
	}

	.medical-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.4rem;
	}

	.section-kicker {
		margin: 0;
		font-size: 0.62rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #cf4b4b;
	}

	.section-title {
		margin: 0.18rem 0 0;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 1.5rem;
		color: #133149;
	}

	.section-badge {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 700;
		padding: 0.22rem 0.7rem;
		border-radius: 999px;
		background: rgba(207, 75, 75, 0.1);
		color: #cf4b4b;
		border: 1px solid rgba(207, 75, 75, 0.22);
		white-space: nowrap;
	}

	.surgery-add-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 1.2rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid #d4deeb;
		border-radius: 0.65rem;
		background: #f8fbff;
	}

	.surgery-add-select {
		flex: 1;
		min-width: 9rem;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.36rem;
		padding: 0.3rem 0.5rem;
		background: #fff;
		color: #133149;
	}

	.surgery-add-input {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.36rem;
		padding: 0.3rem 0.5rem;
		background: #fff;
		color: #133149;
	}

	.surgery-add-rest {
		width: 6rem;
	}

	.surgery-add-btn {
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 0.32rem 0.9rem;
		border: none;
		border-radius: 0.38rem;
		background: #cf4b4b;
		color: #fff;
		cursor: pointer;
		flex-shrink: 0;
	}

	.surgery-add-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.medical-state {
		font-family: var(--font-ui);
		font-size: 0.9rem;
		color: #7a8fa0;
		margin: 2rem 0;
	}

	.surgery-list {
		display: grid;
		gap: 0.6rem;
	}

	.surgery-card {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.75rem 0.9rem;
		border-radius: 0.75rem;
		border: 1.5px solid;
		background: #fff;
	}

	.surgery-card-today {
		border-color: rgba(207, 75, 75, 0.5);
		background: rgba(207, 75, 75, 0.04);
	}

	.surgery-card-rest {
		border-color: rgba(243, 156, 18, 0.4);
		background: rgba(243, 156, 18, 0.04);
	}

	.surgery-card-done {
		border-color: #d1dfec;
		background: #f8fbfe;
		opacity: 0.75;
	}

	.surgery-card-left {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 7rem;
	}

	.surgery-name-link {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.95rem;
		color: #016aa5;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: transparent;
	}

	.surgery-name-link:hover {
		text-decoration-color: currentColor;
	}

	.surgery-kennel {
		font-size: 0.65rem;
		letter-spacing: 0.1em;
		color: #7a8fa0;
	}

	.surgery-card-center {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.surgery-date {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: #526b81;
	}

	.surgery-status {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.surgery-status-today { color: #cf4b4b; }
	.surgery-status-rest  { color: #d97706; }
	.surgery-status-done  { color: #3aaf2a; }

	.surgery-card-right {
		flex-shrink: 0;
	}

	.surgery-clear-btn {
		font-size: 0.65rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 0.28rem 0.62rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.5rem;
		background: #f4f9ff;
		color: #526b81;
		cursor: pointer;
	}

	.surgery-clear-btn:hover {
		background: #e8f2fa;
		color: #133149;
	}
</style>
