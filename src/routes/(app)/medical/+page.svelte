<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { listDogs, updateDog } from '$lib/data/dogs';
	import type { Dog, IsolationReason } from '$lib/types';
	import { formatDate, daysSince, toDate } from '$lib/utils/dates';
	import { differenceInDays, startOfDay } from 'date-fns';
	import toast from 'svelte-french-toast';

	const today = new Date();

	let loading = true;
	let dogs: Dog[] = [];

	// Surgery
	let addDogId = '';
	let addDate = today.toISOString().slice(0, 10);
	let addRestDays = '';
	let adding = false;

	// FortiFlora
	let ffDogId = '';
	let ffDate = today.toISOString().slice(0, 10);
	let ffDays = '';
	let ffTime: 'am' | 'pm' | 'both' = 'both';
	let addingFf = false;

	$: eligibleToAdd = dogs
		.filter((d) => d.status === 'active' && !d.surgeryDate)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: eligibleForFf = dogs
		.filter((d) => d.status === 'active' && !d.fortifloraDate)
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

	$: fortifloraDogs = dogs
		.filter((d) => d.status === 'active' && d.fortifloraDate !== null)
		.map((d) => {
			const startObj = toDate(d.fortifloraDate)!;
			const daysAgo = differenceInDays(startOfDay(today), startOfDay(startObj));
			const totalDays = d.fortifloraDays ?? 0;
			const daysLeft = Math.max(0, totalDays - daysAgo);
			const isActive = daysAgo >= 0 && daysAgo < totalDays;
			const isComplete = daysAgo >= totalDays;
			return { dog: d, startObj, daysAgo, totalDays, daysLeft, isActive, isComplete };
		})
		.sort((a, b) => {
			if (a.isActive && !b.isActive) return -1;
			if (!a.isActive && b.isActive) return 1;
			if (a.isActive && b.isActive) return b.daysLeft - a.daysLeft;
			return a.daysAgo - b.daysAgo;
		});

	async function addToFortiflora() {
		if (!ffDogId || !ffDate) return;
		addingFf = true;
		try {
			const days = ffDays.trim() ? Number(ffDays) : null;
			await updateDog(ffDogId, {
				fortifloraDate: new Date(ffDate + 'T12:00:00'),
				fortifloraDays: Number.isFinite(days) && days! > 0 ? days : null,
				fortifloraTime: ffTime
			});
			dogs = await listDogs();
			ffDogId = '';
			ffDate = today.toISOString().slice(0, 10);
			ffDays = '';
			ffTime = 'both';
			toast.success('Added to FortiFlora list.');
		} catch {
			toast.error('Could not add to FortiFlora list.');
		} finally {
			addingFf = false;
		}
	}

	async function clearFortiflora(dog: Dog) {
		try {
			await updateDog(dog.id, { fortifloraDate: null, fortifloraDays: null, fortifloraTime: null });
			dogs = await listDogs();
			toast.success(`${dog.name} cleared from FortiFlora list.`);
		} catch {
			toast.error('Could not clear FortiFlora record.');
		}
	}

	const isoReasonOptions: { value: IsolationReason | null; label: string }[] = [
		{ value: null, label: 'ISO' },
		{ value: 'sick', label: 'Sick' },
		{ value: 'bite_quarantine', label: 'Bite' }
	];

	// Isolation
	let isoDogId = '';
	let isoReason: 'sick' | 'bite_quarantine' | '' = '';
	let isoDate = today.toISOString().slice(0, 10);
	let isolating = false;

	$: eligibleToIsolate = dogs
		.filter((d) => d.status === 'active' && d.isolationStatus === 'none')
		.sort((a, b) => a.name.localeCompare(b.name));

	$: isolatedDogs = dogs
		.filter((d) => d.status === 'active' && d.isolationStatus !== 'none')
		.sort((a, b) => a.name.localeCompare(b.name));

	async function putInIsolation() {
		if (!isoDogId) return;
		isolating = true;
		try {
			await updateDog(isoDogId, {
				isolationStatus: 'iso',
				isolationReason: isoReason || null,
				isolationStartDate: new Date(isoDate + 'T12:00:00')
			});
			dogs = await listDogs();
			isoDogId = '';
			isoReason = '';
			isoDate = today.toISOString().slice(0, 10);
			toast.success('Dog added to isolation.');
		} catch {
			toast.error('Could not update isolation status.');
		} finally {
			isolating = false;
		}
	}

	async function clearIsolation(dog: Dog) {
		try {
			await updateDog(dog.id, { isolationStatus: 'none', isolationStartDate: null });
			dogs = await listDogs();
			toast.success(`${dog.name} cleared from isolation.`);
		} catch {
			toast.error('Could not clear isolation.');
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

	<div class="medical-header" style="margin-top: 2.2rem;">
		<div>
			<p class="section-kicker typewriter">Medical</p>
			<h2 class="section-title">FortiFlora</h2>
		</div>
		{#if !loading}
			<span class="section-badge">{fortifloraDogs.length} dog{fortifloraDogs.length !== 1 ? 's' : ''}</span>
		{/if}
	</div>

	{#if !loading}
		<form class="surgery-add-form" on:submit|preventDefault={addToFortiflora}>
			<select class="surgery-add-select" bind:value={ffDogId} required>
				<option value="" disabled>Select dog…</option>
				{#each eligibleForFf as dog}
					<option value={dog.id}>{dog.name}</option>
				{/each}
			</select>
			<input class="surgery-add-input" type="date" bind:value={ffDate} required />
			<input class="surgery-add-input surgery-add-rest" type="number" min="1" max="60" placeholder="# days" bind:value={ffDays} />
			<select class="surgery-add-select surgery-add-time" bind:value={ffTime}>
				<option value="both">AM + PM</option>
				<option value="am">AM only</option>
				<option value="pm">PM only</option>
			</select>
			<button class="surgery-add-btn typewriter" type="submit" disabled={addingFf || !ffDogId}>
				{addingFf ? '…' : 'Add'}
			</button>
		</form>
	{/if}

	{#if loading}
		<p class="medical-state">Loading…</p>
	{:else if fortifloraDogs.length === 0}
		<p class="medical-state">No dogs on FortiFlora.</p>
	{:else}
		<div class="surgery-list">
			{#each fortifloraDogs as { dog, startObj, daysAgo, totalDays, daysLeft, isActive, isComplete }}
				<div class="surgery-card {isActive ? 'surgery-card-rest' : 'surgery-card-done'}">
					<div class="surgery-card-left">
						<button class="surgery-name-link" on:click={() => goto(`/dogs/${dog.id}`)}>
							{dog.name}
						</button>
						{#if dog.outdoorKennelAssignment}
							<span class="surgery-kennel typewriter">Kennel {dog.outdoorKennelAssignment}</span>
						{/if}
					</div>

					<div class="surgery-card-center">
						<span class="surgery-date">Started: {formatDate(startObj)}{dog.fortifloraTime && dog.fortifloraTime !== 'both' ? ` · ${dog.fortifloraTime.toUpperCase()}` : ''}</span>
						{#if isActive}
							<span class="surgery-status surgery-status-rest">{daysLeft} day{daysLeft !== 1 ? 's' : ''} left</span>
						{:else}
							<span class="surgery-status surgery-status-done">Course complete ({daysAgo}d ago)</span>
						{/if}
					</div>

					<div class="surgery-card-right">
						<button class="surgery-clear-btn typewriter" on:click={() => clearFortiflora(dog)}>
							Clear
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<div class="medical-header" style="margin-top: 2.2rem;">
		<div>
			<p class="section-kicker typewriter">Medical</p>
			<h2 class="section-title">Isolation</h2>
		</div>
		{#if !loading}
			<span class="section-badge">{isolatedDogs.length} dog{isolatedDogs.length !== 1 ? 's' : ''}</span>
		{/if}
	</div>

	{#if !loading}
		<form class="surgery-add-form" on:submit|preventDefault={putInIsolation}>
			<select class="surgery-add-select" bind:value={isoDogId} required>
				<option value="" disabled>Select dog…</option>
				{#each eligibleToIsolate as dog}
					<option value={dog.id}>{dog.name}</option>
				{/each}
			</select>
			<select class="surgery-add-select surgery-add-time" bind:value={isoReason}>
				<option value="">No reason</option>
				<option value="sick">Sick</option>
				<option value="bite_quarantine">Bite Quarantine</option>
			</select>
			<input class="surgery-add-input" type="date" bind:value={isoDate} required />
			<button class="surgery-add-btn typewriter" type="submit" disabled={isolating || !isoDogId}>
				{isolating ? '…' : 'Add'}
			</button>
		</form>
	{/if}

	{#if loading}
		<p class="medical-state">Loading…</p>
	{:else if isolatedDogs.length === 0}
		<p class="medical-state">No dogs in isolation.</p>
	{:else}
		<div class="surgery-list">
			{#each isolatedDogs as dog}
				<div class="surgery-card surgery-card-today">
					<div class="surgery-card-left">
						<button class="surgery-name-link" on:click={() => goto(`/dogs/${dog.id}`)}>
							{dog.name}
						</button>
						{#if dog.outdoorKennelAssignment}
							<span class="surgery-kennel typewriter">Kennel {dog.outdoorKennelAssignment}</span>
						{/if}
					</div>

					<div class="surgery-card-center">
						{#if dog.isolationStartDate}
							<span class="surgery-date">Since: {formatDate(toDate(dog.isolationStartDate) ?? new Date())}</span>
						{/if}
						<div class="iso-reason-row">
							{#each isoReasonOptions as opt}
								<button
									class="iso-reason-btn {(dog.isolationReason ?? null) === opt.value ? 'iso-reason-active' : ''}"
									on:click={() => updateDog(dog.id, { isolationReason: opt.value }).then(() => listDogs().then(d => dogs = d))}
								>{opt.label}</button>
							{/each}
						</div>
					</div>

					<div class="surgery-card-right">
						<button class="surgery-clear-btn typewriter" on:click={() => clearIsolation(dog)}>
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

	.surgery-add-time {
		flex: 0 0 auto;
		min-width: 7rem;
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

	.iso-reason-row {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}

	.iso-reason-btn {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		padding: 0.18rem 0.55rem;
		border: 1px solid #c4d6e8;
		border-radius: 999px;
		background: #f4f9ff;
		color: #526b81;
		cursor: pointer;
	}

	.iso-reason-active {
		background: rgba(207, 75, 75, 0.1);
		border-color: rgba(207, 75, 75, 0.4);
		color: #cf4b4b;
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
