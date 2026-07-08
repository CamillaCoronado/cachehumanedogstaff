<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { resolveRole, canEditDogs, resolveDogHandlingLevel } from '$lib/utils/permissions';
	import { updateDog, createDog, logBath, setDogTripStatus, returnDog, syncSheetColorsToDogs } from '$lib/data/dogs';
	import { dogs as dogsStore, ensureDogsLoaded, refreshDogs as refreshDogStore, patchDogInStore } from '$lib/stores/dogs';
	import { listPlaygroupSessions } from '$lib/data/playgroups';
	import type { Dog, PlaygroupSession, UserRole } from '$lib/types';
	import { bathEligible, daysSince, sinceReturn, dogStripeColor, formatAge, isSurgeryToday, checkDayTripEligibility, toDate } from '$lib/utils/dates';
	import { getBathStatus, isBathDue, getDayTripGapDays, isPlaygroupEligible, buildLastPlaygroupMap, isSurgeryResting, DAYTRIP_OVERDUE_DAYS, PLAYGROUP_OVERDUE_DAYS } from '$lib/utils/attention';
	import { getAdoptionAvailability } from '$lib/utils/adoption';
	import { retryablePhoto } from '$lib/utils/photoRetry';
	import Modal from '$lib/components/ui/Modal.svelte';
	import DogForm from '$lib/components/dogs/DogForm.svelte';
	import { energyLabel, compatibilityLabel, handlingLevelLabel, pottyLabel, sexLabel } from '$lib/utils/labels';
	import { syncVersion } from '$lib/stores/sync';
	import {
		tripPillClass,
		tripLabel,
		handlingPillClass,
		handlingLabel,
		dogHandlingLevel,
		adoptionLabel,
		adoptionPillClass,
		missingEvaluations,
		pendingItems,
		actionItemClass,
		handlingColorClass,
		adoptionColorClass,
		tripColorClass,
		toSearchText
	} from '$lib/utils/dogCard';
	import type { TripEligibility } from '$lib/utils/dogCard';

const today = new Date();

	$: dogs = $dogsStore;
	let failedPhotos = new Set<string>();
	let lastPlaygroupByDogId: Record<string, Date | null> = {};
	let loading = true;
	let search = '';
	let viewMode: 'active' | 'all' | 'archived' = 'active';
	let fosterOnly = false;
	let incomingOnly = false;
	let hideIncoming = false;
	let filterGoodWithDogs = false;
	let filterGoodWithCats = false;
	let filterGoodWithKids = false;
	let filterAdoptable = false;
	let expandedPill = new Map<string, 'handling' | 'adoption' | 'trip'>();

	function togglePill(dogId: string, pill: 'handling' | 'adoption' | 'trip') {
		if (expandedPill.get(dogId) === pill) {
			expandedPill.delete(dogId);
		} else {
			expandedPill.set(dogId, pill);
		}
		expandedPill = expandedPill;
	}
	let stripeFilter: 'all' | 'green' | 'yellow' | 'red' = 'all';
	let filterMedical = false;

	// "Medical": in isolation, resting after surgery, or on an active treatment.
	function isMedicalHold(dog: Dog) {
		if (dog.isolationStatus !== 'none') return true;
		if (isSurgeryResting(dog, today)) return true;
		return (dog.treatments ?? []).some((t) => {
			const end = toDate(t.endDate ?? null);
			return !end || end >= today;
		});
	}
	let sortKey: 'name' | 'days' | 'age' | 'weight' = 'days';
	let sortDir: 'asc' | 'desc' = 'asc';
	let showAddModal = false;
	let draftDog: Dog;
	let formValid = true;
	let saving = false;

	onMount(async () => {
		await refreshDogs(false);
	});

	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canEdit = canEditDogs(role);
	$: shelterCount = dogs.filter((dog) => dog.status === 'active' && !dog.permanentFoster && !dog.inFoster && !dog.isIncoming).length;
	$: fosterCount = dogs.filter((dog) => dog.status === 'active' && !dog.permanentFoster && dog.inFoster && !dog.isIncoming).length;
	$: incomingCount = dogs.filter((dog) => dog.status === 'active' && !dog.permanentFoster && dog.isIncoming).length;
	$: filteredDogs = dogs
		.filter((dog) =>
			viewMode === 'all' ? true :
			viewMode === 'archived' ? dog.status !== 'active' :
			dog.status === 'active'
		)
		.filter((dog) => fosterOnly ? dog.inFoster : true)
		.filter((dog) => incomingOnly ? dog.isIncoming : true)
		.filter((dog) => hideIncoming ? !dog.isIncoming : true)
		.filter((dog) => filterGoodWithDogs ? dog.goodWithDogs === 'yes' : true)
		.filter((dog) => filterGoodWithCats ? dog.goodWithCats === 'yes' : true)
		.filter((dog) => filterGoodWithKids ? dog.goodWithKids === 'yes' : true)
		.filter((dog) => filterAdoptable ? getAdoptionAvailability(dog).available : true)
		.filter((dog) => filterMedical ? isMedicalHold(dog) : true)
		.filter((dog) => stripeFilter === 'all' ? true : dogStripeColor(dog) === stripeFilter)
		.filter((dog) => toSearchText(dog).includes(search.toLowerCase()));
	$: sortedDogs = [...filteredDogs].sort((a, b) => {
		const direction = sortDir === 'asc' ? 1 : -1;
		if (sortKey === 'days') {
			const daysA = daysSince(a.intakeDate, today) ?? 0;
			const daysB = daysSince(b.intakeDate, today) ?? 0;
			return (daysA - daysB) * direction;
		}
		if (sortKey === 'age') {
			const ageA = daysSince(a.dateOfBirth, today) ?? 0;
			const ageB = daysSince(b.dateOfBirth, today) ?? 0;
			return (ageA - ageB) * direction;
		}
		if (sortKey === 'weight') {
			const weightA = typeof a.weightLbs === 'number' ? a.weightLbs : null;
			const weightB = typeof b.weightLbs === 'number' ? b.weightLbs : null;
			if (weightA === null && weightB === null) return a.name.localeCompare(b.name);
			if (weightA === null) return 1;
			if (weightB === null) return -1;
			return (weightA - weightB) * direction;
		}
		return a.name.localeCompare(b.name) * direction;
	});

	function setSort(key: typeof sortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = 'asc';
		}
	}

	function resetDraft() {
		draftDog = {
			id: 'draft',
			name: '',
			breed: '',
			sex: 'unknown',
			intakeDate: today,
			originalIntakeDate: today,
			reentryDates: [],
			leftShelterDate: null,
			dateOfBirth: today,
			weightLbs: null,
			foodType: 'Normal',
			foodAmount: '',
			dietaryNotes: '',
			photoUrl: null,
			hasOwnFood: false,
			allergyTypes: [],
			transitionToHills: null,
			origin: '',
			markings: '',
			hiddenComments: '',
			description: '',
			warningNotes: '',
			holdNotes: '',
			pottyTrained: 'unknown',
			goodWithDogs: 'unknown',
			goodWithCats: 'unknown',
			goodWithKids: 'unknown',
			goodWithElderly: 'unknown',
			goodOnLead: 'unknown',
			goodTraveller: 'unknown',
			crateTrained: 'unknown',
			idealHome: '',
			energyLevel: 'unknown',
			outdoorKennelAssignment: '',
			microchipDate: null,
			healthProblems: '',
			lastBathDate: null,
			lastBathBy: null,
			lastDayTripDate: null,
			isOutOnDayTrip: false,
			currentDayTripStartedAt: null,
			surgeryDate: null,
			surgeryRestDays: null,
			lastSurgeryDate: null,
			fortifloraDate: null,
			fortifloraDays: null,
			fortifloraTime: null,
			isMicrochipped: false,
			isFixed: false,
			fixedDate: null,
			isVaccinated: false,
			vaccineCount: 0,
			vaccinatedDate: null,
			dayTripStatus: 'eligible',
			dayTripIneligibleReason: null,
			dayTripManagerOnlyReason: null,
			dayTripNotes: null,
			handlingLevel: 'volunteer',
			inFoster: false,
			isolationStatus: 'none',
			isolationReason: null,
			isolationUntilDate: null,
			status: 'active',
			createdAt: today,
			updatedAt: today
		};
		formValid = true;
	}

	$: if ($syncVersion > 0) void refreshDogs();

	async function refreshDogs(forceDogs = true) {
		loading = true;
		failedPhotos = new Set();
		const [dogRows, playgroupRows, colorsRes] = await Promise.all([
			forceDogs ? refreshDogStore() : ensureDogsLoaded(),
			listPlaygroupSessions(),
			fetch('/api/sheets/dog-colors').then(r => r.ok ? r.json() : {}).catch(() => ({}))
		]);
		lastPlaygroupByDogId = buildLastPlaygroupMap(playgroupRows);
		loading = false;

		// Sync sheet colors into each dog's single color field (only on a real sheet change).
		const sheet = colorsRes as Record<string, 'green' | 'yellow' | 'red'>;
		const colorChanges = await syncSheetColorsToDogs(dogRows, sheet);

		// Auto-clear awaitingEvaluation once, the first time a dog appears on the DT Numbers
		// sheet (any color). `evaluationAutoCleared` guards it so a later MANUAL re-check of
		// awaitingEvaluation is respected and not cleared again.
		const evaluated = dogRows.filter((d) => {
			if (!d.awaitingEvaluation || d.evaluationAutoCleared) return false;
			const key = d.name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
			return Boolean(sheet[key]);
		});
		if (evaluated.length > 0) {
			await Promise.all(evaluated.map((d) => updateDog(d.id, { awaitingEvaluation: false, evaluationAutoCleared: true })));
		}

		// Apply both side effects to the shared store so every page sees them.
		for (const [id, color] of colorChanges) {
			patchDogInStore(id, { manualTripColor: color, lastSheetColor: color });
		}
		for (const d of evaluated) {
			patchDogInStore(d.id, { awaitingEvaluation: false, evaluationAutoCleared: true });
		}
	}


	async function handleAddDog() {
		if (!draftDog.name.trim()) {
			toast.error('Dog name is required.');
			return;
		}
		if (!formValid) {
			toast.error('Fix the surgery date before saving.');
			return;
		}
		saving = true;
		try {
			const { id, createdAt, updatedAt, ...payload } = draftDog;
			await createDog({
				...payload,
				name: draftDog.name.trim()
			});
			toast.success('Dog added.');
			showAddModal = false;
			await refreshDogs();
		} catch (error) {
			console.error(error);
			toast.error('Unable to add dog.');
		} finally {
			saving = false;
		}
	}

	function getTripEligibility(dog: Dog): TripEligibility {
		return checkDayTripEligibility(
			dog.intakeDate,
			dog.isVaccinated,
			dog.isFixed,
			dog.dayTripStatus,
			dog.isolationStatus,
			dog.dayTripIneligibleReason,
			dog.dayTripManagerOnlyReason,
			dog.dayTripNotes,
			dog.handlingLevel,
			dog.surgeryDate,
			dog.surgeryRestDays,
			dog.awaitingEvaluation,
			role,
			today,
			dog.dateOfBirth,
			dog.vaccineCount,
			dog.vaccinesOutstanding,
			dog.dayTripPuppyOverride
		);
	}

	async function handleTripToggle(dog: Dog) {
		const eligibility = getTripEligibility(dog);
		if (dog.isOutOnDayTrip) {
			await setDogTripStatus(dog.id, false);
			toast.success(`${dog.name} marked as returned.`);
		} else {
			if (!eligibility.eligible) {
				toast.error(eligibility.reasons[0] ?? `${dog.name} is not eligible for day trips.`);
				return;
			}
			await setDogTripStatus(dog.id, true);
			toast.success(`${dog.name} marked as out on day trip.`);
		}
		await refreshDogs();
	}

	async function handleLogBath(dog: Dog) {
		if (!bathEligible(dog.surgeryDate, today)) {
			toast.error('Baths are blocked for 10 days after surgery.');
			return;
		}
		await logBath(dog.id);
		toast.success(`Bath logged for ${dog.name}.`);
		await refreshDogs();
	}

	async function handleReturnDog(dog: Dog) {
		await returnDog(dog.id);
		toast.success(`${dog.name} returned to active roster.`);
		await refreshDogs();
	}

	function openAddModal() {
		resetDraft();
		showAddModal = true;
	}

	function sortArrow(key: typeof sortKey) {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? ' ↑' : ' ↓';
	}


	function shouldIgnoreCardNav(target: EventTarget | null) {
		const element = target instanceof HTMLElement ? target : null;
		return !!element?.closest('a,button,input,select,textarea,label,summary,details');
	}

	function openDogProfile(dogId: string) {
		goto(`/dogs/${dogId}`);
	}

	function handleCardClick(event: MouseEvent, dogId: string) {
		if (shouldIgnoreCardNav(event.target)) return;
		openDogProfile(dogId);
	}

	function handleCardKeydown(event: KeyboardEvent, dogId: string) {
		if (shouldIgnoreCardNav(event.target)) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		openDogProfile(dogId);
	}

	let dismissedItems: Record<string, Set<string>> = {};

	function isItemDismissed(dogId: string, label: string): boolean {
		return dismissedItems[dogId]?.has(label) ?? false;
	}

	function toggleDismissItem(dogId: string, label: string) {
		const current = new Set(dismissedItems[dogId] ?? []);
		if (current.has(label)) {
			current.delete(label);
		} else {
			current.add(label);
		}
		dismissedItems = { ...dismissedItems, [dogId]: current };
	}
</script>

<svelte:head>
	<title>Dogs | Cache Humane Society</title>
</svelte:head>

<section class="marker-dogs" aria-label="Dogs board">
	<div class="dogs-grid-board">
		<section class="dogs-control-strip" aria-label="Roster controls">
			<div class="dogs-summary-row">
				<div class="dogs-title-wrap">
					<div class="dogs-count-chips typewriter">
						<span class="dogs-count-chip chip-shelter">In shelter: {shelterCount}</span>
						<span class="dogs-count-chip chip-foster">In foster: {fosterCount}</span>
						{#if incomingCount > 0}
							<span class="dogs-count-chip chip-incoming">Incoming: {incomingCount}</span>
						{/if}
					</div>
				</div>
				<div class="dogs-header-actions">
					{#if !$authProfile}
						<label class="role-selector typewriter">
							role
							<select bind:value={$localRole}>
								<option value="admin">Admin</option>
								<option value="manager">Manager</option>
								<option value="staff">Staff</option>
								<option value="volunteer">Volunteer</option>
							</select>
						</label>
					{/if}
					<button
						class="board-control-btn board-control-btn-fill"
						on:click={openAddModal}
						disabled={!canEdit}
					>
						<span class="add-plus" aria-hidden="true">+</span>
						<span>add dog</span>
					</button>
				</div>
			</div>
			<div class="dogs-search-wrap">
				<label class="control-label typewriter" for="dog-search">search</label>
				<input
					id="dog-search"
					placeholder="name"
					class="dogs-search-input typewriter"
					bind:value={search}
				/>
			</div>
			<details class="dogs-filters-drawer" open>
				<summary class="dogs-filters-summary typewriter">filters and sort</summary>
				<div class="dogs-filters-body">
						<div class="dogs-sort-group" role="group" aria-label="Sort dogs">
							<span class="control-label typewriter">sort</span>
							<button
								class={`sort-chip ${sortKey === 'days' ? 'sort-chip-active' : ''}`}
								on:click={() => setSort('days')}
							>
								shelter time {sortArrow('days')}
							</button>
							<button
								class={`sort-chip ${sortKey === 'age' ? 'sort-chip-active' : ''}`}
								on:click={() => setSort('age')}
							>
								age {sortArrow('age')}
							</button>
							<button
								class={`sort-chip ${sortKey === 'weight' ? 'sort-chip-active' : ''}`}
								on:click={() => setSort('weight')}
							>
								small to big {sortArrow('weight')}
							</button>
							<button
								class={`sort-chip ${sortKey === 'name' ? 'sort-chip-active' : ''}`}
								on:click={() => setSort('name')}
							>
								name {sortArrow('name')}
							</button>
						</div>
					<div class="archived-filter-group">
						<label class="archived-toggle typewriter">
							<input type="checkbox"
								checked={viewMode === 'all'}
								on:change={(e) => viewMode = e.currentTarget.checked ? 'all' : 'active'}
							/>
							show archived
						</label>
						<button
							class={`sort-chip ${viewMode === 'archived' ? 'sort-chip-active' : ''}`}
							on:click={() => viewMode = viewMode === 'archived' ? 'active' : 'archived'}
						>
							archived only
						</button>
					</div>
				<div class="archived-filter-group">
					<button
						class={`sort-chip ${fosterOnly ? 'sort-chip-active' : ''}`}
						on:click={() => (fosterOnly = !fosterOnly)}
					>
						foster only
					</button>
					<button
						class={`sort-chip ${incomingOnly ? 'sort-chip-active' : ''}`}
						on:click={() => (incomingOnly = !incomingOnly)}
					>
						incoming only
					</button>
					<button
						class={`sort-chip ${hideIncoming ? 'sort-chip-active' : ''}`}
						on:click={() => (hideIncoming = !hideIncoming)}
					>
						hide incoming
					</button>
				</div>
				<div class="archived-filter-group" role="group" aria-label="Quick filters">
					<button
						class={`sort-chip ${filterMedical ? 'sort-chip-active' : ''}`}
						on:click={() => (filterMedical = !filterMedical)}
					>
						medical
					</button>
				</div>
				<div class="archived-filter-group" role="group" aria-label="Filter by compatibility">
					<span class="control-label typewriter">good with</span>
					<button
						class={`sort-chip ${filterGoodWithDogs ? 'sort-chip-active' : ''}`}
						on:click={() => (filterGoodWithDogs = !filterGoodWithDogs)}
					>dogs</button>
					<button
						class={`sort-chip ${filterGoodWithCats ? 'sort-chip-active' : ''}`}
						on:click={() => (filterGoodWithCats = !filterGoodWithCats)}
					>cats</button>
					<button
						class={`sort-chip ${filterGoodWithKids ? 'sort-chip-active' : ''}`}
						on:click={() => (filterGoodWithKids = !filterGoodWithKids)}
					>kids</button>
				</div>
				<div class="archived-filter-group">
					<button
						class={`sort-chip ${filterAdoptable ? 'sort-chip-active' : ''}`}
						on:click={() => (filterAdoptable = !filterAdoptable)}
					>adoptable only</button>
				</div>
				<div class="archived-filter-group" role="group" aria-label="Filter by status color">
					<span class="control-label typewriter">status</span>
					<button
						class={`sort-chip stripe-chip ${stripeFilter === 'all' ? 'sort-chip-active' : ''}`}
						on:click={() => (stripeFilter = 'all')}
					>all</button>
					<button
						class={`sort-chip stripe-chip stripe-chip-green ${stripeFilter === 'green' ? 'sort-chip-active' : ''}`}
						on:click={() => (stripeFilter = stripeFilter === 'green' ? 'all' : 'green')}
					><span class="stripe-dot stripe-dot-green"></span> green</button>
					<button
						class={`sort-chip stripe-chip stripe-chip-yellow ${stripeFilter === 'yellow' ? 'sort-chip-active' : ''}`}
						on:click={() => (stripeFilter = stripeFilter === 'yellow' ? 'all' : 'yellow')}
					><span class="stripe-dot stripe-dot-yellow"></span> yellow</button>
					<button
						class={`sort-chip stripe-chip stripe-chip-red ${stripeFilter === 'red' ? 'sort-chip-active' : ''}`}
						on:click={() => (stripeFilter = stripeFilter === 'red' ? 'all' : 'red')}
					><span class="stripe-dot stripe-dot-red"></span> red</button>
				</div>
			</div>
			</details>
		</section>

		<section class="dogs-zone dogs-zone-list">
			{#if loading}
				<div class="dogs-state marker-line marker-muted">loading dogs...</div>
			{:else if sortedDogs.length === 0}
				<div class="dogs-state marker-line marker-muted">no dogs match filters</div>
			{:else}
				<div class="dogs-card-grid">
					{#each sortedDogs as dog}
						{@const tripEligibility = getTripEligibility(dog)}
					{@const expandedPillType = expandedPill.get(dog.id) ?? null}
						{@const bathDue = isBathDue(dog, today)}
						{@const effectiveHandlingLevel = dogHandlingLevel(dog)}
						{@const lastPlaygroupDate = lastPlaygroupByDogId[dog.id] ?? null}
						{@const cardPendingItems = pendingItems(dog, tripEligibility, bathDue, lastPlaygroupDate, today)}
						<div
							class={`dog-card dog-card-clickable ${dog.isOutOnDayTrip ? 'dog-card-trip' : ''} ${dog.inFoster ? 'dog-card-foster' : ''} ${dog.isIncoming ? 'dog-card-incoming' : ''} ${dog.status !== 'active' ? 'dog-card-archived' : ''}`}
							role="link"
							tabindex="0"
							aria-label={`Open ${dog.name} profile`}
							on:click={(event) => handleCardClick(event, dog.id)}
							on:keydown={(event) => handleCardKeydown(event, dog.id)}
						>
							<div class="dog-card-body">
								<header class="dog-card-header">
									<div class="card-photo-wrap">
										<div class="card-photo-frame">
											<div class={`card-photo-stripe card-stripe-${dogStripeColor(dog)}`} aria-hidden="true"></div>
											{#if dog.photoUrl && !failedPhotos.has(dog.id)}
												<img
													class="card-photo-img"
													src={dog.photoUrl}
													alt=""
													use:retryablePhoto={{ src: dog.photoUrl, context: 'dogs-list', dogId: dog.id, onFail: () => { failedPhotos = new Set([...failedPhotos, dog.id]); } }}
												/>
											{:else}
												<span class="card-photo-initial" aria-hidden="true">{dog.name[0].toUpperCase()}</span>
											{/if}
										</div>
									</div>
									<div class="dog-card-headline">
										<a class="dog-name-link" href={`/dogs/${dog.id}`}>{dog.name}</a>
										{#if dog.breed}<p class="dog-breed">{dog.breed}</p>{/if}
										<p class="dog-kennel typewriter">kennel: {dog.outdoorKennelAssignment || 'unassigned'}</p>
									</div>
									{#if dog.status !== 'active'}
										<span class="days-tag days-tag-archived typewriter">Adopted</span>
									{:else}
										<span class="days-tag typewriter">{daysSince(dog.intakeDate, today) ?? 0} days</span>
									{/if}
								</header>
								<div class="card-status-icons" role="group" aria-label="Dog status">
									<button class={`card-status-pill ${handlingColorClass(effectiveHandlingLevel)} ${expandedPillType === 'handling' ? 'pill-active' : ''}`} on:click|stopPropagation={() => togglePill(dog.id, 'handling')} aria-pressed={expandedPillType === 'handling'} aria-label="Handling level">
										<span class="card-pill-icon" aria-hidden="true">
											<svg viewBox="0 0 24 24" fill="none">
												{#if effectiveHandlingLevel === 'manager_only'}
													<path d="M4 18h16l-1.2-8.6-4.8 3.8L12 7l-2 6.2-4.8-3.8z"></path>
												{:else if effectiveHandlingLevel === 'staff_only'}
													<rect x="4.2" y="5.3" width="15.6" height="13.4" rx="2.2"></rect>
													<path d="M8.4 10.1h7.2"></path>
													<path d="M8.4 13.8h7.2"></path>
												{:else}
													<path d="M12 20.2s-6.4-4.1-8.4-7c-2-2.8-.9-6.6 2.2-7.2 2-.4 3.3.7 4.2 1.9.9-1.2 2.2-2.3 4.2-1.9 3.1.6 4.2 4.4 2.2 7.2-2 2.9-8.4 7-8.4 7z"></path>
												{/if}
											</svg>
										</span>
									</button>
									<button class={`card-status-pill ${adoptionColorClass(dog)} ${expandedPillType === 'adoption' ? 'pill-active' : ''}`} on:click|stopPropagation={() => togglePill(dog.id, 'adoption')} aria-pressed={expandedPillType === 'adoption'} aria-label="Adoption status">
										<span class="card-pill-icon" aria-hidden="true">
											<svg viewBox="0 0 24 24" fill="none">
												<path d="M3.5 10.2 12 3l8.5 7.2"></path>
												<path d="M5.5 9.3V20h13V9.3"></path>
												<path d="M10 20v-5.3h4V20"></path>
											</svg>
										</span>
									</button>
									<button class={`card-status-pill ${tripColorClass(tripEligibility.status)} ${expandedPillType === 'trip' ? 'pill-active' : ''}`} on:click|stopPropagation={() => togglePill(dog.id, 'trip')} aria-pressed={expandedPillType === 'trip'} aria-label="Day trip status">
										<span class="card-pill-icon" aria-hidden="true">
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
								</div>
								{#if expandedPillType}
									<p class={`card-pill-reason ${expandedPillType === 'handling' ? handlingColorClass(effectiveHandlingLevel) : expandedPillType === 'adoption' ? adoptionColorClass(dog) : tripColorClass(tripEligibility.status)}`}>
										{#if expandedPillType === 'handling'}{handlingLabel(effectiveHandlingLevel)}
										{:else if expandedPillType === 'adoption'}{adoptionLabel(dog)}
										{:else}{tripLabel(tripEligibility.status, dog.dayTripNotes, dog.handlingLevel === 'manager_only')}
										{/if}
									</p>
								{/if}

								<div class="card-facts">
									<p><span>Age</span><strong class="card-fact-value">{formatAge(dog.dateOfBirth, today)}</strong></p>
									<p><span>Sex</span><strong class="card-fact-value">{sexLabel(dog.sex)}</strong></p>
								</div>

								<details class="card-kennel-section">
									<summary>Meet & Greet</summary>
									<div class="kennel-section-body">
										<div class="card-facts">
											<p><span>Origin</span><strong class="card-fact-value">{dog.origin || 'Unknown'}</strong></p>
											<p><span>Potty Trained</span><strong class="card-fact-value">{pottyLabel(dog.pottyTrained)}</strong></p>
											<p><span>Good w/ Dogs</span><strong class="card-fact-value">{compatibilityLabel(dog.goodWithDogs)}</strong></p>
											<p><span>Good w/ Cats</span><strong class="card-fact-value">{compatibilityLabel(dog.goodWithCats)}</strong></p>
											<p><span>Good w/ Kids</span><strong class="card-fact-value">{compatibilityLabel(dog.goodWithKids)}</strong></p>
											<p><span>Energy</span><strong class="card-fact-value">{energyLabel(dog.energyLevel)}</strong></p>
											<p><span>Best Home</span><strong class="card-fact-value">{dog.idealHome || 'Not documented'}</strong></p>
										</div>
									</div>
								</details>

								<details class="card-kennel-section">
									<summary>
										<span class="summary-label">Pending items <span class="dog-details-count">{cardPendingItems.length}</span></span>
									</summary>
									<div class="kennel-section-body">
										{#if cardPendingItems.length === 0}
											<p class="next-action-empty">No pending items.</p>
										{:else}
											<ul class="next-action-list">
												{#each cardPendingItems as item}
													{@const dismissed = isItemDismissed(dog.id, item.label)}
													<li class={`next-action-item ${actionItemClass(item.tone)} ${dismissed ? 'next-action-dismissed' : ''}`}>
														<button
															class={`pending-check-btn ${dismissed ? 'pending-check-done' : ''}`}
															on:click|stopPropagation={() => toggleDismissItem(dog.id, item.label)}
															aria-label={dismissed ? 'Mark as pending' : 'Mark as done'}
															aria-pressed={dismissed}
														>
															{#if dismissed}
																<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
																	<polyline points="3,8.5 6.5,12 13,4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
																</svg>
															{/if}
														</button>
														<span class={`pending-item-label ${dismissed ? 'pending-item-done' : ''}`}>{item.label}</span>
														{#if item.action === 'log_bath' && !dismissed}
															<button
																class="pending-inline-btn"
																on:click|stopPropagation={() => handleLogBath(dog)}
															>
																log bath
															</button>
														{/if}
													</li>
												{/each}
											</ul>
										{/if}
									</div>
								</details>

								<div class="dog-status-list">
									{#if isSurgeryToday(dog.surgeryDate, today)}
										<span class="status-pill status-pill-yellow">Surgery Today</span>
									{/if}
									{#if dog.isOutOnDayTrip}
										<span class="status-pill status-pill-blue">Out Right Now</span>
									{/if}
									{#if dog.inFoster}
										<span class="status-pill status-pill-foster">In Foster</span>
									{/if}
								</div>

								<div class="dog-actions">
									{#if dog.status !== 'active'}
										<button
											class="action-btn action-btn-return"
											on:click|stopPropagation={() => handleReturnDog(dog)}
											disabled={!canEdit}
										>
											return to shelter
										</button>
									{:else}
										<button
											class="action-btn"
											on:click={() => handleTripToggle(dog)}
											disabled={!dog.isOutOnDayTrip && !tripEligibility.eligible}
										>
											{dog.isOutOnDayTrip ? 'mark returned' : 'send out'}
										</button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</section>

<Modal open={showAddModal} title="Add Dog" placement="top" onClose={() => (showAddModal = false)}>
	<div class="add-dog-form-body">
		<DogForm
			bind:value={draftDog}
			on:change={(event) => {
				draftDog = event.detail.value;
				formValid = event.detail.valid;
			}}
		/>
	</div>
	<div slot="footer" class="modal-actions">
		<button class="modal-btn" on:click={() => (showAddModal = false)}>
			Cancel
		</button>
		<button
			class="modal-btn modal-btn-fill"
			on:click={handleAddDog}
			disabled={saving}
		>
			{saving ? 'Saving...' : 'Add Dog'}
		</button>
	</div>
</Modal>

<style>
	.marker-dogs {
		width: 100%;
	}

	.dogs-grid-board {
		display: grid;
		gap: 0.58rem;
	}

	.marker-line {
		margin: 0;
		font-family: var(--font-ui);
		font-weight: 600;
		letter-spacing: 0.01em;
		line-height: 1.2;
		text-shadow: none;
	}

	.marker-blue-line {
		color: #394758;
	}

	.marker-muted {
		color: #6d7683 !important;
		font-weight: 600;
		text-shadow: none;
	}

	.dogs-summary-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.58rem;
	}

	.dogs-title-wrap {
		display: grid;
		gap: 0.12rem;
		flex: 1 1 auto;
		min-width: 0;
	}

	.dogs-board-sub {
		margin: 0;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.45rem, 2.4vw, 2.05rem);
		font-weight: 500;
		letter-spacing: 0.01em;
		line-height: 1.04;
		color: #303948;
	}

	.incoming-count-badge {
		display: inline-block;
		margin-left: 0.5rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #d6e6f5;
		color: #2a5a82;
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		vertical-align: middle;
	}

	.dogs-count-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}

	.dogs-count-chip {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.18rem 0.6rem;
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 700;
		border: 1.5px solid;
	}

	.chip-shelter {
		background: #e8f4fc;
		color: #016aa5;
		border-color: #7ec2e8;
	}

	.chip-foster {
		background: #f0ebf7;
		color: #6b2e80;
		border-color: #c4a3d8;
	}

	.chip-incoming {
		background: #fff8e5;
		color: #7a6200;
		border-color: #e3cf80;
	}

	.dogs-header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		justify-content: flex-end;
	}

	.role-selector {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 1.96rem;
		padding: 0.24rem 0.56rem;
		border: 1px solid #d8e0ea;
		border-radius: 0.52rem;
		background: #f7f9fc;
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #596374;
	}

	.role-selector select {
		border: 1px solid #d5deea;
		border-radius: 0.34rem;
		background: #ffffff;
		padding: 0.18rem 0.26rem;
		font-size: 0.68rem;
		font-weight: 700;
		color: #2d3b4f;
	}

	.board-control-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.32rem;
		min-height: 1.96rem;
		border: 1px solid #cad7e8;
		border-radius: 0.58rem;
		padding: 0.28rem 0.66rem;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #2f435c;
		background: #f4f8fd;
		text-decoration: none;
	}

	.add-plus {
		font-size: 1.1rem;
		line-height: 0.8;
		font-weight: 800;
	}

	.board-control-btn:hover:not(:disabled) {
		background: #eaf2fb;
	}

	.board-control-btn-fill {
		border-color: #2e84b7;
		background: linear-gradient(180deg, #2f97d1 0%, #2b82b4 100%);
		color: #ffffff;
	}

	.board-control-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.dogs-control-strip {
		display: grid;
		gap: 0.5rem;
		padding: 0.08rem;
	}

	.dogs-search-wrap {
		display: grid;
		gap: 0.14rem;
	}

	.control-label {
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5f6978;
	}

	.dogs-search-input {
		width: 100%;
		min-height: 2rem;
		border: 1px solid #d8e0ea;
		border-radius: 0.54rem;
		padding: 0.12rem 0.64rem;
		font-size: 0.86rem;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: 0.02em;
		color: #2d3b4f;
		background: #ffffff;
	}

	.dogs-filters-drawer {
		border: 1px solid #d8e0ea;
		border-radius: 0.64rem;
		background: #f7f9fc;
	}

	.dogs-filters-summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.38rem 0.54rem;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #45556a;
	}

	.dogs-filters-summary::-webkit-details-marker {
		display: none;
	}

	.dogs-filters-summary::after {
		content: '+';
		font-family: var(--font-typewriter);
		font-weight: 700;
	}

	.dogs-filters-drawer[open] .dogs-filters-summary::after {
		content: '-';
	}

	.dogs-filters-body {
		display: none;
		padding: 0 0.54rem 0.54rem;
	}

	.dogs-filters-drawer[open] .dogs-filters-body {
		display: grid;
		gap: 0.42rem;
	}

	.dogs-sort-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.sort-chip {
		min-height: 1.88rem;
		border: 1px solid #d2dbe8;
		border-radius: 0.52rem;
		background: #ffffff;
		padding: 0.26rem 0.58rem;
		font-family: var(--font-ui);
		font-size: 0.63rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #2f425b;
	}

	.sort-chip-active {
		border-color: #2e84b7;
		background: #e8f3ff;
		color: #1e4f72;
	}

	.stripe-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.stripe-dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.stripe-dot-green { background: #67bf90; }
	.stripe-dot-yellow { background: #e8bb62; }
	.stripe-dot-red { background: #e57470; }

	.archived-filter-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.archived-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
		min-height: 1.84rem;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #4a5b70;
		cursor: pointer;
	}

	.archived-toggle input {
		width: 1rem;
		height: 1rem;
		accent-color: #2e84b7;
	}

	.dogs-zone {
		padding: 0.08rem;
	}

	.dogs-state {
		margin-top: 0;
		padding: 0.72rem 0.74rem;
		border: 1px solid #d4dde8;
		border-radius: 0.7rem;
		background: #f8fbff;
		font-size: 0.88rem;
	}

	.dogs-card-grid {
		margin-top: 0;
		display: grid;
		gap: 0.72rem;
	}

	.dog-card {
		border: 1px solid #d3dbe6;
		border-radius: 0.92rem;
		background: linear-gradient(180deg, #ffffff 0%, #f9fbfe 100%);
		display: flex;
		flex-direction: column;
		box-shadow: 0 8px 18px rgba(28, 50, 71, 0.06);
		overflow: hidden;
	}

	.dog-card-clickable {
		cursor: pointer;
		transition: transform 130ms ease, box-shadow 130ms ease;
	}

	.dog-card-clickable:hover {
		transform: translateY(-1px);
		box-shadow: 0 12px 22px rgba(28, 50, 71, 0.1);
	}

	.dog-card-clickable:focus-visible {
		outline: 3px solid #2e84b7;
		outline-offset: 2px;
	}

	.dog-card-trip {
		background: linear-gradient(180deg, #f2f8ff 0%, #ebf4ff 100%);
	}

	.dog-card-foster {
		background: linear-gradient(180deg, #fef6ea 0%, #fbf0e3 100%);
	}

	.dog-card-incoming {
		background: linear-gradient(180deg, #eaf1f9 0%, #e2ecf6 100%);
	}

	.dog-card-archived {
		opacity: 0.55;
		background: linear-gradient(180deg, #f5f7fa 0%, #f0f3f7 100%);
		filter: grayscale(0.4);
	}

	.dog-card-body {
		padding: 0.78rem;
		display: grid;
		gap: 0.58rem;
	}

	.dog-card-header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.56rem;
		align-items: start;
	}

	.card-photo-wrap {
		flex-shrink: 0;
		padding-top: 0.1rem;
	}

	.card-photo-frame {
		position: relative;
		width: 5rem;
		height: 6.67rem;
		aspect-ratio: 3 / 4;
		border: 1px solid #d4deeb;
		border-radius: 0.5rem;
		background-color: #eef3fb;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.card-photo-img {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
	}

	.card-photo-initial {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 1.1rem;
		text-transform: uppercase;
		color: #7e8fa3;
	}

	.card-photo-stripe {
		position: absolute;
		top: 0.24rem;
		right: -0.9rem;
		width: 2.8rem;
		height: 0.42rem;
		border-radius: 999px;
		transform: rotate(45deg);
		pointer-events: none;
		z-index: 2;
	}


	.card-stripe-green {
		background: linear-gradient(135deg, #79cfa1 0%, #67bf90 100%);
	}

	.card-stripe-yellow {
		background: linear-gradient(135deg, #f2cb7b 0%, #e8bb62 100%);
	}

	.card-stripe-red {
		background: linear-gradient(135deg, #e04848 0%, #c93333 100%);
	}

	.dog-name-link {
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.35rem, 2vw, 1.82rem);
		font-weight: 800;
		letter-spacing: -0.01em;
		color: #173a58;
		text-decoration: none;
		line-height: 1;
	}

	.dog-name-link:hover {
		text-decoration: underline;
	}

	.dog-kennel {
		margin: 0.13rem 0 0;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5c697b;
	}

	.dog-breed {
		margin: 0.14rem 0 0;
		font-size: 0.74rem;
		font-weight: 600;
		color: #5a6d84;
		line-height: 1.2;
	}

	.days-tag {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 1.76rem;
		border: 1px solid #d6dfe9;
		border-radius: 999px;
		padding: 0.16rem 0.56rem;
		background: #f1f5fa;
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #47586e;
		white-space: nowrap;
	}

	.days-tag-archived {
		background: #eef0f3;
		border-color: #c8cfd8;
		color: #6b7a8a;
	}

	.dog-fact-grid {
		display: grid;
		gap: 0.3rem;
	}

	/* Card status icons (whiteboard-pill style) */
	.card-status-icons {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0.3rem 0.4rem;
	}

	.card-status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.44rem;
		font-size: 0.74rem;
		font-weight: 700;
		line-height: 1.2;
		color: #2f4a66;
		cursor: pointer;
		background: none;
		border: none;
		padding: 0;
	}

	.card-pill-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		min-width: 1.9rem;
		border-radius: 999px;
		border: 1.5px solid #b9c7d8;
		background: #f7faff;
		color: currentColor;
		flex-shrink: 0;
	}

	.card-pill-icon svg {
		width: 1.1rem;
		height: 1.1rem;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
		fill: none;
	}

	.card-status-pill.pill-active .card-pill-icon {
		border-color: currentColor;
	}

	.card-pill-reason {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 600;
	}

	.card-pill-green {
		color: #2f7f59;
	}

	.card-pill-yellow {
		color: #a77022;
	}

	.card-pill-red {
		color: #b94a46;
	}

	.card-pill-blue {
		color: #1e4f72;
	}

	.card-pill-purple {
		color: #4c2e8a;
	}

	/* Card facts (kennel-facts style) */
	.card-facts {
		display: grid;
		gap: 0.14rem;
		font-size: 0.82rem;
		line-height: 1.44;
		color: #27415d;
		font-family: var(--font-ui);
	}

	.card-facts p {
		margin: 0;
		display: grid;
		grid-template-columns: minmax(5.2rem, 6.8rem) minmax(0, 1fr);
		gap: 0.36rem;
		align-items: baseline;
		padding: 0.18rem 0;
		border-top: 1px solid #e5ecf5;
	}

	.card-facts p:first-child {
		border-top: none;
		padding-top: 0;
	}

	.card-facts span {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #5a7189;
	}

	.card-fact-value {
		font-weight: 700;
		color: #1d3854;
		font-size: 0.82rem;
	}

	.card-facts-inset {
		margin-top: 0;
	}

	/* Care details drawer (kennel-section style) */
	.card-kennel-section {
		border: 1px solid #dde6f1;
		border-radius: 0.82rem;
		background: #ffffff;
		box-shadow: 0 1px 2px rgba(16, 45, 70, 0.05), 0 1px 0 rgba(255, 255, 255, 0.8) inset;
		overflow: hidden;
	}

	.card-kennel-section > summary {
		list-style: none;
		cursor: pointer;
		padding: 0.52rem 0.7rem;
		font-size: 0.76rem;
		font-weight: 700;
		color: #2f4a66;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		transition: background-color 120ms ease;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.card-kennel-section > summary::-webkit-details-marker {
		display: none;
	}

	.card-kennel-section > summary:hover {
		background: #f8fbff;
	}

	.card-kennel-section > summary::after {
		content: '';
		width: 0.42rem;
		height: 0.42rem;
		border-right: 2px solid #68839c;
		border-bottom: 2px solid #68839c;
		transform: rotate(45deg) translateY(-0.08rem);
		transition: transform 120ms ease;
		flex: 0 0 auto;
	}

	.card-kennel-section[open] > summary {
		border-bottom: 1px solid #e6edf6;
		background: #f7fbff;
	}

	.card-kennel-section[open] > summary::after {
		transform: rotate(-135deg) translateY(-0.02rem);
	}

	.kennel-section-body {
		padding: 0.54rem 0.7rem 0.64rem;
		display: grid;
		gap: 0.56rem;
	}

	.summary-label {
		display: inline-flex;
		align-items: center;
		gap: 0.36rem;
	}

	.dog-details-count {
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: #607287;
		text-transform: none;
	}

	.card-meet-facts {
		display: grid;
		gap: 0.2rem;
	}

	.card-sub-title {
		margin: 0;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5a7189;
	}

	.next-step-card {
		display: grid;
		gap: 0.2rem;
	}

	.next-action-list {
		margin: 0.22rem 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.28rem;
	}

	.next-action-item {
		margin: 0;
		padding: 0.26rem 0.36rem 0.26rem 0.28rem;
		border: 1px solid #c6d0dc;
		border-radius: 0.44rem;
		font-size: 0.72rem;
		line-height: 1.25;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 0.38rem;
	}

	.next-action-dismissed {
		opacity: 0.52;
	}

	.pending-check-btn {
		flex-shrink: 0;
		width: 1.15rem;
		height: 1.15rem;
		border: 1.8px solid currentColor;
		border-radius: 0.26rem;
		background: rgba(255, 255, 255, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		cursor: pointer;
		transition: background 100ms ease, border-color 100ms ease;
	}

	.pending-check-btn svg {
		width: 0.82rem;
		height: 0.82rem;
	}

	.pending-check-done {
		background: currentColor;
	}

	.pending-check-done svg polyline {
		stroke: #ffffff;
	}

	.pending-item-label {
		flex: 1 1 0;
		min-width: 0;
	}

	.pending-item-done {
		text-decoration: line-through;
	}

	.pending-inline-btn {
		min-height: 1.72rem;
		border: 1px solid #d3dbe8;
		border-radius: 0.42rem;
		padding: 0.22rem 0.56rem;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #2d425b;
		background: #ffffff;
	}

	.pending-inline-btn:hover {
		background: #ecf3fb;
	}

	.next-action-empty {
		margin: 0.22rem 0 0;
		font-size: 0.74rem;
		color: #5a6d84;
	}

	.next-action-ready {
		background: #e1f4e8;
		color: #1f5f43;
	}

	.next-action-blocked {
		background: #f9e6e4;
		color: #8f2f2b;
	}

	.next-action-info {
		background: #e6f1fd;
		color: #264b73;
	}

	.dog-status-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.32rem;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		border: 1px solid #d3dce8;
		border-radius: 999px;
		padding: 0.28rem 0.62rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: #2f435c;
	}

	.status-pill-green {
		background: #e1f4e8;
		border-color: #b8dfc5;
		color: #1a5e35;
	}

	.status-pill-yellow {
		background: #f9f0d9;
		border-color: #e4cfa0;
		color: #7a5a1c;
	}

	.status-pill-red {
		background: #f9e6e4;
		border-color: #e8b9b5;
		color: #7a2828;
	}

	.status-pill-blue {
		background: #e6f1fd;
		border-color: #b8d8f4;
		color: #1e4f72;
	}

	.status-pill-purple {
		background: #ede9fe;
		border-color: #cfc4f6;
		color: #4c2e8a;
	}

	.status-pill-foster {
		background: #f8ebdd;
		border-color: #e5cab0;
		color: #7a4a1c;
	}

	.status-alert {
		width: 100%;
		font-size: 0.86rem;
		font-weight: 700;
		line-height: 1.14;
	}

	.dog-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.32rem;
	}

	.action-btn {
		min-height: 1.88rem;
		border: 1px solid #d0daea;
		border-radius: 0.52rem;
		padding: 0.22rem 0.62rem;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #2f435c;
		background: #e9f2fb;
	}

	.action-btn:hover:not(:disabled) {
		background: #dbe8f8;
	}

	.action-btn-return {
		border-color: #c5d9c5;
		color: #2a5c2a;
		background: #edf7ed;
	}

	.action-btn-return:hover:not(:disabled) {
		background: #dff0df;
	}

	.action-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.45rem;
	}

	.add-dog-form-body {
		padding-bottom: 0.3rem;
	}

	.modal-btn {
		min-height: 2rem;
		border: 1px solid #d1dae8;
		border-radius: 0.56rem;
		padding: 0.26rem 0.72rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #2f435c;
		background: #ffffff;
	}

	.modal-btn-fill {
		border-color: #2e84b7;
		background: linear-gradient(180deg, #2f97d1 0%, #2b82b4 100%);
		color: #ffffff;
	}

	.modal-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	@media (min-width: 760px) {
		.dogs-control-strip {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.5rem 0.6rem;
		}

		.dogs-summary-row {
			flex: 0 0 100%;
			align-items: center;
		}

		.dogs-header-actions {
			justify-content: flex-end;
		}

		.board-control-btn {
			min-height: 2rem;
		}

		.dogs-search-wrap {
			flex: 0 0 11rem;
			gap: 0;
		}

		.dogs-search-wrap .control-label {
			display: none;
		}

		.dogs-search-input {
			font-size: 0.82rem;
		}

		.dogs-filters-drawer {
			flex: 1 1 0;
			min-width: 0;
			border: 0;
			background: transparent;
		}

		.dogs-filters-summary {
			display: none;
		}

		/* always show filter body on desktop regardless of open state */
		.dogs-filters-body,
		.dogs-filters-drawer[open] .dogs-filters-body {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.3rem;
			padding: 0;
		}

		/* flatten filter groups so all chips flow in one row */
		.dogs-sort-group,
		.archived-filter-group {
			display: contents;
		}

		.card-kennel-section {
			border-radius: 0.82rem;
		}
	}

	

	@media (min-width: 1320px) {
		.dogs-card-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (max-width: 560px) {
		.dogs-summary-row {
			flex-wrap: wrap;
		}
		.dogs-search-input {
			font-size: 1rem;
		}
	}
</style>
