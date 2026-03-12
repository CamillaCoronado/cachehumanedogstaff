<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { page } from '$app/stores';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { resolveRole, canEditDogs, resolveDogHandlingLevel } from '$lib/utils/permissions';
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
	import { energyLabel, compatibilityLabel, handlingLevelLabel, pottyLabel, sexLabel } from '$lib/utils/labels';

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
	let activeStatusInfo: 'adoption' | 'daytrip' | 'handling' | null = null;

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
				dog.handlingLevel,
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
	$: effectiveHandlingLevel = dog
		? resolveDogHandlingLevel(dog.handlingLevel, dog.dayTripManagerOnly, dog.isolationStatus)
		: 'volunteer';
	$: handlingLevelText = handlingLevelLabel(effectiveHandlingLevel);
	$: isManagerHandlingOnly = effectiveHandlingLevel === 'manager_only';
	$: isStaffHandlingOnly = effectiveHandlingLevel === 'staff_only';
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
	$: primaryDayTripReason =
		dayTripEligibility.status === 'ineligible'
			? dayTripEligibility.reasons[0] ?? dayTripReasonNote
			: dayTripEligibility.status === 'difficult'
				? dayTripReasonNote || dayTripEligibility.reasons.find((reason) =>
						reason.toLowerCase().startsWith('difficult')
					) || ''
				: '';
	$: dayTripBadgeReason = primaryDayTripReason.replace(/\s+/g, ' ').trim();
	$: dayTripBadgeText =
		dayTripEligibility.status === 'ineligible'
			? dayTripBadgeReason
				? `Ineligible: ${dayTripBadgeReason}`
				: 'Ineligible for day trips'
			: dayTripEligibility.status === 'difficult'
				? dayTripBadgeReason
					? `Caution: ${dayTripBadgeReason}`
					: 'Adults only day trips'
				: 'Eligible for day trips';
	$: dayTripBadgeTitle =
		dayTripEligibility.status === 'ineligible' && primaryDayTripReason
			? `Day trip hold: ${primaryDayTripReason}`
			: dayTripEligibility.status === 'difficult' && primaryDayTripReason
				? `Caution: ${primaryDayTripReason}`
				: dayTripBadgeText;
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
	$: difficultWhiteboardNote = dayTripReasonNote ? `Caution: ${dayTripReasonNote}` : 'Adults only';
	$: activeTrip = dayTripLogs.find((log) => !log.endedAt) ?? null;
	$: adoptionAvailability = dog ? getAdoptionAvailability(dog) : null;
	$: adoptionNotice = dog
		? adoptionAvailability?.state === 'not_available'
			? 'No longer available for adoption'
			: adoptionAvailability?.state === 'medical_hold'
				? `Not available for adoption: needs ${adoptionAvailability.missingMedicalRequirements.join(', ')}`
				: adoptionAvailability?.state === 'handling_hold'
					? `Adoption restricted: ${adoptionAvailability.holdReason ?? 'handling plan'}`
				: adoptionAvailability?.state === 'day_trip_hold'
					? `Not available for adoption: ${adoptionAvailability.holdReason ?? 'care hold'}`
					: adoptionAvailability?.state === 'isolation_hold'
						? 'Temporarily unavailable for adoption'
						: 'Available for adoption'
		: 'Unavailable';
	$: adoptionIsAvailable = adoptionAvailability?.state === 'available';
	$: adoptionReason =
		adoptionAvailability?.state === 'medical_hold'
			? `needs ${adoptionAvailability.missingMedicalRequirements.join(', ')}`
			: adoptionAvailability?.state === 'not_available'
				? adoptionAvailability.holdReason ?? 'not available'
				: adoptionAvailability?.state === 'handling_hold' ||
					  adoptionAvailability?.state === 'day_trip_hold' ||
					  adoptionAvailability?.state === 'isolation_hold'
					? adoptionAvailability.holdReason ?? 'care hold'
					: '';
	$: adoptionReasonBadge = adoptionReason.replace(/\s+/g, ' ').trim();
	$: adoptionPillClass = adoptionIsAvailable ? 'whiteboard-trip-pill-green' : 'whiteboard-trip-pill-red';
	$: adoptionPillText = adoptionIsAvailable
		? 'Adoption: Available'
		: adoptionReasonBadge
			? `Adoption: Unavailable (${adoptionReasonBadge})`
			: 'Adoption: Unavailable';
	$: whiteboardStatusTagClass = dog
		? dog.isolationStatus !== 'none' ||
		  isManagerOnly ||
		  isManagerHandlingOnly ||
		  isStaffHandlingOnly
			? 'whiteboard-tag-red'
			: dayTripEligibility.status === 'difficult'
				? 'whiteboard-tag-yellow'
				: 'whiteboard-tag-green'
		: 'whiteboard-tag-green';
	$: stripHasCarefulWarning =
		Boolean(dog) &&
		!dog.isOutOnDayTrip &&
		dog.isolationStatus === 'none' &&
		!isManagerOnly &&
		!isManagerHandlingOnly &&
		!isStaffHandlingOnly &&
		dayTripEligibility.status === 'ineligible';
	$: stripStatusPillClass =
		stripHasCarefulWarning
			? 'whiteboard-trip-pill-yellow'
			: whiteboardStatusTagClass === 'whiteboard-tag-red'
			? 'whiteboard-trip-pill-red'
			: whiteboardStatusTagClass === 'whiteboard-tag-yellow'
				? 'whiteboard-trip-pill-yellow'
				: 'whiteboard-trip-pill-green';
	$: whiteboardNote = dog
		? dog.isOutOnDayTrip
			? 'Day Trip'
			: dog.isolationStatus !== 'none'
				? dog.isolationStatus === 'sick'
					? 'Manager only: sick isolation'
					: 'Manager only: bite quarantine'
				: isManagerOnly
					? managerOnlyNote
					: isManagerHandlingOnly
						? dayTripReasonNote
							? `Manager only: ${dayTripReasonNote}`
							: 'Manager only'
						: isStaffHandlingOnly
							? dayTripReasonNote
								? `Staff only: ${dayTripReasonNote}`
								: 'Staff only'
						: dayTripEligibility.status === 'ineligible'
							? primaryDayTripReason
								? `Careful: ${primaryDayTripReason}`
								: 'Careful'
							: dog.dayTripStatus === 'difficult'
								? difficultWhiteboardNote
								: ''
		: '';
	$: stripReasonLabel = whiteboardNote || `Handling: ${handlingLevelText}`;
	$: stripReasonText = stripReasonLabel;
	$: stripReasonTitle = stripReasonLabel;
	$: activeStatusText =
		activeStatusInfo === 'adoption'
			? adoptionPillText
			: activeStatusInfo === 'daytrip'
				? dayTripBadgeText
				: activeStatusInfo === 'handling'
					? stripReasonText
					: '';
	$: activeStatusToneClass =
		activeStatusInfo === 'adoption'
			? adoptionPillClass
			: activeStatusInfo === 'daytrip'
				? dayTripBadgeClass
				: stripStatusPillClass;
	$: whiteboardNoteToneClass =
		whiteboardNote === 'Day Trip'
			? 'whiteboard-note-blue'
			: dog &&
				  !dog.isOutOnDayTrip &&
				  (dog.isolationStatus !== 'none' ||
						isManagerOnly ||
						isManagerHandlingOnly ||
						isStaffHandlingOnly)
				? 'whiteboard-note-red'
				: dog &&
					  !dog.isOutOnDayTrip &&
					  dog.dayTripStatus === 'difficult'
					? 'whiteboard-note-yellow'
					: '';

	onMount(async () => {
		await loadAll();
	});

	async function loadAll() {
		loading = true;
		activeStatusInfo = null;
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

	function toggleStatusInfo(kind: 'adoption' | 'daytrip' | 'handling') {
		activeStatusInfo = activeStatusInfo === kind ? null : kind;
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
						<span class="dog-detail-chip">Dog detail</span>
					</div>
				</div>
				{#if canEdit}
					<div class="dog-detail-actions">
						<button
							type="button"
							class={`icon-action ${editMode ? 'icon-action-cancel' : 'icon-action-edit'}`}
							on:click={() => (editMode = !editMode)}
							aria-label={editMode ? 'Cancel edit' : 'Edit dog'}
							title={editMode ? 'Cancel edit' : 'Edit dog'}
						>
							{#if editMode}
								<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M8 8l8 8" />
									<path d="m16 8-8 8" />
								</svg>
							{:else}
								<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M12 20h8.5" />
									<path d="M16.7 3.6a2.12 2.12 0 0 1 3 3L8 18.3l-4 1 1-4z" />
								</svg>
							{/if}
						</button>
						{#if editMode}
							<button
								type="button"
								class="icon-action icon-action-save"
								on:click={saveDog}
								disabled={saving}
								aria-label={saving ? 'Saving changes' : 'Save changes'}
								title={saving ? 'Saving changes' : 'Save changes'}
							>
								{#if saving}
									<svg class="icon-svg icon-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
										<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2" opacity="0.28" />
										<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
									</svg>
								{:else}
									<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="m20 7-9 10-5-5" />
									</svg>
								{/if}
							</button>
						{/if}
					</div>
				{/if}
			</div>

		{#if !editMode}
			<div class="kennel-scene">
					<article class="kennel-sheet">
					<div class="kennel-clip" aria-hidden="true"></div>
					<div class="kennel-sheet-inner">
						<p class="kennel-name kennel-name-top">{dog.name}</p>
						<div class="kennel-photo">
							<div class="kennel-photo-frame">
								<div class={`photo-corner-stripe ${whiteboardStatusTagClass}`} aria-hidden="true"></div>
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
								{dog.photoUrl ? 'Photo on file' : 'Photo pending upload'}
							</p>
						</div>

						<div class="kennel-adoption-banner">
							<div class="whiteboard-trip whiteboard-trip-inline typewriter">
								<div class="whiteboard-trip-icons" role="group" aria-label="Dog status details">
									<button
										type="button"
										class={`whiteboard-icon-btn ${adoptionPillClass} ${activeStatusInfo === 'adoption' ? 'whiteboard-icon-btn-active' : ''}`}
										on:click={() => toggleStatusInfo('adoption')}
										aria-label={adoptionPillText}
										aria-pressed={activeStatusInfo === 'adoption'}
										title={adoptionNotice}
									>
										<span class="whiteboard-pill-icon" aria-hidden="true">
											<svg viewBox="0 0 24 24" fill="none">
												<path d="M3.5 10.2 12 3l8.5 7.2"></path>
												<path d="M5.5 9.3V20h13V9.3"></path>
												<path d="M10 20v-5.3h4V20"></path>
											</svg>
										</span>
									</button>
									<button
										type="button"
										class={`whiteboard-icon-btn ${dayTripBadgeClass} ${activeStatusInfo === 'daytrip' ? 'whiteboard-icon-btn-active' : ''}`}
										on:click={() => toggleStatusInfo('daytrip')}
										aria-label={dayTripBadgeText}
										aria-pressed={activeStatusInfo === 'daytrip'}
										title={dayTripBadgeTitle}
									>
										<span class="whiteboard-pill-icon" aria-hidden="true">
											<svg viewBox="0 0 24 24" fill="none">
												<circle cx="12" cy="12" r="3.5"></circle>
												<path d="M12 2.9v2.6"></path>
												<path d="M12 18.5v2.6"></path>
												<path d="M2.9 12h2.6"></path>
												<path d="M18.5 12h2.6"></path>
												<path d="m5.8 5.8 1.8 1.8"></path>
												<path d="m16.4 16.4 1.8 1.8"></path>
												<path d="m5.8 18.2 1.8-1.8"></path>
												<path d="m16.4 7.6 1.8-1.8"></path>
											</svg>
										</span>
									</button>
									<button
										type="button"
										class={`whiteboard-icon-btn ${stripStatusPillClass} ${activeStatusInfo === 'handling' ? 'whiteboard-icon-btn-active' : ''}`}
										on:click={() => toggleStatusInfo('handling')}
										aria-label={stripReasonText}
										aria-pressed={activeStatusInfo === 'handling'}
										title={stripReasonTitle}
									>
										<span class="whiteboard-pill-icon" aria-hidden="true">
											<svg viewBox="0 0 24 24" fill="none">
												{#if effectiveHandlingLevel === 'manager_only'}
													<path d="M4 18h16l-1.2-8.6-4.8 3.8L12 7l-2 6.2-4.8-3.8z"></path>
												{:else if effectiveHandlingLevel === 'staff_only'}
													<rect x="4.2" y="5.3" width="15.6" height="13.4" rx="2.2"></rect>
													<path d="M8.4 10.1h7.2"></path>
													<path d="M8.4 13.8h7.2"></path>
												{:else}
													<path d="M12 19.2c-3.8-2.8-7-5.4-7-8.4 0-2.3 1.8-4.1 4.1-4.1 1.2 0 2.3.5 3.1 1.4.8-.9 1.9-1.4 3.1-1.4 2.3 0 4.1 1.8 4.1 4.1 0 3-3.2 5.6-7 8.4z"></path>
												{/if}
											</svg>
										</span>
									</button>
								</div>
								{#if activeStatusInfo}
									<p class={`whiteboard-trip-detail ${activeStatusToneClass}`}>{activeStatusText}</p>
								{/if}
							</div>
						</div>

						<div class="kennel-sheet-main">
							<div class="kennel-sections typewriter">
								<details class="kennel-section" open>
									<summary>Intake & Shelter</summary>
									<div class="kennel-section-body kennel-facts">
										<p><span>Original Entry:</span> <strong class="detail-value">{formatDate(dog.originalIntakeDate)}</strong></p>
										<p><span>Current Entry:</span> <strong class="detail-value">{formatDate(dog.intakeDate)}</strong></p>
										<p><span>Time at Shelter:</span> <strong class="detail-value">{shelterTimeLabel(dog.intakeDate)}</strong></p>
										<p><span>Re-entries:</span> <strong class="detail-value">{dog.reentryDates.length}</strong></p>
										<p><span>Came From:</span> <strong class="detail-value">{dog.origin || 'Unknown'}</strong></p>
										<p><span>Kennel:</span> <strong class="detail-value">{dog.outdoorKennelAssignment || 'Unassigned'}</strong></p>
										<p><span>Status:</span> <strong class="detail-value">{dog.status === 'active' ? 'Active' : 'Adopted'}</strong></p>
									</div>
								</details>

								<details class="kennel-section">
									<summary>Profile</summary>
									<div class="kennel-section-body kennel-facts">
										<p><span>Breed:</span> <strong class="detail-value">{dog.breed || 'Unknown'}</strong></p>
										<p><span>Estimated Birthday:</span> <strong class="detail-value">{formatDate(dog.dateOfBirth)}</strong></p>
										<p><span>Age:</span> <strong class="detail-value">{formatAge(dog.dateOfBirth, today)}</strong></p>
										<p><span>Color:</span> <strong class="detail-value">Unknown</strong></p>
										<p><span>Sex:</span> <strong class="detail-value">{sexLabel(dog.sex)}</strong></p>
										<p><span>Weight:</span> <strong class="detail-value">{dog.weightLbs ? `${dog.weightLbs} lbs` : 'Unknown'}</strong></p>
										<p><span>Energy:</span> <strong class="detail-value">{energyLabel(dog.energyLevel)}</strong></p>
										<p><span>Microchipped:</span> <strong class="detail-value">{dog.isMicrochipped ? 'Yes' : 'No'}</strong></p>
									</div>
								</details>

								<details class="kennel-section">
									<summary>Care & Food</summary>
									<div class="kennel-section-body kennel-facts">
										<p><span>Handling:</span> <strong class="detail-value">{handlingLevelText}</strong></p>
										<p><span>Food:</span> <strong class="detail-value">{dog.foodType} ({dog.foodAmount || 'TBD'})</strong></p>
										<p><span>Own Food:</span> <strong class="detail-value">{dog.hasOwnFood ? 'Yes' : 'No'}</strong></p>
										{#if dog.hasOwnFood}
											<p>
												<span>Transition to Hills:</span>
												<strong class="detail-value">{dog.transitionToHills === true ? 'Yes' : dog.transitionToHills === false ? 'No' : 'Not set'}</strong>
											</p>
										{/if}
									</div>
								</details>

								<details class="kennel-section">
									<summary>Behavior & Home Fit</summary>
									<div class="kennel-section-body kennel-facts">
										<p><span>Description:</span> <strong class="detail-note">{dog.dietaryNotes || dog.dayTripNotes || 'No additional profile notes logged yet.'}</strong></p>
										<p><span>Good with Dogs:</span> <strong class="detail-value">{compatibilityLabel(dog.goodWithDogs)}</strong></p>
										<p><span>Good with Cats:</span> <strong class="detail-value">{compatibilityLabel(dog.goodWithCats)}</strong></p>
										<p><span>Good with Kids:</span> <strong class="detail-value">{compatibilityLabel(dog.goodWithKids)}</strong></p>
										<p><span>Housetrained:</span> <strong class="detail-value">{pottyLabel(dog.pottyTrained)}</strong></p>
										<p><span>Best Home Fit:</span> <strong class="detail-value">{dog.idealHome || 'Not yet documented'}</strong></p>
									</div>
								</details>
							</div>
						</div>

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
						<dt>Handling</dt>
						<dd>{handlingLevelText}</dd>
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
					Mark as Adopted
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
	title={confirmAction === 'archive' ? 'Mark as Adopted' : 'Delete Dog'}
	placement="top"
	onClose={closeConfirmModal}
>
	{#if confirmAction === 'archive'}
		<p class="text-sm text-ink-700">Mark {dog?.name ?? 'this dog'} as adopted? They'll be removed from the active roster and appear in recently adopted.</p>
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
				Mark as Adopted
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
		gap: 1.05rem;
		max-width: 100%;
		min-width: 0;
		color: #1f3550;
		font-family: var(--font-ui);
	}

	.dog-detail-head {
		min-width: 0;
	}

	.dog-detail-kicker-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.52rem;
	}

	.dog-detail-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.62rem 0.22rem;
		border: 1px solid #d2ddeb;
		border-radius: 999px;
		background: #edf4fc;
		font-family: var(--font-ui);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		line-height: 1;
		color: #2f5f8f;
	}

	.dog-detail-back {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
		margin-bottom: 0;
		font-size: 0.94rem;
		letter-spacing: 0.01em;
		text-transform: none;
		color: #5e748d;
		text-decoration: none;
	}

	.dog-detail-back:hover {
		color: #2c567e;
	}

	.dog-detail-back-icon {
		width: 1rem;
		height: 1rem;
	}

	.dog-detail-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		position: relative;
		z-index: 3;
	}

	.dog-detail-board :global(button.icon-action) {
		-webkit-appearance: none;
		appearance: none;
		padding: 0;
		margin: 0;
		width: 2.4rem;
		height: 2.4rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		position: relative;
		z-index: 1;
		pointer-events: auto;
		touch-action: manipulation;
		cursor: pointer;
		user-select: none;
		border-radius: 0.72rem;
		border: 1px solid #d5e0ec;
		background: #f6faff;
		box-shadow:
			0 1px 2px rgba(18, 52, 82, 0.08),
			0 1px 0 rgba(255, 255, 255, 0.8) inset;
		transition:
			transform 130ms ease,
			color 130ms ease,
			opacity 130ms ease,
			border-color 130ms ease,
			background-color 130ms ease;
	}

	.dog-detail-board :global(button.icon-action:focus-visible) {
		outline: 2px solid #7da3ce;
		outline-offset: 2px;
	}

	.dog-detail-board :global(button.icon-action:hover:not(:disabled)) {
		transform: translateY(-1px);
		border-color: #c1d2e6;
		background: #f1f7ff;
	}

	.dog-detail-board :global(button.icon-action:disabled) {
		cursor: not-allowed;
		opacity: 0.46;
		transform: none;
		background: #f4f7fb;
	}

	.icon-svg {
		width: 1.18rem;
		height: 1.18rem;
	}

	.icon-spin {
		animation: icon-spin 0.9s linear infinite;
	}

	.icon-action-edit {
		color: #355e86;
	}

	.icon-action-cancel {
		color: #815971;
	}

	.icon-action-save {
		color: #2f7b57;
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
		border: 1px solid #d9e2ee;
		border-radius: 1.4rem;
		background: #fbfdff;
		box-shadow: 0 8px 20px rgba(20, 56, 92, 0.08);
	}

	.dog-detail-board :global(.rounded-2xl) {
		border-radius: 1rem;
		border: 1px solid #dde5f0;
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
		border-radius: 999px;
		border: 1px solid #d5e0ea;
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		text-transform: none;
		color: #1c3b59;
		background: #ffffff;
		padding: 0.3rem 0.9rem;
	}

	.dog-detail-board :global(button.rounded-full.bg-brand-600) {
		background: #d7ebfd;
		color: #0f4f86;
	}

	.dog-detail-board :global(button.rounded-full:disabled) {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.dog-detail-board :global(input:not([type='checkbox']):not([type='radio'])),
	.dog-detail-board :global(textarea),
	.dog-detail-board :global(select) {
		border: 1px solid #cfd9e6;
		border-radius: 0.75rem;
		background: #ffffff;
		color: var(--marker-black);
		font-size: 0.98rem;
		min-height: 2.75rem;
	}

	.kennel-scene {
		position: relative;
		display: grid;
		gap: 0.9rem;
		padding: 0.15rem 0;
		border: none;
		border-radius: 0;
		overflow: visible;
		background: transparent;
	}

	.kennel-scene::before {
		display: none;
	}

	.kennel-scene::after {
		display: none;
	}

	.kennel-sheet,
	.kennel-whiteboard {
		position: relative;
		z-index: 1;
		min-width: 0;
		max-width: 100%;
	}

	.kennel-sheet {
		background: transparent;
		border: none;
		box-shadow: none;
		border-radius: 0;
		padding: 0.26rem 0.45rem 0.45rem;
	}

	.kennel-clip {
		display: none;
	}

	.kennel-sheet-inner {
		display: grid;
		gap: 0.66rem;
	}

	.kennel-adoption-banner {
		display: grid;
		gap: 0.72rem;
		width: 100%;
		justify-items: start;
	}

	.kennel-sheet-main {
		display: grid;
		gap: 0.92rem;
		align-items: start;
		min-width: 0;
	}

	.kennel-photo {
		display: grid;
		gap: 0.44rem;
		justify-items: center;
		align-content: start;
	}

	.kennel-photo-frame {
		position: relative;
		width: min(66vw, 10.5rem);
		aspect-ratio: 3 / 4;
		border: 1px solid #d4deeb;
		border-radius: 0.7rem;
		background: #eef3fb;
		color: #7e8fa3;
		font-family: var(--font-ui);
		font-size: 2.4rem;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.photo-corner-stripe {
		position: absolute;
		top: 0.34rem;
		right: -1.45rem;
		width: 4.8rem;
		height: 0.58rem;
		border-radius: 999px;
		transform: rotate(45deg);
		pointer-events: none;
		z-index: 2;
	}

	.kennel-photo-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.kennel-photo-label {
		margin: 0;
		font-size: 0.76rem;
		letter-spacing: 0.01em;
		text-transform: none;
		color: #6a7f96;
		font-family: var(--font-ui);
		text-align: center;
	}

	.kennel-facts {
		font-size: 1.07rem;
		line-height: 1.44;
		color: #27415d;
		font-family: var(--font-ui);
	}

	.kennel-facts p {
		margin: 0.2rem 0;
		overflow-wrap: anywhere;
	}

	.kennel-name {
		margin: 0 0 0.3rem;
		font-size: clamp(1.9rem, 4.3vw, 2.7rem);
		line-height: 0.95;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: #173a58;
	}

	.kennel-name-top {
		margin: 0 0 0.06rem;
		text-align: center;
	}

	.kennel-sections {
		display: grid;
		gap: 0.42rem;
	}

	.kennel-section {
		border: 1px solid #dde6f1;
		border-radius: 0.82rem;
		background: #ffffff;
		box-shadow:
			0 1px 2px rgba(16, 45, 70, 0.05),
			0 1px 0 rgba(255, 255, 255, 0.8) inset;
		overflow: hidden;
	}

	.kennel-section > summary {
		list-style: none;
		cursor: pointer;
		padding: 0.56rem 0.74rem;
		font-size: 0.82rem;
		line-height: 1.2;
		font-weight: 700;
		color: #2f4a66;
		display: flex;
		align-items: center;
		justify-content: space-between;
		transition: background-color 120ms ease;
	}

	.kennel-section > summary::-webkit-details-marker {
		display: none;
	}

	.kennel-section > summary:hover {
		background: #f8fbff;
	}

	.kennel-section > summary::after {
		content: '';
		width: 0.46rem;
		height: 0.46rem;
		border-right: 2px solid #68839c;
		border-bottom: 2px solid #68839c;
		transform: rotate(45deg) translateY(-0.08rem);
		transition: transform 120ms ease;
		margin-left: 0.45rem;
		flex: 0 0 auto;
	}

	.kennel-section[open] > summary {
		border-bottom: 1px solid #e6edf6;
		background: #f7fbff;
	}

	.kennel-section[open] > summary::after {
		transform: rotate(-135deg) translateY(-0.02rem);
	}

	.kennel-section-body {
		padding: 0.54rem 0.74rem 0.64rem;
	}

	.kennel-facts span {
		display: inline-block;
		min-width: 6.8rem;
		color: #5a7189;
	}

	.detail-value {
		font-family: var(--font-ui);
		font-size: 0.98em;
		font-weight: 700;
		letter-spacing: 0;
		color: #1d3854;
	}

	.detail-note {
		font-family: var(--font-ui);
		font-size: 0.95em;
		font-weight: 600;
		letter-spacing: 0;
		color: #2c4864;
	}

	.kennel-sheet-footer {
		margin: 0;
		border-top: 1px solid #e2e9f3;
		padding-top: 0.5rem;
		font-size: 0.93rem;
		line-height: 1.35;
		text-align: center;
		color: #6b7f97;
		font-family: var(--font-ui);
	}

	.kennel-whiteboard {
		display: grid;
		gap: 0.7rem;
		align-content: start;
		background: #f8fbff;
		border: none;
		box-shadow: none;
		border-radius: 0.9rem;
		padding: 0.7rem 0.7rem 0.68rem;
	}

	.whiteboard-tag-green {
		background: linear-gradient(135deg, #79cfa1 0%, #67bf90 100%);
	}

	.whiteboard-tag-yellow {
		background: linear-gradient(135deg, #f2cb7b 0%, #e8bb62 100%);
	}

	.whiteboard-tag-red {
		background: linear-gradient(135deg, #ee8e8a 0%, #e57470 100%);
	}

	.whiteboard-alert {
		margin: 0;
		padding: 0.62rem 0.72rem;
		border: 1px solid #c3ccdb;
		background: #edf2f8;
		text-align: center;
		font-size: 1.25rem;
		line-height: 1.16;
		font-family: var(--font-ui);
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
		text-align: left;
		font-size: 1.05rem;
		line-height: 1.22;
		font-weight: 700;
		transform: none;
		font-family: var(--font-ui);
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
		gap: 0.4rem;
		font-size: 0.94rem;
		color: #334b63;
		font-family: var(--font-ui);
	}

	.whiteboard-facts div {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.18rem;
		border-top: 1px solid #e5ecf5;
		padding-top: 0.34rem;
	}

	.whiteboard-facts dt {
		font-size: 0.78rem;
		letter-spacing: 0;
		text-transform: none;
		color: #5d738a;
		font-weight: 600;
	}

	.whiteboard-facts dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.whiteboard-trip {
		border-top: 1px solid #e5ecf5;
		padding-top: 0.42rem;
		font-size: 0.9rem;
		line-height: 1.4;
		color: #2f4560;
		font-family: var(--font-ui);
	}

	.whiteboard-trip-inline {
		width: 100%;
		border-top: none;
		padding-top: 0;
		display: grid;
		grid-template-columns: 1fr;
		align-items: start;
		gap: 0.52rem;
	}

	.whiteboard-trip-icons {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: nowrap;
		gap: 0.6rem;
		width: 100%;
	}

	.whiteboard-icon-btn {
		all: unset;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border-radius: 999px;
		transition:
			transform 120ms ease,
			opacity 120ms ease;
	}

	.whiteboard-icon-btn:hover {
		transform: translateY(-1px);
	}

	.whiteboard-icon-btn:focus-visible {
		outline: 2px solid #7da3ce;
		outline-offset: 2px;
	}

	.whiteboard-icon-btn-active .whiteboard-pill-icon {
		border-color: currentColor;
		box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 24%, #ffffff);
	}

	.whiteboard-trip-pill {
		margin: 0;
		padding: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.84rem;
		line-height: 1.18;
		letter-spacing: 0;
		font-weight: 700;
		text-transform: none;
		display: inline-flex;
		align-items: center;
		gap: 0.48rem;
		width: 100%;
	}

	.whiteboard-trip-detail {
		margin: 0.04rem 0 0;
		font-size: 0.95rem;
		line-height: 1.34;
		font-weight: 700;
	}

	.whiteboard-pill-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.3rem;
		height: 2.3rem;
		min-width: 2.3rem;
		min-height: 2.3rem;
		flex: 0 0 2.3rem;
		aspect-ratio: 1 / 1;
		border-radius: 999px;
		border: 1px solid #b9c7d8;
		background: #f7faff;
		color: currentColor;
		transform: translateY(-0.02rem);
	}

	.whiteboard-pill-icon svg {
		width: 1.5rem;
		height: 1.5rem;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
		fill: none;
	}

	.whiteboard-trip-pill-green {
		color: #2f7f59;
	}

	.whiteboard-trip-pill-yellow {
		color: #a77022;
	}

	.whiteboard-trip-pill-red {
		color: #b94a46;
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

	@media (min-width: 641px) {
		.kennel-facts {
			font-size: 0.82rem;
			line-height: 1.45;
		}

		.kennel-facts span {
			min-width: 8.3rem;
		}

		.kennel-sheet-footer {
			font-size: 0.7rem;
			line-height: 1.3;
		}

		.kennel-photo-frame {
			width: 8.3rem;
		}

		.whiteboard-note {
			font-size: 1.18rem;
		}

		.whiteboard-alert {
			font-size: 1.24rem;
			padding: 0.62rem 0.7rem;
		}

		.whiteboard-facts {
			font-size: 0.76rem;
			gap: 0.34rem;
		}

		.whiteboard-facts dt {
			font-size: 0.72rem;
			letter-spacing: 0;
		}

		.whiteboard-trip {
			font-size: 0.8rem;
			line-height: 1.3;
		}

		.whiteboard-trip-pill {
			font-size: 0.88rem;
			padding: 0;
			width: auto;
		}

		.whiteboard-facts div {
			grid-template-columns: minmax(0, 7.3rem) minmax(0, 1fr);
			gap: 0.36rem;
		}

		.whiteboard-trip-detail {
			font-size: 0.88rem;
			line-height: 1.3;
		}
	}
</style>
