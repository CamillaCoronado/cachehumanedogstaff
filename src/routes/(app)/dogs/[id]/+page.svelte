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
	import { getAdoptionAvailability } from '$lib/utils/adoption';
	import DogForm from '$lib/components/dogs/DogForm.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { energyLabel, compatibilityLabel, pottyLabel, sexLabel } from '$lib/utils/labels';

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
	let confirmAction: 'archive' | 'delete' | null = null;
	let confirmBusy = false;

	const today = new Date();

	$: dogId = $page.params.id;
	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canEdit = canEditDogs(role);
	$: bathIsEligible = dog ? bathEligible(dog.surgeryDate, today) : true;
	$: feedToday = dog ? !isSurgeryToday(dog.surgeryDate, today) : true;
	$: dayTripEligibility = dog
		? checkDayTripEligibility(
				dog.intakeDate,
				dog.isVaccinated,
				dog.isFixed,
				dog.dayTripStatus,
				dog.isolationStatus,
				dog.dayTripIneligibleReason,
				dog.dayTripManagerOnly,
				dog.dayTripManagerOnlyReason,
				dog.dayTripNotes,
				role,
				today
			)
		: { eligible: false, status: 'ineligible' as const, reasons: [] };
	$: dayTripBadgeClass =
		dayTripEligibility.status === 'eligible'
			? 'whiteboard-trip-pill-green'
			: dayTripEligibility.status === 'difficult'
				? 'whiteboard-trip-pill-yellow'
				: 'whiteboard-trip-pill-red';
	$: dayTripBadgeText =
		dayTripEligibility.status === 'ineligible'
			? 'Ineligible for day trips'
			: dayTripEligibility.status === 'difficult'
				? 'Adults only day trips'
				: 'Eligible for day trips';
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
	$: ineligibleReason = dog?.dayTripIneligibleReason ?? null;
	$: isBehaviorIneligible =
		Boolean(dog) &&
		dog.dayTripStatus === 'ineligible' &&
		dog.isolationStatus === 'none' &&
		ineligibleReason === 'behavior';
	$: isMedicalIneligible =
		Boolean(dog) &&
		dog.dayTripStatus === 'ineligible' &&
		dog.isolationStatus === 'none' &&
		ineligibleReason === 'medical';
	$: isOtherIneligible =
		Boolean(dog) &&
		dog.dayTripStatus === 'ineligible' &&
		dog.isolationStatus === 'none' &&
		ineligibleReason === 'other';
	$: isUnknownIneligible =
		Boolean(dog) &&
		dog.dayTripStatus === 'ineligible' &&
		dog.isolationStatus === 'none' &&
		ineligibleReason === null;
	$: managerOnlyReason = dog?.dayTripManagerOnlyReason ?? null;
	$: isManagerOnly = Boolean(dog) && dog.dayTripManagerOnly === true && dog.isolationStatus === 'none';
	$: dayTripReasonNote = dog?.dayTripNotes?.trim() ?? '';
	$: managerOnlyNote = !isManagerOnly
		? ''
		: managerOnlyReason === 'behavior'
			? dayTripReasonNote
				? `Manager only (behavior): ${dayTripReasonNote}`
				: 'Manager only (behavior)'
			: managerOnlyReason === 'medical'
				? dayTripReasonNote
					? `Manager only (medical): ${dayTripReasonNote}`
					: 'Manager only (medical)'
				: dayTripReasonNote
					? `Manager only: ${dayTripReasonNote}`
					: 'Manager only';
	$: difficultWhiteboardNote = dayTripReasonNote ? `Adults only: ${dayTripReasonNote}` : 'Adults only';
	$: activeTrip = dayTripLogs.find((log) => !log.endedAt) ?? null;
	$: adoptionAvailability = dog ? getAdoptionAvailability(dog) : null;
	$: adoptionNotice = dog
		? adoptionAvailability?.state === 'not_available'
			? 'No longer available for adoption'
			: adoptionAvailability?.state === 'medical_hold'
				? `Not available for adoption: needs ${adoptionAvailability.missingMedicalRequirements.join(', ')}`
				: adoptionAvailability?.state === 'isolation_hold'
					? 'Temporarily unavailable for adoption'
					: 'Available for adoption'
		: 'Unavailable';
	$: adoptionToneClass = adoptionAvailability?.state === 'available' ? 'whiteboard-alert-ok' : 'whiteboard-alert-warn';
	$: whiteboardStatusTagClass = dog
		? dog.isolationStatus !== 'none' || dayTripEligibility.status === 'ineligible' || isManagerOnly
			? 'whiteboard-tag-red'
			: dayTripEligibility.status === 'difficult'
				? 'whiteboard-tag-yellow'
				: 'whiteboard-tag-green'
		: 'whiteboard-tag-green';
	$: whiteboardNote = dog
		? dog.isOutOnDayTrip
			? 'Day Trip'
			: dog.isolationStatus !== 'none'
				? 'Isolation'
				: isManagerOnly
					? managerOnlyNote
					: isBehaviorIneligible
						? dayTripReasonNote
							? `Behavior hold: ${dayTripReasonNote}`
							: 'Behavior hold'
					: isMedicalIneligible
						? dayTripReasonNote
							? `Medical hold: ${dayTripReasonNote}`
							: 'Medical hold'
						: isOtherIneligible
							? dayTripReasonNote
								? `Day trip hold: ${dayTripReasonNote}`
								: 'Day trip hold'
						: isUnknownIneligible
							? dayTripReasonNote
								? `Day trip hold: ${dayTripReasonNote}`
								: 'Day trip hold'
						: dog.dayTripStatus === 'difficult'
							? difficultWhiteboardNote
							: ''
		: '';
	$: whiteboardNoteToneClass =
		whiteboardNote === 'Day Trip'
			? 'whiteboard-note-blue'
			: dog &&
				  !dog.isOutOnDayTrip &&
				  (dog.isolationStatus !== 'none' || dog.dayTripStatus === 'ineligible' || isManagerOnly)
				? 'whiteboard-note-red'
				: dog && !dog.isOutOnDayTrip && dog.dayTripStatus === 'difficult'
					? 'whiteboard-note-yellow'
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
		await archiveDog(dog.id);
		toast.success('Dog archived.');
		await loadAll();
	}

	async function handleDelete() {
		if (!dog) return;
		await deleteDog(dog.id);
		toast.success('Dog deleted.');
		window.location.href = '/dogs';
	}

	function closeConfirmModal() {
		if (confirmBusy) return;
		confirmAction = null;
	}

	async function handleConfirmAction() {
		if (!confirmAction || !dog || confirmBusy) return;
		confirmBusy = true;
		const action = confirmAction;
		try {
			if (action === 'archive') {
				await handleArchive();
				confirmAction = null;
				return;
			}
			await handleDelete();
			confirmAction = null;
		} catch (error) {
			console.error(error);
			toast.error(action === 'archive' ? 'Unable to archive dog.' : 'Unable to delete dog.');
		} finally {
			confirmBusy = false;
		}
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
				<div class="dog-detail-head">
					<div class="dog-detail-kicker-row">
						<a class="dog-detail-back typewriter" href="/dogs" aria-label="Back to dogs list">
							<svg class="dog-detail-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="m15 5-7 7 7 7" />
								<path d="M8 12h10" />
							</svg>
							<span>Back</span>
						</a>
						<span class="label-maker label-maker-blue">Dog Detail</span>
					</div>
					<h2 class="dog-detail-title">{dog.name}</h2>
				</div>
				{#if canEdit}
					<div class="dog-detail-actions">
						<button
							class={`icon-action ${editMode ? 'icon-action-cancel' : 'icon-action-edit'}`}
							on:click={() => (editMode = !editMode)}
							aria-label={editMode ? 'Cancel edit' : 'Edit dog'}
							title={editMode ? 'Cancel edit' : 'Edit dog'}
						>
							{#if editMode}
								<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M9 6 4 11l5 5" />
									<path d="M4 11h10a4 4 0 1 1 0 8h-2" />
									<path d="M18.5 4.5l.3.8.8.3-.8.3-.3.8-.3-.8-.8-.3.8-.3.3-.8z" fill="currentColor" stroke="none" />
								</svg>
							{:else}
								<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M4 20l4.2-1 9.2-9.2a2.2 2.2 0 1 0-3.1-3.1L5.1 15.9 4 20z" />
									<path d="m13.4 7.6 3 3" />
									<path d="M19.2 2.8l.4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4.4-1z" fill="currentColor" stroke="none" />
								</svg>
							{/if}
						</button>
						<button
							class="icon-action icon-action-save"
							on:click={saveDog}
							disabled={!editMode || saving}
							aria-label={saving ? 'Saving changes' : 'Save changes'}
							title={saving ? 'Saving changes' : 'Save changes'}
						>
							{#if saving}
								<svg class="icon-svg icon-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2" opacity="0.28" />
									<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
								</svg>
							{:else}
								<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M12 20.2s-6.4-4.1-8.4-7c-2-2.8-.9-6.6 2.2-7.2 2-.4 3.3.7 4.2 1.9.9-1.2 2.2-2.3 4.2-1.9 3.1.6 4.2 4.4 2.2 7.2-2 2.9-8.4 7-8.4 7z" />
									<path d="m9.2 11.8 2 2 3.7-3.7" />
								</svg>
							{/if}
						</button>
					</div>
				{/if}
			</div>

		{#if !editMode}
			<div class="kennel-scene">
					<article class="kennel-sheet">
					<div class="kennel-clip" aria-hidden="true"></div>
					<div class="kennel-sheet-inner">
						<div class="kennel-adoption-banner">
							<div class={`whiteboard-status-tag ${whiteboardStatusTagClass}`} aria-hidden="true"></div>
							<p class={`whiteboard-alert typewriter ${adoptionToneClass}`}>{adoptionNotice}</p>
							<div class="whiteboard-trip whiteboard-trip-inline typewriter">
								<p class={`whiteboard-trip-pill ${dayTripBadgeClass}`}>{dayTripBadgeText}</p>
							</div>
						</div>

						<div class="kennel-sheet-main">
							<div class="kennel-photo">
							<div class="kennel-photo-frame">
								{#if dog.photoUrl}
									<img
										class="kennel-photo-image"
										src={dog.photoUrl}
										alt={`Photo of ${dog.name}`}
										loading="lazy"
									/>
								{:else}
									<span>{dog.name.slice(0, 1).toUpperCase() || '?'}</span>
								{/if}
							</div>
							<p class="kennel-photo-label typewriter">
								{dog.photoUrl ? 'Photo on file' : canEdit ? 'Photo pending upload (use Edit Dog)' : 'Photo pending upload'}
							</p>
							</div>

							<div class="kennel-facts typewriter">
									<p><span>Original Entry:</span> <strong class="detail-value">{formatDate(dog.originalIntakeDate)}</strong></p>
									<p><span>Current Entry:</span> <strong class="detail-value">{formatDate(dog.intakeDate)}</strong></p>
									<p><span>Time at Shelter:</span> <strong class="detail-value">{shelterTimeLabel(dog.intakeDate)}</strong></p>
								<p><span>Re-entries:</span> <strong class="detail-value">{dog.reentryDates.length}</strong></p>
							<p><span>Came From:</span> <strong class="detail-value">{dog.origin || 'Unknown'}</strong></p>
							<p><span>Breed:</span> <strong class="detail-value">{dog.breed || 'Unknown'}</strong></p>
							<p><span>Estimated Birthday:</span> <strong class="detail-value">{formatDate(dog.dateOfBirth)}</strong></p>
							<p><span>Age:</span> <strong class="detail-value">{formatAge(dog.dateOfBirth, today)}</strong></p>
							<p><span>Color:</span> <strong class="detail-value">Unknown</strong></p>
							<p><span>Sex:</span> <strong class="detail-value">{sexLabel(dog.sex)}</strong></p>
							<p><span>Weight:</span> <strong class="detail-value">{dog.weightLbs ? `${dog.weightLbs} lbs` : 'Unknown'}</strong></p>
							<p><span>Energy:</span> <strong class="detail-value">{energyLabel(dog.energyLevel)}</strong></p>
							<p><span>Kennel:</span> <strong class="detail-value">{dog.outdoorKennelAssignment || 'Unassigned'}</strong></p>
							<p><span>Status:</span> <strong class="detail-value">{dog.status === 'active' ? 'Active' : 'Adopted'}</strong></p>
							<p><span>Food:</span> <strong class="detail-value">{dog.foodType} ({dog.foodAmount || 'TBD'})</strong></p>
							<p><span>Own Food:</span> <strong class="detail-value">{dog.hasOwnFood ? 'Yes' : 'No'}</strong></p>
							{#if dog.hasOwnFood}
								<p>
									<span>Transition to Hills:</span>
									<strong class="detail-value">{dog.transitionToHills === true ? 'Yes' : dog.transitionToHills === false ? 'No' : 'Not set'}</strong>
								</p>
							{/if}
							<p><span>Microchipped:</span> <strong class="detail-value">{dog.isMicrochipped ? 'Yes' : 'No'}</strong></p>
						</div>
					</div>

					<div class="kennel-sheet-description typewriter">
						<p class="kennel-sheet-description-title">Description</p>
						<p>{dog.dietaryNotes || dog.dayTripNotes || 'No additional profile notes logged yet.'}</p>
						<p><span>Good with Dogs:</span> <strong class="detail-value">{compatibilityLabel(dog.goodWithDogs)}</strong></p>
						<p><span>Good with Cats:</span> <strong class="detail-value">{compatibilityLabel(dog.goodWithCats)}</strong></p>
						<p><span>Good with Kids:</span> <strong class="detail-value">{compatibilityLabel(dog.goodWithKids)}</strong></p>
						<p><span>Housetrained:</span> <strong class="detail-value">{pottyLabel(dog.pottyTrained)}</strong></p>
						<p><span>Best Home Fit:</span> <strong class="detail-value">{dog.idealHome || 'Not yet documented'}</strong></p>
					</div>

					<p class="kennel-sheet-footer typewriter">
						All shelter pets are fixed, microchipped, and up-to-date on vaccinations before adoption.
					</p>
				</div>
				</article>

				<aside class="kennel-whiteboard">
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
				<div class="flex flex-wrap items-center justify-between gap-2">
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
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="text-sm font-semibold uppercase tracking-[0.2em] text-ink-500">Feeding History</h3>
						<div class="flex w-full flex-wrap gap-2 text-xs sm:w-auto">
							<input
								type="date"
								class="w-full rounded-full border border-ink-100 px-3 py-1 sm:w-auto"
								bind:value={fromDate}
							/>
							<input
								type="date"
								class="w-full rounded-full border border-ink-100 px-3 py-1 sm:w-auto"
								bind:value={toDateFilter}
							/>
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
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="text-sm font-semibold uppercase tracking-[0.2em] text-ink-500">Stool Logs</h3>
						<div class="flex w-full flex-wrap gap-2 text-xs sm:w-auto">
							<input
								type="date"
								class="w-full rounded-full border border-ink-100 px-3 py-1 sm:w-auto"
								bind:value={stoolFromDate}
							/>
							<input
								type="date"
								class="w-full rounded-full border border-ink-100 px-3 py-1 sm:w-auto"
								bind:value={stoolToDateFilter}
							/>
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
				<button class="rounded-full border border-ink-200 px-4 py-2 text-xs" on:click={() => (confirmAction = 'archive')}>
					Archive Dog
				</button>
				<button class="rounded-full border border-rose-200 px-4 py-2 text-xs text-rose-600" on:click={() => (confirmAction = 'delete')}>
					Delete Dog
				</button>
			</div>
		{/if}
	</section>
{/if}

<Modal
	open={confirmAction !== null}
	title={confirmAction === 'archive' ? 'Archive Dog' : 'Delete Dog'}
	placement="top"
	onClose={closeConfirmModal}
>
	{#if confirmAction === 'archive'}
		<p class="text-sm text-ink-700">Archive {dog?.name ?? 'this dog'}? You can still find archived dogs in the roster with archived records shown.</p>
	{:else if confirmAction === 'delete'}
		<p class="text-sm text-ink-700">Delete {dog?.name ?? 'this dog'} permanently? This cannot be undone.</p>
	{/if}
	<div slot="footer" class="flex justify-end gap-2">
		<button
			class="rounded-full border border-ink-200 px-4 py-2 text-xs"
			disabled={confirmBusy}
			on:click={closeConfirmModal}
		>
			Cancel
		</button>
		<button
			class={`rounded-full px-4 py-2 text-xs text-white ${
				confirmAction === 'delete' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-ink-900 hover:bg-ink-800'
			}`}
			disabled={confirmBusy}
			on:click={handleConfirmAction}
		>
			{#if confirmBusy}
				Working...
			{:else if confirmAction === 'archive'}
				Archive Dog
			{:else}
				Delete Dog
			{/if}
		</button>
	</div>
</Modal>

<style>
	.dog-detail-status {
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	.dog-detail-board {
		display: grid;
		gap: 0.88rem;
		max-width: 100%;
		min-width: 0;
	}

	.dog-detail-title {
		margin-top: 0.42rem;
		font-size: clamp(2.2rem, 9vw, 3.8rem);
		line-height: 0.95;
		color: var(--marker-black);
	}

	.dog-detail-head {
		min-width: 0;
	}

	.dog-detail-kicker-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.44rem;
	}

	.dog-detail-back {
		display: inline-flex;
		align-items: center;
		gap: 0.22rem;
		margin-bottom: 0;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #4f6178;
		text-decoration: none;
	}

	.dog-detail-back:hover {
		color: #2f4f78;
	}

	.dog-detail-back-icon {
		width: 1rem;
		height: 1rem;
	}

	.dog-detail-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
	}

	.dog-detail-board :global(button.icon-action) {
		all: unset;
		min-height: 0;
		width: 2.2rem;
		height: 2.2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		user-select: none;
		transition:
			transform 130ms ease,
			color 130ms ease,
			opacity 130ms ease;
	}

	.dog-detail-board :global(button.icon-action:focus-visible) {
		outline: 2px solid #89a8cb;
		outline-offset: 2px;
		border-radius: 0.3rem;
	}

	.dog-detail-board :global(button.icon-action:hover:not(:disabled)) {
		transform: translateY(-1px) scale(1.08);
	}

	.dog-detail-board :global(button.icon-action:disabled) {
		cursor: not-allowed;
		opacity: 0.38;
		transform: none;
	}

	.icon-svg {
		width: 2rem;
		height: 2rem;
	}

	.icon-spin {
		animation: icon-spin 0.9s linear infinite;
	}

	.icon-action-edit {
		color: #476f9f;
	}

	.icon-action-cancel {
		color: #8f5f7b;
	}

	.icon-action-save {
		color: #3b8a66;
	}

	@keyframes icon-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
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
		gap: 0.5rem;
		padding: 0.5rem;
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
		min-width: 0;
		max-width: 100%;
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

	.kennel-adoption-banner {
		display: grid;
		gap: 0.4rem;
		justify-items: start;
	}

	.kennel-sheet-main {
		display: grid;
		gap: 0.68rem;
		align-items: start;
		min-width: 0;
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
		overflow: hidden;
	}

	.kennel-photo-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
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

	.kennel-facts p {
		margin: 0.08rem 0;
		overflow-wrap: anywhere;
	}

	.kennel-facts span {
		display: inline-block;
		min-width: 8.2rem;
		color: #53637b;
	}

	.detail-value {
		font-family: var(--font-ui);
		font-size: 0.95em;
		font-weight: 800;
		letter-spacing: 0;
		color: #1f2f46;
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
		padding: 0.62rem 0.72rem;
		border: 1px solid #c3ccdb;
		background: #edf2f8;
		text-align: center;
		font-size: 1.25rem;
		line-height: 1.16;
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
		font-size: 2.6rem;
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
		grid-template-columns: minmax(0, 7.3rem) minmax(0, 1fr);
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
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.whiteboard-trip {
		border-top: 1px dashed #c5ceda;
		padding-top: 0.38rem;
		font-size: 0.64rem;
		color: #2f3d52;
	}

	.whiteboard-trip-inline {
		width: 100%;
		border-top: none;
		padding-top: 0;
	}

	.whiteboard-trip p {
		margin: 0.08rem 0;
	}

	.whiteboard-trip-pill {
		margin: 0;
		padding: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		font-family: var(--font-permanent);
		font-size: 1.22rem;
		line-height: 1.05;
		letter-spacing: 0.03em;
		font-weight: 700;
		text-transform: uppercase;
		display: inline-block;
	}

	.whiteboard-trip-pill-green {
		color: #166534;
	}

	.whiteboard-trip-pill-yellow {
		color: #c2410c;
	}

	.whiteboard-trip-pill-red {
		color: #b91c1c;
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
		.kennel-facts {
			font-size: 1.07rem;
			line-height: 1.44;
		}

		.kennel-facts span {
			min-width: 6.8rem;
		}

		.kennel-sheet-description {
			font-size: 1.03rem;
			line-height: 1.38;
		}

		.kennel-sheet-description-title {
			font-size: 1.17rem;
		}

		.kennel-sheet-footer {
			font-size: 0.93rem;
			line-height: 1.35;
		}

		.whiteboard-note {
			font-size: 2.2rem;
		}

		.whiteboard-alert {
			font-size: 1.24rem;
			padding: 0.62rem 0.7rem;
		}

		.whiteboard-facts {
			font-size: 0.99rem;
			gap: 0.4rem;
		}

		.whiteboard-facts dt {
			font-size: 0.84rem;
			letter-spacing: 0.06em;
		}

		.whiteboard-trip {
			font-size: 0.99rem;
			line-height: 1.4;
		}

		.whiteboard-trip-pill {
			font-size: 1.56rem;
			padding: 0;
		}

		.whiteboard-facts div {
			grid-template-columns: 1fr;
			gap: 0.18rem;
		}
	}
</style>
