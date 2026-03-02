<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { page } from '$app/stores';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { resolveRole, canEditDogs } from '$lib/utils/permissions';
	import {
		getDog,
		updateDog,
		archiveDog,
		deleteDog,
		addBehavioralNote,
		listBehavioralNotes,
		listFeedingLogs,
		listStoolLogs,
		logBath,
		listDayTripLogs,
		startDayTrip,
		endDayTrip
	} from '$lib/data/dogs';
	import type { BehavioralNote, DayTripLog, Dog, FeedingLog, StoolLog, UserRole } from '$lib/types';
	import {
		formatAge,
		bathEligible,
		daysSince,
		formatDate,
		formatDateTime,
		isSurgeryToday,
		toDate,
		checkDayTripEligibility
	} from '$lib/utils/dates';
	import DogForm from '$lib/components/dogs/DogForm.svelte';
	import { energyLabel, compatibilityLabel, pottyLabel, sexLabel, dayTripLabel } from '$lib/utils/labels';

	let dog: Dog | null = null;
	let loading = true;
	let editMode = false;
	let formValid = true;
	let saving = false;
	let notes: BehavioralNote[] = [];
	let feedingLogs: FeedingLog[] = [];
	let stoolLogs: StoolLog[] = [];
	let dayTripLogs: DayTripLog[] = [];
	let newNote = '';
	let fromDate = '';
	let toDateFilter = '';
	let stoolFromDate = '';
	let stoolToDateFilter = '';

	const today = new Date();

	$: dogId = $page.params.id;
	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canEdit = canEditDogs(role);
	$: bathIsEligible = dog ? bathEligible(dog.surgeryDate, today) : true;
	$: feedToday = dog ? !isSurgeryToday(dog.surgeryDate, today) : true;
	$: dayTripEligibility = dog
		? checkDayTripEligibility(dog.intakeDate, dog.isVaccinated, dog.isFixed, dog.dayTripStatus, dog.isolationStatus, dog.dayTripNotes, today)
		: { eligible: false, status: 'ineligible' as const, reasons: [] };
	$: daysSinceLastTrip = dog?.lastDayTripDate ? daysSince(dog.lastDayTripDate, today) : null;
	$: currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
	$: nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
	$: thisMonthTrips = dayTripLogs.filter((log) => {
		const startedAt = toDate(log.startedAt);
		return startedAt ? startedAt >= currentMonthStart && startedAt < nextMonthStart : false;
	}).length;
	$: thisMonthHours = dayTripLogs
		.filter((log) => {
			const startedAt = toDate(log.startedAt);
			return startedAt ? startedAt >= currentMonthStart && startedAt < nextMonthStart : false;
		})
		.reduce((sum, log) => sum + dayTripHours(log), 0);
	$: activeTrip = dayTripLogs.find((log) => !log.endedAt) ?? null;
	$: adoptionNotice = dog
		? dog.status === 'adopted'
			? 'No longer available for adoption'
			: dog.isolationStatus !== 'none'
				? 'Temporarily unavailable for adoption'
				: 'Available for adoption'
		: 'Unavailable';
	$: adoptionToneClass = adoptionNotice === 'Available for adoption' ? 'whiteboard-alert-ok' : 'whiteboard-alert-warn';
	$: whiteboardStatusTagClass = dog
		? dog.dayTripStatus === 'ineligible'
			? 'whiteboard-tag-red'
			: dog.dayTripStatus === 'difficult'
				? 'whiteboard-tag-yellow'
				: 'whiteboard-tag-green'
		: 'whiteboard-tag-green';
	$: whiteboardNote = dog
		? dog.isOutOnDayTrip
			? 'Day Trip'
			: dog.isolationStatus !== 'none'
				? 'Isolation'
				: dog.dayTripStatus === 'ineligible'
					? 'Staff Only'
					: dog.dayTripStatus === 'difficult'
						? 'Adults only'
						: ''
		: '';
	$: whiteboardNoteToneClass =
		whiteboardNote === 'Staff Only' || whiteboardNote === 'Isolation'
			? 'whiteboard-note-red'
			: whiteboardNote === 'Adults only'
				? 'whiteboard-note-yellow'
				: whiteboardNote === 'Day Trip'
					? 'whiteboard-note-blue'
					: '';

	onMount(async () => {
		await loadAll();
	});

	async function loadAll() {
		loading = true;
		dog = await getDog(dogId);
		if (dog) {
			[notes, feedingLogs, stoolLogs, dayTripLogs] = await Promise.all([
				listBehavioralNotes(dogId),
				listFeedingLogs(dogId),
				listStoolLogs(dogId),
				listDayTripLogs(dogId)
			]);
		} else {
			notes = [];
			feedingLogs = [];
			stoolLogs = [];
			dayTripLogs = [];
		}
		loading = false;
	}

	function updateDraft(event: CustomEvent<{ value: Dog; valid: boolean }>) {
		if (!dog) return;
		dog = { ...event.detail.value };
		formValid = event.detail.valid;
	}

	async function saveDog() {
		if (!dog) return;
		if (!formValid) {
			toast.error('Fix the surgery date before saving.');
			return;
		}
		saving = true;
		try {
			await updateDog(dog.id, dog);
			toast.success('Dog updated.');
			editMode = false;
			await loadAll();
		} catch (error) {
			console.error(error);
			toast.error('Unable to update dog.');
		} finally {
			saving = false;
		}
	}

	async function handleNote() {
		if (!dog || !newNote.trim()) return;
		try {
			await addBehavioralNote(dog.id, newNote.trim(), $authProfile);
			newNote = '';
			await loadAll();
			toast.success('Note added.');
		} catch (error) {
			console.error(error);
			toast.error('Unable to add note.');
		}
	}

	async function handleArchive() {
		if (!dog) return;
		if (!confirm('Archive this dog?')) return;
		await archiveDog(dog.id);
		toast.success('Dog archived.');
		await loadAll();
	}

	async function handleDelete() {
		if (!dog) return;
		if (!confirm('Permanently delete this dog?')) return;
		await deleteDog(dog.id);
		toast.success('Dog deleted.');
		window.location.href = '/dogs';
	}

	async function handleLogBath() {
		if (!dog) return;
		if (!bathIsEligible) {
			toast.error('Baths are blocked for 10 days after surgery.');
			return;
		}
		await logBath(dog.id, $authProfile);
		toast.success('Bath logged.');
		await loadAll();
	}

	async function handleTripToggle() {
		if (!dog) return;
		if (dog.isOutOnDayTrip) {
			await endDayTrip(dog.id, $authProfile);
			toast.success('Dog marked as returned.');
		} else {
			if (!dayTripEligibility.eligible) {
				toast.error(dayTripEligibility.reasons[0] ?? 'Dog is not eligible for day trips.');
				return;
			}
			await startDayTrip(dog.id, $authProfile);
			toast.success('Dog marked as out on day trip.');
		}
		await loadAll();
	}

	function dayTripHours(log: DayTripLog) {
		const startedAt = toDate(log.startedAt);
		const endedAt = toDate(log.endedAt) ?? new Date();
		if (!startedAt) return 0;
		return Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 3_600_000);
	}

	function withinRange(value: Date, start?: string, end?: string) {
		const startDate = start ? new Date(start) : null;
		const endDate = end ? new Date(end) : null;
		if (endDate) {
			endDate.setHours(23, 59, 59, 999);
		}
		if (startDate && value < startDate) return false;
		if (endDate && value > endDate) return false;
		return true;
	}

	function shelterTimeLabel(entryDate: Dog['intakeDate']) {
		const days = daysSince(entryDate, today);
		if (days === null) return 'Unknown';
		if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
		const weeks = Math.floor(days / 7);
		return `${weeks} week${weeks === 1 ? '' : 's'} (${days} days)`;
	}

	$: filteredFeeding = feedingLogs.filter((log) => {
		const date = toDate(log.date) ?? new Date();
		return withinRange(date, fromDate, toDateFilter);
	});

	$: filteredStool = stoolLogs.filter((log) => {
		const date = toDate(log.timestamp) ?? new Date();
		return withinRange(date, stoolFromDate, stoolToDateFilter);
	});

	function stoolColor(type: number) {
		if (type >= 3 && type <= 4) return 'bg-emerald-100 text-emerald-700';
		if (type === 1 || type === 2 || type === 5) return 'bg-yellow-100 text-yellow-700';
		return 'bg-rose-100 text-rose-700';
	}

	function stoolLabel(type: number) {
		const labels = {
			1: 'Separate hard lumps',
			2: 'Lumpy sausage',
			3: 'Cracked sausage',
			4: 'Smooth sausage',
			5: 'Soft blobs',
			6: 'Mushy pieces',
			7: 'Watery liquid'
		};
		return labels[type as keyof typeof labels] ?? 'Unknown';
	}

	function reentryDatesLabel(reentryDates: Dog['reentryDates']) {
		if (!Array.isArray(reentryDates) || reentryDates.length === 0) return 'None';
		const normalized = reentryDates
			.map((date) => toDate(date))
			.filter((date): date is Date => Boolean(date))
			.sort((a, b) => a.getTime() - b.getTime());
		if (normalized.length === 0) return 'None';
		return normalized.map((date) => formatDate(date)).join(', ');
	}
</script>

{#if loading}
	<p class="dog-detail-status whiteboard-hand">Loading dog record...</p>
{:else if !dog}
	<p class="dog-detail-status whiteboard-hand">Dog not found.</p>
{:else}
	<section class="dog-detail-board">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<span class="label-maker label-maker-blue">Dog Detail</span>
				<h2 class="dog-detail-title">{dog.name}</h2>
			</div>
			{#if canEdit}
				<div class="flex gap-2">
					<button
						class="rounded-full border border-ink-200 px-4 py-2 text-xs"
						on:click={() => (editMode = !editMode)}
					>
						{editMode ? 'Cancel Edit' : 'Edit Dog'}
					</button>
					<button
						class="rounded-full bg-brand-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
						on:click={saveDog}
						disabled={!editMode || saving}
					>
						{saving ? 'Saving…' : 'Save Changes'}
					</button>
				</div>
			{/if}
		</div>

		{#if !editMode}
			<div class="kennel-scene">
				<article class="kennel-sheet">
				<div class="kennel-clip" aria-hidden="true"></div>
				<div class="kennel-sheet-inner">
					<ul class="kennel-rules typewriter">
						<li>Please do not open kennel doors or reach into kennels.</li>
						<li>Dogs do not display their full personality in kennels.</li>
						<li>Ask a staff member for assistance meeting adoptable dogs.</li>
					</ul>

					<div class="kennel-sheet-main">
						<div class="kennel-photo">
							<div class="kennel-photo-frame">
								<span>{dog.name.slice(0, 1).toUpperCase() || '?'}</span>
							</div>
							<p class="kennel-photo-label typewriter">Photo pending upload</p>
						</div>

						<div class="kennel-facts typewriter">
							<p class="kennel-facts-title">{dog.name} - {dog.id}</p>
								<p><span>Original Entry:</span> {formatDate(dog.originalIntakeDate)}</p>
								<p><span>Current Entry:</span> {formatDate(dog.intakeDate)}</p>
								<p><span>Time at Shelter:</span> {shelterTimeLabel(dog.intakeDate)}</p>
								<p><span>Re-entries:</span> {dog.reentryDates.length}</p>
							<p><span>Came From:</span> {dog.origin || 'Unknown'}</p>
							<p><span>Breed:</span> {dog.breed || 'Unknown'}</p>
							<p><span>Estimated Birthday:</span> {formatDate(dog.dateOfBirth)}</p>
							<p><span>Age:</span> {formatAge(dog.dateOfBirth, today)}</p>
							<p><span>Color:</span> Unknown</p>
							<p><span>Sex:</span> {sexLabel(dog.sex)}</p>
							<p><span>Weight:</span> {dog.weightLbs ? `${dog.weightLbs} lbs` : 'Unknown'}</p>
							<p><span>Energy:</span> {energyLabel(dog.energyLevel)}</p>
							<p><span>Kennel:</span> {dog.outdoorKennelAssignment || 'Unassigned'}</p>
							<p><span>Status:</span> {dog.status === 'active' ? 'Active' : 'Adopted'}</p>
							<p><span>Food:</span> {dog.foodType} ({dog.foodAmount || 'TBD'})</p>
							<p><span>Microchipped:</span> {dog.isMicrochipped ? 'Yes' : 'No'}</p>
						</div>
					</div>

					<div class="kennel-sheet-description typewriter">
						<p class="kennel-sheet-description-title">Description</p>
						<p>{dog.dietaryNotes || dog.dayTripNotes || 'No additional profile notes logged yet.'}</p>
						<p>Good with Dogs: {compatibilityLabel(dog.goodWithDogs)}</p>
						<p>Good with Cats: {compatibilityLabel(dog.goodWithCats)}</p>
						<p>Good with Kids: {compatibilityLabel(dog.goodWithKids)}</p>
						<p>Housetrained: {pottyLabel(dog.pottyTrained)}</p>
						<p>Best Home Fit: {dog.idealHome || 'Not yet documented'}</p>
					</div>

					<p class="kennel-sheet-footer typewriter">
						All shelter pets are fixed, microchipped, and up-to-date on vaccinations before adoption.
					</p>
				</div>
				</article>

				<aside class="kennel-whiteboard">
				<div class={`whiteboard-status-tag ${whiteboardStatusTagClass}`} aria-hidden="true"></div>
				<p class={`whiteboard-alert typewriter ${adoptionToneClass}`}>{adoptionNotice}</p>
				{#if whiteboardNote}
					<p class={`whiteboard-note ${whiteboardNoteToneClass}`}>{whiteboardNote}</p>
				{/if}

				<dl class="whiteboard-facts typewriter">
					<div>
						<dt>Isolation</dt>
						<dd>{dog.isolationStatus === 'none' ? 'None' : dog.isolationStatus === 'sick' ? 'Sick' : 'Bite Quarantine'}</dd>
					</div>
					<div>
						<dt>Vaccinated</dt>
						<dd>{dog.isVaccinated ? `Yes (${formatDate(dog.vaccinatedDate)})` : 'No'}</dd>
					</div>
					<div>
						<dt>Microchipped</dt>
						<dd>{dog.isMicrochipped ? 'Yes' : 'No'}</dd>
					</div>
					<div>
						<dt>Spayed/Neutered</dt>
						<dd>{dog.isFixed ? `Yes (${formatDate(dog.fixedDate)})` : 'No'}</dd>
					</div>
					<div>
						<dt>Last Bath</dt>
						<dd>
							{formatDate(dog.lastBathDate)}
							{#if dog.lastBathBy}
								by {dog.lastBathBy}
							{/if}
						</dd>
					</div>
					<div>
						<dt>Bath Hold</dt>
						<dd>{bathIsEligible ? 'Clear' : `${daysSince(dog.surgeryDate, today) ?? 0} days post-surgery`}</dd>
					</div>
					<div>
						<dt>Day Trips</dt>
						<dd>{thisMonthTrips} trip(s), {thisMonthHours.toFixed(1)} hr</dd>
					</div>
					<div>
						<dt>Current Trip</dt>
						<dd>
							{#if dog.isOutOnDayTrip}
								Out since {formatDateTime(activeTrip?.startedAt ?? dog.currentDayTripStartedAt)}
							{:else}
								In shelter
							{/if}
						</dd>
					</div>
					<div>
						<dt>Re-entry Dates</dt>
						<dd>{reentryDatesLabel(dog.reentryDates)}</dd>
					</div>
					<div>
						<dt>Feeding Today</dt>
						<dd>{feedToday ? 'Normal feeding' : 'Surgery today - do not feed'}</dd>
					</div>
					<div>
						<dt>Potty Trained</dt>
						<dd>{pottyLabel(dog.pottyTrained)}</dd>
					</div>
					<div>
						<dt>Good with Dogs</dt>
						<dd>{compatibilityLabel(dog.goodWithDogs)}</dd>
					</div>
					<div>
						<dt>Good with Cats/Kids</dt>
						<dd>{compatibilityLabel(dog.goodWithCats)} / {compatibilityLabel(dog.goodWithKids)}</dd>
					</div>
				</dl>

				<div class="whiteboard-trip typewriter">
					<p>Day trip status: {dayTripLabel(dayTripEligibility.status)}</p>
					{#if dayTripEligibility.eligible}
						<p class="whiteboard-ok">Eligible for day trips.</p>
					{:else}
						<ul>
							{#each dayTripEligibility.reasons as reason}
								<li>{reason}</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div class="whiteboard-actions">
					<button
						class="w-full rounded-full border border-ink-200 px-4 py-2 text-xs"
						on:click={handleLogBath}
						disabled={!bathIsEligible}
					>
						Log Bath
					</button>
					<button
						class="w-full rounded-full border border-ink-200 px-4 py-2 text-xs"
						on:click={handleTripToggle}
						disabled={!dog.isOutOnDayTrip && !dayTripEligibility.eligible}
					>
						{dog.isOutOnDayTrip ? 'Mark Returned' : 'Send Out on Day Trip'}
					</button>
				</div>
				</aside>
			</div>
		{/if}

		{#if editMode}
			<div class="kennel-edit-sheet rounded-3xl bg-white p-6 shadow-card">
				<h3 class="text-sm font-semibold uppercase tracking-[0.2em] text-ink-500">Update Kennel Sheet</h3>
				<div class="mt-4">
					<DogForm bind:value={dog} on:change={updateDraft} disabled={!canEdit} />
				</div>
			</div>
		{/if}

		<div class="grid gap-4 lg:grid-cols-2">
			<div class="rounded-3xl bg-white p-6 shadow-card">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold uppercase tracking-[0.2em] text-ink-500">Behavioral Notes</h3>
					<button class="text-xs font-semibold text-brand-600" on:click={handleNote}>Add Note</button>
				</div>
				<textarea
					class="mt-4 min-h-[100px] w-full rounded-2xl border border-ink-100 px-4 py-3 text-sm"
					placeholder="Log a behavioral note…"
					bind:value={newNote}
				></textarea>
				<div class="mt-4 space-y-3">
					{#if notes.length === 0}
						<p class="text-sm text-ink-500">No notes yet.</p>
					{:else}
						{#each notes as note}
							<div class="rounded-2xl border border-ink-100 px-4 py-3">
								<p class="text-xs text-ink-400">{formatDateTime(note.createdAt)} — {note.loggedByName}</p>
								<p class="text-sm text-ink-900">{note.note}</p>
							</div>
						{/each}
					{/if}
				</div>
			</div>
			<div class="space-y-4">
				<div class="rounded-3xl bg-white p-6 shadow-card">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold uppercase tracking-[0.2em] text-ink-500">Feeding History</h3>
						<div class="flex gap-2 text-xs">
							<input type="date" class="rounded-full border border-ink-100 px-3 py-1" bind:value={fromDate} />
							<input type="date" class="rounded-full border border-ink-100 px-3 py-1" bind:value={toDateFilter} />
						</div>
					</div>
					<div class="mt-4 overflow-x-auto">
						<table class="min-w-full text-left text-xs">
							<thead class="text-[11px] uppercase tracking-[0.2em] text-ink-400">
								<tr>
									<th class="py-2">Date</th>
									<th class="py-2">Meal</th>
									<th class="py-2">Amount</th>
									<th class="py-2">Notes</th>
									<th class="py-2">Logged By</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-ink-100">
								{#if filteredFeeding.length === 0}
									<tr><td colspan="5" class="py-3 text-xs text-ink-500">No feeding logs.</td></tr>
								{:else}
									{#each filteredFeeding as log}
										<tr>
											<td class="py-2">{formatDate(log.date)}</td>
											<td class="py-2 uppercase">{log.mealTime}</td>
											<td class="py-2">{log.amountEaten}</td>
											<td class="py-2">{log.notes || '—'}</td>
											<td class="py-2">{log.loggedByName}</td>
										</tr>
									{/each}
								{/if}
							</tbody>
						</table>
					</div>
				</div>
				<div class="rounded-3xl bg-white p-6 shadow-card">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold uppercase tracking-[0.2em] text-ink-500">Stool Logs</h3>
						<div class="flex gap-2 text-xs">
							<input type="date" class="rounded-full border border-ink-100 px-3 py-1" bind:value={stoolFromDate} />
							<input type="date" class="rounded-full border border-ink-100 px-3 py-1" bind:value={stoolToDateFilter} />
						</div>
					</div>
					<div class="mt-4 overflow-x-auto">
						<table class="min-w-full text-left text-xs">
							<thead class="text-[11px] uppercase tracking-[0.2em] text-ink-400">
								<tr>
									<th class="py-2">Time</th>
									<th class="py-2">Type</th>
									<th class="py-2">Notes</th>
									<th class="py-2">Logged By</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-ink-100">
								{#if filteredStool.length === 0}
									<tr><td colspan="4" class="py-3 text-xs text-ink-500">No stool logs.</td></tr>
								{:else}
									{#each filteredStool as log}
										<tr>
											<td class="py-2">{formatDateTime(log.timestamp)}</td>
											<td class="py-2">
												<span class={`inline-flex rounded-full px-2 py-1 ${stoolColor(log.stoolType)}`}>Type {log.stoolType} — {stoolLabel(log.stoolType)}</span>
											</td>
											<td class="py-2">{log.notes || '—'}</td>
											<td class="py-2">{log.loggedByName}</td>
										</tr>
									{/each}
								{/if}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>

		{#if canEdit}
			<div class="flex flex-wrap gap-3">
				<button class="rounded-full border border-ink-200 px-4 py-2 text-xs" on:click={handleArchive}>
					Archive Dog
				</button>
				<button class="rounded-full border border-rose-200 px-4 py-2 text-xs text-rose-600" on:click={handleDelete}>
					Delete Dog
				</button>
			</div>
		{/if}
	</section>
{/if}

<style>
	.dog-detail-status {
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	.dog-detail-board {
		display: grid;
		gap: 0.88rem;
	}

	.dog-detail-title {
		margin-top: 0.42rem;
		font-size: 1.5rem;
		line-height: 1.08;
		color: var(--marker-black);
	}

	.dog-detail-board :global(.rounded-3xl) {
		border: 1.5px solid #c4ccd7;
		border-radius: 0.35rem;
		background: var(--paper);
		box-shadow:
			0 2px 5px rgba(0, 0, 0, 0.05),
			0 8px 14px rgba(0, 0, 0, 0.08);
	}

	.dog-detail-board :global(.rounded-2xl) {
		border-radius: 0.25rem;
		border: 1.5px solid #c7cfda;
		background: #ffffff;
	}

	.dog-detail-board :global(.shadow-card) {
		box-shadow: none;
	}

	.dog-detail-board :global(button) {
		min-height: 2.75rem;
	}

	.dog-detail-board :global(button.rounded-full) {
		min-height: 2.75rem;
		border-radius: 0.23rem;
		border: 1.5px solid var(--marker-black);
		font-family: var(--font-typewriter);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--marker-black);
		background: rgba(255, 255, 255, 0.9);
		padding: 0.26rem 0.66rem;
	}

	.dog-detail-board :global(button.rounded-full.bg-brand-600) {
		background: var(--sticky-blue);
		color: #103b60;
	}

	.dog-detail-board :global(button.rounded-full:disabled) {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.dog-detail-board :global(input:not([type='checkbox']):not([type='radio'])),
	.dog-detail-board :global(textarea),
	.dog-detail-board :global(select) {
		border: 1.5px solid #bcc6d2;
		border-radius: 0.22rem;
		background: #ffffff;
		color: var(--marker-black);
		font-size: 1rem;
		min-height: 2.75rem;
	}

	.kennel-scene {
		position: relative;
		display: grid;
		gap: 0.88rem;
		padding: 0.8rem;
		border: 1.5px solid #b9c1cc;
		border-radius: 0.42rem;
		overflow: hidden;
		background: #d5dae1;
	}

	.kennel-scene::before {
		content: '';
		position: absolute;
		inset: 0;
		background:
			repeating-linear-gradient(
				90deg,
				rgba(240, 244, 248, 0.88) 0,
				rgba(240, 244, 248, 0.88) 3px,
				rgba(176, 185, 197, 0.24) 3px,
				rgba(176, 185, 197, 0.24) 42px
			),
			repeating-linear-gradient(
				0deg,
				transparent 0,
				transparent 74px,
				rgba(150, 159, 171, 0.2) 74px,
				rgba(150, 159, 171, 0.2) 78px
			);
	}

	.kennel-scene::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.34) 0%, rgba(114, 123, 136, 0.14) 100%);
		pointer-events: none;
	}

	.kennel-sheet,
	.kennel-whiteboard {
		position: relative;
		z-index: 1;
	}

	.kennel-sheet {
		background: #fffefa;
		border: 1.5px solid #ccd3df;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.12),
			0 10px 18px rgba(0, 0, 0, 0.14);
		padding: 0.88rem 0.8rem 0.74rem;
	}

	.kennel-clip {
		position: absolute;
		top: -0.52rem;
		left: 50%;
		transform: translateX(-50%);
		width: 6.2rem;
		height: 0.62rem;
		border-radius: 0.16rem;
		border: 1px solid #7d8898;
		background: linear-gradient(180deg, #545f6f 0%, #8e99a8 100%);
	}

	.kennel-sheet-inner {
		display: grid;
		gap: 0.68rem;
	}

	.kennel-rules {
		margin: 0;
		padding-left: 1rem;
		font-size: 0.62rem;
		line-height: 1.28;
		color: #4b5d76;
	}

	.kennel-rules li {
		margin-bottom: 0.16rem;
	}

	.kennel-sheet-main {
		display: grid;
		gap: 0.68rem;
		align-items: start;
	}

	.kennel-photo {
		display: grid;
		gap: 0.32rem;
		justify-items: center;
	}

	.kennel-photo-frame {
		width: 7.6rem;
		aspect-ratio: 3 / 4;
		border: 1.5px solid #c5ccda;
		background:
			linear-gradient(180deg, #f5f7fa 0%, #dde4ee 100%),
			repeating-linear-gradient(
				45deg,
				rgba(255, 255, 255, 0.25) 0,
				rgba(255, 255, 255, 0.25) 8px,
				rgba(215, 224, 236, 0.12) 8px,
				rgba(215, 224, 236, 0.12) 16px
			);
		color: #7f8997;
		font-family: var(--font-permanent);
		font-size: 2.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.kennel-photo-label {
		margin: 0;
		font-size: 0.58rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #6d7f97;
	}

	.kennel-facts {
		font-size: 0.68rem;
		line-height: 1.36;
		color: #26344a;
	}

	.kennel-facts-title {
		margin: 0 0 0.18rem;
		font-family: var(--font-printed);
		font-size: 0.76rem;
		color: #1c2b43;
	}

	.kennel-facts p {
		margin: 0.08rem 0;
	}

	.kennel-facts span {
		display: inline-block;
		min-width: 8.2rem;
		color: #53637b;
	}

	.kennel-sheet-description {
		border-top: 1px dashed #bfcbda;
		padding-top: 0.46rem;
		font-size: 0.66rem;
		color: #2f3d52;
	}

	.kennel-sheet-description p {
		margin: 0.08rem 0;
	}

	.kennel-sheet-description-title {
		margin: 0 0 0.2rem;
		font-size: 0.75rem;
		font-family: var(--font-printed);
		color: #1c2b43;
	}

	.kennel-sheet-footer {
		margin: 0;
		border-top: 1px dashed #bfcbda;
		padding-top: 0.44rem;
		font-size: 0.57rem;
		text-align: center;
		color: #60708a;
	}

	.kennel-whiteboard {
		display: grid;
		gap: 0.58rem;
		align-content: start;
		background: linear-gradient(180deg, #fcfdff 0%, #f0f4f9 100%);
		border: 1.5px solid #b8c0cd;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.11),
			0 10px 18px rgba(0, 0, 0, 0.12);
		padding: 0.86rem 0.74rem 0.78rem;
	}

	.whiteboard-status-tag {
		width: 5.4rem;
		height: 1.02rem;
		border-radius: 0.16rem;
	}

	.whiteboard-tag-green {
		background: linear-gradient(135deg, #3aaf66 0%, #2f9356 100%);
	}

	.whiteboard-tag-yellow {
		background: linear-gradient(135deg, #d2ab45 0%, #b0872f 100%);
	}

	.whiteboard-tag-red {
		background: linear-gradient(135deg, #c93b35 0%, #a82e2a 100%);
	}

	.whiteboard-alert {
		margin: 0;
		padding: 0.44rem;
		border: 1px solid #c3ccdb;
		background: #edf2f8;
		text-align: center;
		font-size: 0.9rem;
		line-height: 1.08;
		font-family: var(--font-printed);
		color: #3f506b;
	}

	.whiteboard-alert-ok {
		background: #e3f4e7;
		border-color: #a8d6b5;
		color: #1f6d47;
	}

	.whiteboard-alert-warn {
		background: #edf2f8;
		border-color: #c3ccdb;
		color: #3f506b;
	}

	.whiteboard-note {
		margin: 0.12rem 0 0.26rem;
		text-align: center;
		font-size: 2rem;
		line-height: 0.96;
		transform: rotate(-3deg);
	}

	.whiteboard-note-red {
		color: #b32525;
	}

	.whiteboard-note-yellow {
		color: #875c12;
	}

	.whiteboard-note-blue {
		color: #1f5fa8;
	}

	.whiteboard-facts {
		margin: 0;
		display: grid;
		gap: 0.28rem;
		font-size: 0.64rem;
		color: #2f3d52;
	}

	.whiteboard-facts div {
		display: grid;
		grid-template-columns: 7.3rem 1fr;
		gap: 0.36rem;
		border-top: 1px dashed #c5ceda;
		padding-top: 0.28rem;
	}

	.whiteboard-facts dt {
		font-size: 0.59rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #61728b;
	}

	.whiteboard-facts dd {
		margin: 0;
	}

	.whiteboard-trip {
		border-top: 1px dashed #c5ceda;
		padding-top: 0.38rem;
		font-size: 0.64rem;
		color: #2f3d52;
	}

	.whiteboard-trip p {
		margin: 0.08rem 0;
	}

	.whiteboard-trip ul {
		margin: 0.18rem 0 0 0.95rem;
		padding: 0;
	}

	.whiteboard-trip li {
		margin-bottom: 0.1rem;
	}

	.whiteboard-ok {
		color: #1f6d47;
	}

	.whiteboard-actions {
		display: grid;
		gap: 0.36rem;
	}

	.kennel-edit-sheet {
		border-style: dashed;
	}

	.dog-detail-board :global(table) {
		min-width: 100%;
		border-collapse: collapse;
	}

	.dog-detail-board :global(table thead) {
		font-size: 0.68rem;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.dog-detail-board :global(table td),
	.dog-detail-board :global(table th) {
		padding-top: 0.52rem;
		padding-bottom: 0.52rem;
		border-top: 1px dashed #c7d0dc;
	}

	.dog-detail-board :global(table thead th) {
		border-top: none;
	}

	@media (min-width: 720px) {
		.kennel-sheet-main {
			grid-template-columns: auto 1fr;
		}
	}

	@media (min-width: 900px) {
		.dog-detail-title {
			font-size: 1.74rem;
		}

		.kennel-scene {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		}

		.kennel-whiteboard {
			width: 100%;
			max-width: 22rem;
			justify-self: end;
		}
	}

	@media (max-width: 640px) {
		.kennel-facts span {
			min-width: 6.8rem;
		}

		.whiteboard-note {
			font-size: 1.66rem;
		}

		.whiteboard-facts div {
			grid-template-columns: 1fr;
			gap: 0.12rem;
		}
	}
</style>
