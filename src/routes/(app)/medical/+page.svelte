<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { listDogs, updateDog } from '$lib/data/dogs';
	import type { Dog, IsolationReason } from '$lib/types';
	import { formatDate, toDate } from '$lib/utils/dates';
	import { differenceInDays, startOfDay } from 'date-fns';
	import toast from 'svelte-french-toast';

	const today = new Date();

	let loading = true;
	let dogs: Dog[] = [];

	// Surgery form
	let addDogId = '';
	let addDate = today.toISOString().slice(0, 10);
	let addRestDays = '';
	let adding = false;
	let showAddSurgery = false;

	// FortiFlora form
	let ffDogId = '';
	let ffDate = today.toISOString().slice(0, 10);
	let ffDays = '';
	let ffTime: 'am' | 'pm' | 'both' = 'both';
	let addingFf = false;
	let showAddFf = false;

	// Isolation form
	let isoDogId = '';
	let isoReason: 'sick' | 'bite_quarantine' | '' = '';
	let isoDate = today.toISOString().slice(0, 10);
	let isolating = false;
	let showAddIso = false;

	// Treatment form
	let txDogId = '';
	let txName = '';
	let txNotes = '';
	let txStartDate = today.toISOString().slice(0, 10);
	let txEndDate = '';
	let addingTx = false;
	let showAddTx = false;

	const isoReasonOptions: { value: IsolationReason | null; label: string }[] = [
		{ value: null, label: 'ISO' },
		{ value: 'sick', label: 'Sick' },
		{ value: 'bite_quarantine', label: 'Bite' }
	];

	$: eligibleToAdd = dogs
		.filter((d) => d.status === 'active' && !d.surgeryDate)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: eligibleForFf = dogs
		.filter((d) => d.status === 'active' && !d.fortifloraDate)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: eligibleToIsolate = dogs
		.filter((d) => d.status === 'active' && d.isolationStatus === 'none')
		.sort((a, b) => a.name.localeCompare(b.name));

	$: eligibleForTx = dogs
		.filter((d) => d.status === 'active' && !d.treatmentName)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: surgeryDogs = dogs
		.filter((d) => d.status === 'active' && d.surgeryDate !== null)
		.map((d) => {
			const surgeryDateObj = toDate(d.surgeryDate)!;
			const daysAgo = differenceInDays(startOfDay(today), startOfDay(surgeryDateObj));
			const restDays = d.surgeryRestDays ?? 0;
			const daysLeft = Math.max(0, restDays - daysAgo);
			const isToday = daysAgo === 0;
			const isResting = daysAgo >= 0 && daysAgo < restDays;
			return { dog: d, surgeryDateObj, daysAgo, restDays, daysLeft, isToday, isResting };
		})
		.sort((a, b) => {
			if (a.isResting && !b.isResting) return -1;
			if (!a.isResting && b.isResting) return 1;
			if (a.isResting && b.isResting) return b.daysLeft - a.daysLeft;
			if (a.isToday && !b.isToday) return -1;
			if (!a.isToday && b.isToday) return 1;
			return a.daysAgo - b.daysAgo;
		});

	$: fortifloraDogs = dogs
		.filter((d) => d.status === 'active' && d.fortifloraDate !== null)
		.map((d) => {
			const startObj = toDate(d.fortifloraDate)!;
			const daysAgo = differenceInDays(startOfDay(today), startOfDay(startObj));
			const totalDays = d.fortifloraDays ?? 0;
			const daysLeft = Math.max(0, totalDays - daysAgo);
			const isActive = daysAgo >= 0 && daysAgo < totalDays;
			return { dog: d, startObj, daysAgo, totalDays, daysLeft, isActive };
		})
		.sort((a, b) => {
			if (a.isActive && !b.isActive) return -1;
			if (!a.isActive && b.isActive) return 1;
			if (a.isActive && b.isActive) return b.daysLeft - a.daysLeft;
			return a.daysAgo - b.daysAgo;
		});

	$: isolatedDogs = dogs
		.filter((d) => d.status === 'active' && d.isolationStatus !== 'none')
		.map((d) => {
			const until = toDate(d.isolationUntilDate ?? null);
			const daysLeft = until ? differenceInDays(startOfDay(until), startOfDay(today)) : null;
			return { dog: d, daysLeft };
		})
		.sort((a, b) => {
			if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
			if (a.daysLeft !== null) return -1;
			if (b.daysLeft !== null) return 1;
			return a.dog.name.localeCompare(b.dog.name);
		});

	$: treatmentDogs = dogs
		.filter((d) => d.status === 'active' && d.treatmentName)
		.map((d) => {
			const endDate = toDate(d.treatmentEndDate ?? null);
			const daysLeft = endDate ? differenceInDays(startOfDay(endDate), startOfDay(today)) : null;
			return { dog: d, endDate, daysLeft };
		})
		.sort((a, b) => a.dog.name.localeCompare(b.dog.name));

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
			showAddSurgery = false;
			toast.success('Added to surgery list.');
		} catch {
			toast.error('Could not add to surgery list.');
		} finally {
			adding = false;
		}
	}

	async function clearSurgery(dog: Dog) {
		try {
			await updateDog(dog.id, { lastSurgeryDate: dog.surgeryDate, surgeryDate: null, surgeryRestDays: null });
			dogs = await listDogs();
			toast.success(`${dog.name} cleared from surgery list.`);
		} catch {
			toast.error('Could not clear surgery record.');
		}
	}

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
			showAddFf = false;
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

	async function putInIsolation() {
		if (!isoDogId) return;
		isolating = true;
		try {
			await updateDog(isoDogId, {
				isolationStatus: 'iso',
				isolationReason: isoReason || null,
				isolationUntilDate: new Date(isoDate + 'T12:00:00')
			});
			dogs = await listDogs();
			isoDogId = '';
			isoReason = '';
			isoDate = today.toISOString().slice(0, 10);
			showAddIso = false;
			toast.success('Dog added to isolation.');
		} catch {
			toast.error('Could not update isolation status.');
		} finally {
			isolating = false;
		}
	}

	async function clearIsolation(dog: Dog) {
		try {
			await updateDog(dog.id, { isolationStatus: 'none', isolationUntilDate: null });
			dogs = await listDogs();
			toast.success(`${dog.name} cleared from isolation.`);
		} catch {
			toast.error('Could not clear isolation.');
		}
	}

	async function updateIsoDate(dog: Dog, dateStr: string) {
		if (!dateStr) return;
		try {
			await updateDog(dog.id, { isolationUntilDate: new Date(dateStr + 'T12:00:00') });
			dogs = await listDogs();
		} catch {
			toast.error('Could not update isolation date.');
		}
	}

	function isoDateValue(dog: Dog): string {
		const d = toDate(dog.isolationUntilDate ?? null);
		return d ? d.toISOString().slice(0, 10) : '';
	}

	async function addTreatment() {
		if (!txDogId || !txName) return;
		addingTx = true;
		try {
			await updateDog(txDogId, {
				treatmentName: txName.trim(),
				treatmentNotes: txNotes.trim() || null,
				treatmentStartDate: new Date(txStartDate + 'T12:00:00'),
				treatmentEndDate: txEndDate ? new Date(txEndDate + 'T12:00:00') : null
			});
			dogs = await listDogs();
			txDogId = '';
			txName = '';
			txNotes = '';
			txStartDate = today.toISOString().slice(0, 10);
			txEndDate = '';
			showAddTx = false;
			toast.success('Added to treatment list.');
		} catch {
			toast.error('Could not add treatment.');
		} finally {
			addingTx = false;
		}
	}

	async function clearTreatment(dog: Dog) {
		try {
			await updateDog(dog.id, {
				treatmentName: null,
				treatmentNotes: null,
				treatmentStartDate: null,
				treatmentEndDate: null
			});
			dogs = await listDogs();
			toast.success(`${dog.name} cleared from treatment list.`);
		} catch {
			toast.error('Could not clear treatment.');
		}
	}

	async function autoClearExpiredIsolations() {
		const expired = dogs.filter((d) => {
			if (d.status !== 'active' || d.isolationStatus === 'none') return false;
			const until = toDate(d.isolationUntilDate ?? null);
			if (!until) return false;
			return differenceInDays(startOfDay(today), startOfDay(until)) > 0;
		});
		if (expired.length === 0) return;
		await Promise.all(
			expired.map((d) => updateDog(d.id, { isolationStatus: 'none', isolationUntilDate: null }))
		);
		dogs = await listDogs();
		toast.success(`Isolation cleared: ${expired.map((d) => d.name).join(', ')}`);
	}

	async function autoClearExpiredTreatments() {
		const expired = dogs.filter((d) => {
			if (d.status !== 'active' || !d.treatmentName) return false;
			const end = toDate(d.treatmentEndDate ?? null);
			if (!end) return false;
			return differenceInDays(startOfDay(today), startOfDay(end)) > 0;
		});
		if (expired.length === 0) return;
		await Promise.all(
			expired.map((d) =>
				updateDog(d.id, {
					treatmentName: null,
					treatmentNotes: null,
					treatmentStartDate: null,
					treatmentEndDate: null
				})
			)
		);
		dogs = await listDogs();
		toast.success(`Treatment cleared: ${expired.map((d) => d.name).join(', ')}`);
	}

	onMount(async () => {
		dogs = await listDogs();
		await autoClearExpiredIsolations();
		await autoClearExpiredTreatments();
		loading = false;
	});
</script>

<svelte:head>
	<title>Medical | Cache Humane Society</title>
</svelte:head>

<section class="med-dashboard">
	<header class="med-head">
		<p class="med-kicker typewriter">Cache Humane Society</p>
		<h1 class="med-title">Medical</h1>
		{#if !loading}
			<div class="med-chips typewriter">
				<span class="med-chip med-chip-rose">ISO {isolatedDogs.length}</span>
				<span class="med-chip med-chip-amber">Surgery {surgeryDogs.length}</span>
				<span class="med-chip med-chip-sage">FortiFlora {fortifloraDogs.length}</span>
				<span class="med-chip med-chip-lilac">Tx {treatmentDogs.length}</span>
			</div>
		{/if}
	</header>

	{#if loading}
		<p class="med-loading">Loading…</p>
	{:else}
		<div class="med-columns">

			<!-- Isolation (rose) -->
			<section class="med-card med-card-rose">
				<div class="med-card-head">
					<h2>Isolation</h2>
					<div class="med-head-right">
						<span class="med-pill med-pill-rose">{isolatedDogs.length}</span>
						<button
							class="med-add-toggle {showAddIso ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddIso = !showAddIso)}
							aria-label="Add to isolation"
						>+</button>
					</div>
				</div>

				{#if showAddIso}
					<form class="med-form" on:submit|preventDefault={putInIsolation}>
						<select class="med-input med-input-grow" bind:value={isoDogId} required>
							<option value="" disabled>Dog…</option>
							{#each eligibleToIsolate as dog}
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
						<select class="med-input" bind:value={isoReason}>
							<option value="">ISO</option>
							<option value="sick">Sick</option>
							<option value="bite_quarantine">Bite</option>
						</select>
						<input class="med-input" type="date" bind:value={isoDate} required />
						<button class="med-submit typewriter" type="submit" disabled={isolating || !isoDogId}>
							{isolating ? '…' : 'Add'}
						</button>
					</form>
				{/if}

				<div class="med-items">
					{#if isolatedDogs.length === 0}
						<p class="med-empty">No dogs in isolation.</p>
					{:else}
						{#each isolatedDogs as { dog, daysLeft }}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									<div class="med-row-sub">
										<span class="med-label">Until</span>
										<input
											class="med-date-inline"
											type="date"
											value={isoDateValue(dog)}
											on:change={(e) => updateIsoDate(dog, e.currentTarget.value)}
										/>
										{#if daysLeft !== null}
											<span class="med-tag {daysLeft === 0 ? 'med-tag-warn' : 'med-tag-info'}">
												{daysLeft === 0 ? 'Last day' : `${daysLeft}d`}
											</span>
										{/if}
									</div>
									<div class="med-reason-row">
										{#each isoReasonOptions as opt}
											<button
												class="med-reason-btn {(dog.isolationReason ?? null) === opt.value ? 'med-reason-active' : ''}"
												type="button"
												on:click={() =>
													updateDog(dog.id, { isolationReason: opt.value }).then(() =>
														listDogs().then((d) => (dogs = d))
													)}
											>{opt.label}</button>
										{/each}
									</div>
								</div>
								<button class="med-clear typewriter" type="button" on:click={() => clearIsolation(dog)}>Clear</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- Surgery (amber) -->
			<section class="med-card med-card-amber">
				<div class="med-card-head">
					<h2>Surgery</h2>
					<div class="med-head-right">
						<span class="med-pill med-pill-amber">{surgeryDogs.length}</span>
						<button
							class="med-add-toggle {showAddSurgery ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddSurgery = !showAddSurgery)}
							aria-label="Add to surgery list"
						>+</button>
					</div>
				</div>

				{#if showAddSurgery}
					<form class="med-form" on:submit|preventDefault={addToSurgery}>
						<select class="med-input med-input-grow" bind:value={addDogId} required>
							<option value="" disabled>Dog…</option>
							{#each eligibleToAdd as dog}
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
						<input class="med-input" type="date" bind:value={addDate} required />
						<input class="med-input med-input-sm" type="number" min="0" max="60" placeholder="Rest days" bind:value={addRestDays} />
						<button class="med-submit typewriter" type="submit" disabled={adding || !addDogId}>
							{adding ? '…' : 'Add'}
						</button>
					</form>
				{/if}

				<div class="med-items">
					{#if surgeryDogs.length === 0}
						<p class="med-empty">No dogs on the surgery list.</p>
					{:else}
						{#each surgeryDogs as { dog, surgeryDateObj, daysAgo, daysLeft, isToday, isResting }}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									<div class="med-row-sub">
										<span class="med-meta">{formatDate(surgeryDateObj)}</span>
										{#if isToday && (dog.surgeryRestDays ?? 0) === 0}
											<span class="med-tag med-tag-warn">Surgery today</span>
										{:else if isToday}
											<span class="med-tag med-tag-warn">Day 0 · {dog.surgeryRestDays}d rest</span>
										{:else if isResting}
											<span class="med-tag med-tag-info">{daysLeft}d left</span>
										{:else}
											<span class="med-tag med-tag-done">Rest complete</span>
										{/if}
									</div>
								</div>
								<button class="med-clear typewriter" type="button" on:click={() => clearSurgery(dog)}>Clear</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- FortiFlora (sage) -->
			<section class="med-card med-card-sage">
				<div class="med-card-head">
					<h2>FortiFlora</h2>
					<div class="med-head-right">
						<span class="med-pill med-pill-sage">{fortifloraDogs.length}</span>
						<button
							class="med-add-toggle {showAddFf ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddFf = !showAddFf)}
							aria-label="Add to FortiFlora list"
						>+</button>
					</div>
				</div>

				{#if showAddFf}
					<form class="med-form" on:submit|preventDefault={addToFortiflora}>
						<select class="med-input med-input-grow" bind:value={ffDogId} required>
							<option value="" disabled>Dog…</option>
							{#each eligibleForFf as dog}
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
						<input class="med-input" type="date" bind:value={ffDate} required />
						<input class="med-input med-input-sm" type="number" min="1" max="60" placeholder="Days" bind:value={ffDays} />
						<select class="med-input" bind:value={ffTime}>
							<option value="both">AM + PM</option>
							<option value="am">AM only</option>
							<option value="pm">PM only</option>
						</select>
						<button class="med-submit typewriter" type="submit" disabled={addingFf || !ffDogId}>
							{addingFf ? '…' : 'Add'}
						</button>
					</form>
				{/if}

				<div class="med-items">
					{#if fortifloraDogs.length === 0}
						<p class="med-empty">No dogs on FortiFlora.</p>
					{:else}
						{#each fortifloraDogs as { dog, startObj, daysLeft, isActive }}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									<div class="med-row-sub">
										<span class="med-meta">
											Since {formatDate(startObj)}{dog.fortifloraTime && dog.fortifloraTime !== 'both'
												? ` · ${dog.fortifloraTime.toUpperCase()}`
												: ''}
										</span>
										{#if isActive}
											<span class="med-tag med-tag-info">{daysLeft}d left</span>
										{:else}
											<span class="med-tag med-tag-done">Complete</span>
										{/if}
									</div>
								</div>
								<button class="med-clear typewriter" type="button" on:click={() => clearFortiflora(dog)}>Clear</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- Treatment (lilac) -->
			<section class="med-card med-card-lilac">
				<div class="med-card-head">
					<h2>Treatment</h2>
					<div class="med-head-right">
						<span class="med-pill med-pill-lilac">{treatmentDogs.length}</span>
						<button
							class="med-add-toggle {showAddTx ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddTx = !showAddTx)}
							aria-label="Add to treatment list"
						>+</button>
					</div>
				</div>

				{#if showAddTx}
					<form class="med-form med-form-stack" on:submit|preventDefault={addTreatment}>
						<div class="med-form-row">
							<select class="med-input med-input-grow" bind:value={txDogId} required>
								<option value="" disabled>Dog…</option>
								{#each eligibleForTx as dog}
									<option value={dog.id}>{dog.name}</option>
								{/each}
							</select>
							<input
								class="med-input med-input-grow"
								type="text"
								placeholder="Treatment / medication"
								bind:value={txName}
								required
							/>
						</div>
						<div class="med-form-row">
							<input class="med-input" type="date" bind:value={txStartDate} required />
							<input class="med-input" type="date" placeholder="End date (opt.)" bind:value={txEndDate} />
							<button class="med-submit typewriter" type="submit" disabled={addingTx || !txDogId || !txName}>
								{addingTx ? '…' : 'Add'}
							</button>
						</div>
						<input
							class="med-input med-input-full"
							type="text"
							placeholder="Notes (optional)"
							bind:value={txNotes}
						/>
					</form>
				{/if}

				<div class="med-items">
					{#if treatmentDogs.length === 0}
						<p class="med-empty">No dogs on treatment.</p>
					{:else}
						{#each treatmentDogs as { dog, daysLeft }}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									<div class="med-row-sub">
										<span class="med-meta">{dog.treatmentName}</span>
										{#if daysLeft !== null}
											<span class="med-tag {daysLeft <= 0 ? 'med-tag-done' : 'med-tag-info'}">
												{daysLeft > 0 ? `${daysLeft}d left` : 'Last day'}
											</span>
										{/if}
									</div>
									{#if dog.treatmentNotes}
										<p class="med-notes">{dog.treatmentNotes}</p>
									{/if}
								</div>
								<button class="med-clear typewriter" type="button" on:click={() => clearTreatment(dog)}>Clear</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>

		</div>
	{/if}
</section>

<style>
	.med-dashboard {
		padding: 0.66rem 0.66rem 0.84rem;
		border-radius: 1rem;
		background:
			radial-gradient(40rem 20rem at 100% -25%, rgba(57, 142, 193, 0.05) 0%, transparent 62%),
			linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%);
	}

	.med-head {
		margin-bottom: 0.8rem;
		padding: 0 0.1rem;
	}

	.med-kicker {
		margin: 0 0 0.2rem;
		font-size: 0.6rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #cf4b4b;
	}

	.med-title {
		margin: 0 0 0.5rem;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.6rem, 3.5vw, 2.4rem);
		font-weight: 500;
		line-height: 1.04;
		color: #2e3845;
	}

	.med-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.med-chip {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.18rem 0.6rem;
		font-size: 0.58rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 700;
		border: 1.5px solid;
	}

	.med-chip-rose  { background: #fce8ed; color: #a03050; border-color: #e8a0b8; }
	.med-chip-amber { background: #fef0d8; color: #7a5010; border-color: #e8c880; }
	.med-chip-sage  { background: #e4f2e4; color: #2e6c30; border-color: #9ccf9e; }
	.med-chip-lilac { background: #f0ebf8; color: #6030a0; border-color: #c4a8e0; }

	.med-loading {
		font-family: var(--font-ui);
		font-size: 0.9rem;
		color: #7a8fa0;
		padding: 2rem 0;
		margin: 0;
	}

	.med-columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.58rem;
	}

	/* Card */
	.med-card {
		display: flex;
		flex-direction: column;
		gap: 0.42rem;
		padding: 0.58rem 0.5rem 0.52rem;
		border-radius: 0.92rem;
		break-inside: avoid;
	}

	.med-card-rose   { background: linear-gradient(180deg, #f4dde4 0%, #f0d8df 100%); }
	.med-card-amber  { background: linear-gradient(180deg, #faecd4 0%, #f5e6cb 100%); }
	.med-card-sage   { background: linear-gradient(180deg, #ddeedd 0%, #d7e9d7 100%); }
	.med-card-lilac  { background: linear-gradient(180deg, #ece8f3 0%, #e7e3ef 100%); }

	.med-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.48rem;
	}

	.med-card-head h2 {
		margin: 0;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.44rem, 1.95vw, 2.04rem);
		font-weight: 500;
		line-height: 1.02;
		color: #2e3845;
	}

	.med-head-right {
		display: flex;
		align-items: center;
		gap: 0.38rem;
		flex-shrink: 0;
	}

	/* Pills */
	.med-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.2rem;
		height: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 0.58rem;
		font-weight: 700;
		color: #ffffff;
	}

	.med-pill-rose   { background: #dd7182; }
	.med-pill-amber  { background: #b87828; }
	.med-pill-sage   { background: #5a9e68; }
	.med-pill-lilac  { background: #a98dba; }

	/* Add toggle button */
	.med-add-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 999px;
		border: 1.5px solid rgba(96, 109, 123, 0.22);
		background: rgba(255, 255, 255, 0.55);
		font-size: 1rem;
		font-weight: 400;
		line-height: 1;
		color: #526b81;
		cursor: pointer;
		transition: transform 180ms ease, background 140ms ease;
	}

	.med-add-toggle:hover {
		background: rgba(255, 255, 255, 0.8);
	}

	.med-add-toggle-open {
		transform: rotate(45deg);
	}

	/* Add form */
	.med-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		padding: 0.55rem 0.5rem;
		border-radius: 0.58rem;
		background: rgba(255, 255, 255, 0.55);
		border: 1px solid rgba(96, 109, 123, 0.15);
	}

	.med-form-stack {
		flex-direction: column;
		align-items: stretch;
	}

	.med-form-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.med-input {
		font-family: var(--font-ui);
		font-size: 0.8rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.36rem;
		padding: 0.28rem 0.45rem;
		background: #fff;
		color: #133149;
		min-width: 0;
	}

	.med-input-grow { flex: 1; min-width: 8rem; }
	.med-input-sm   { width: 5.5rem; flex-shrink: 0; }
	.med-input-full { width: 100%; box-sizing: border-box; }

	.med-submit {
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 0.28rem 0.82rem;
		border: none;
		border-radius: 0.36rem;
		background: #526b81;
		color: #fff;
		cursor: pointer;
		flex-shrink: 0;
	}

	.med-submit:disabled {
		opacity: 0.45;
		cursor: default;
	}

	/* Items list */
	.med-items {
		display: grid;
		gap: 0.34rem;
	}

	.med-empty {
		margin: 0;
		padding: 0.52rem 0.5rem;
		border: 1px solid rgba(96, 109, 123, 0.15);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.46);
		font-size: 0.84rem;
		font-weight: 600;
		line-height: 1.3;
		color: #5f6976;
	}

	/* Dog row */
	.med-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.44rem 0.5rem;
		border: 1px solid rgba(96, 109, 123, 0.15);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.5);
	}

	.med-row-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.16rem;
	}

	.med-dog-link {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.92rem;
		color: #016aa5;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: transparent;
		line-height: 1.2;
	}

	.med-dog-link:hover {
		text-decoration-color: currentColor;
	}

	.med-kennel {
		font-weight: 500;
		font-size: 0.78rem;
		color: #7a8fa0;
	}

	.med-row-sub {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.med-label {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: #7a8fa0;
		font-weight: 500;
	}

	.med-meta {
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: #526b81;
	}

	.med-date-inline {
		font-family: var(--font-ui);
		font-size: 0.74rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.28rem;
		padding: 0.14rem 0.32rem;
		background: rgba(255, 255, 255, 0.8);
		color: #133149;
	}

	.med-tag {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.1rem 0.42rem;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.med-tag-warn { background: rgba(207, 75, 75, 0.12); color: #a03232; }
	.med-tag-info { background: rgba(1, 106, 165, 0.1); color: #016aa5; }
	.med-tag-done { background: rgba(58, 175, 42, 0.1); color: #3aaf2a; }

	.med-reason-row {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		margin-top: 0.1rem;
	}

	.med-reason-btn {
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 600;
		padding: 0.14rem 0.46rem;
		border: 1px solid rgba(96, 109, 123, 0.22);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.55);
		color: #526b81;
		cursor: pointer;
	}

	.med-reason-active {
		background: rgba(207, 75, 75, 0.1);
		border-color: rgba(207, 75, 75, 0.35);
		color: #a03232;
	}

	.med-notes {
		margin: 0.1rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: #526b81;
		line-height: 1.35;
	}

	.med-clear {
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.24rem 0.55rem;
		border: 1px solid rgba(96, 109, 123, 0.22);
		border-radius: 0.4rem;
		background: rgba(255, 255, 255, 0.55);
		color: #526b81;
		cursor: pointer;
		flex-shrink: 0;
		align-self: flex-start;
		margin-top: 0.18rem;
	}

	.med-clear:hover {
		background: rgba(255, 255, 255, 0.85);
		color: #133149;
	}

	@media (min-width: 760px) {
		.med-columns {
			display: block;
			columns: 2;
			column-gap: 0.58rem;
		}

		.med-card {
			margin-bottom: 0.58rem;
		}
	}
</style>
