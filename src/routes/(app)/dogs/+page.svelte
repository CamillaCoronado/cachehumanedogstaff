<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { resolveRole, canEditDogs } from '$lib/utils/permissions';
	import { listDogs, createDog, logBath, startDayTrip, endDayTrip } from '$lib/data/dogs';
	import { listPlaygroupSessions } from '$lib/data/playgroups';
	import type { Dog, PlaygroupSession, UserRole } from '$lib/types';
	import { bathEligible, daysSince, formatAge, isSurgeryToday, checkDayTripEligibility, toDate } from '$lib/utils/dates';
	import Modal from '$lib/components/ui/Modal.svelte';
	import DogForm from '$lib/components/dogs/DogForm.svelte';
	import { energyLabel, compatibilityLabel, pottyLabel, sexLabel } from '$lib/utils/labels';

	type TripEligibility = ReturnType<typeof checkDayTripEligibility>;
	type CardActionTone = 'ready' | 'blocked' | 'info';
	type CardActionItem = {
		label: string;
		tone: CardActionTone;
		priority: number;
		action?: 'log_bath';
	};

	const capacity = 30;
	const BATH_DUE_DAYS = 7;
	const ACTIVITY_WARNING_DAYS = 2;
	const ACTIVITY_DUE_DAYS = 3;
	const today = new Date();

	let dogs: Dog[] = [];
	let lastPlaygroupByDogId: Record<string, Date | null> = {};
	let loading = true;
	let search = '';
	let showArchived = false;
	let sortKey: 'name' | 'days' | 'age' = 'name';
	let sortDir: 'asc' | 'desc' = 'asc';
	let showAddModal = false;
	let draftDog: Dog;
	let formValid = true;
	let saving = false;

	onMount(async () => {
		await refreshDogs();
	});

	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canEdit = canEditDogs(role);
	$: activeCount = dogs.filter((dog) => dog.status === 'active').length;
	$: capacityReached = activeCount >= capacity;
	$: availableSpots = Math.max(0, capacity - activeCount);
	$: filteredDogs = dogs
		.filter((dog) => (showArchived ? true : dog.status === 'active'))
		.filter((dog) => toSearchText(dog).includes(search.toLowerCase()));
	$: sortedDogs = [...filteredDogs].sort((a, b) => {
		const direction = sortDir === 'asc' ? 1 : -1;
		if (sortKey === 'name') {
			return a.name.localeCompare(b.name) * direction;
		}
		if (sortKey === 'days') {
			const daysA = daysSince(a.intakeDate, today) ?? 0;
			const daysB = daysSince(b.intakeDate, today) ?? 0;
			return (daysA - daysB) * direction;
		}
		const ageA = daysSince(a.dateOfBirth, today) ?? 0;
		const ageB = daysSince(b.dateOfBirth, today) ?? 0;
		return (ageA - ageB) * direction;
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
			isMicrochipped: false,
			isFixed: false,
			fixedDate: null,
			isVaccinated: false,
			vaccinatedDate: null,
			dayTripStatus: 'eligible',
			dayTripNotes: null,
			inFoster: false,
			isolationStatus: 'none',
			isolationStartDate: null,
			status: 'active',
			createdAt: today,
			updatedAt: today
		};
		formValid = true;
	}

	async function refreshDogs() {
		loading = true;
		const [dogRows, playgroupRows] = await Promise.all([listDogs(), listPlaygroupSessions()]);
		dogs = dogRows;
		lastPlaygroupByDogId = buildLastPlaygroupMap(playgroupRows);
		loading = false;
	}

	function buildLastPlaygroupMap(sessions: PlaygroupSession[]) {
		const latestByDog: Record<string, Date> = {};
		for (const session of sessions) {
			const sessionDate = toDate(session.date);
			if (!sessionDate) continue;
			for (const dogId of session.dogIds ?? []) {
				if (!dogId) continue;
				const current = latestByDog[dogId];
				if (!current || sessionDate.getTime() > current.getTime()) {
					latestByDog[dogId] = sessionDate;
				}
			}
		}
		return latestByDog;
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
		if (capacityReached) {
			toast.error('Shelter is at capacity (30 dogs).');
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
			dog.dayTripNotes,
			today
		);
	}

	async function handleTripToggle(dog: Dog) {
		const eligibility = getTripEligibility(dog);
		if (dog.isOutOnDayTrip) {
			await endDayTrip(dog.id, $authProfile);
			toast.success(`${dog.name} marked as returned.`);
		} else {
			if (!eligibility.eligible) {
				toast.error(eligibility.reasons[0] ?? `${dog.name} is not eligible for day trips.`);
				return;
			}
			await startDayTrip(dog.id, $authProfile);
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

	function openAddModal() {
		resetDraft();
		showAddModal = true;
	}

	function tripPillClass(status: Dog['dayTripStatus']) {
		if (status === 'eligible') return 'status-pill-green';
		if (status === 'difficult') return 'status-pill-yellow';
		return 'status-pill-red';
	}

	function tripLabel(status: Dog['dayTripStatus']) {
		if (status === 'eligible') return 'Day Trip: Eligible';
		if (status === 'difficult') return 'Day Trip: Adults only';
		return 'Day Trip: Ineligible';
	}

	function adoptionLabel(dog: Dog) {
		if (dog.status === 'adopted') return 'Adoption: Not available';
		if (dog.isolationStatus !== 'none') return 'Adoption: Temporarily unavailable';
		return 'Adoption: Available';
	}

	function adoptionPillClass(dog: Dog) {
		if (dog.status === 'adopted') return 'status-pill-red';
		if (dog.isolationStatus !== 'none') return 'status-pill-yellow';
		return 'status-pill-green';
	}

	function isBathDue(dog: Dog) {
		if (!bathEligible(dog.surgeryDate, today)) return false;
		const sinceLastBath = daysSince(dog.lastBathDate, today);
		return sinceLastBath === null || sinceLastBath >= BATH_DUE_DAYS;
	}

	function missingEvaluations(dog: Dog) {
		const missing: string[] = [];
		if (dog.goodWithDogs === 'unknown') missing.push('dogs');
		if (dog.goodWithCats === 'unknown') missing.push('cats');
		if (dog.goodWithKids === 'unknown') missing.push('kids');
		if (dog.pottyTrained === 'unknown') missing.push('potty training');
		if (dog.energyLevel === 'unknown') missing.push('energy');
		if ((dog.goodOnLead ?? 'unknown') === 'unknown') missing.push('on-lead');
		if ((dog.crateTrained ?? 'unknown') === 'unknown') missing.push('crate');
		return missing;
	}

	function pendingItems(
		dog: Dog,
		tripEligibility: TripEligibility,
		bathDue: boolean,
		lastPlaygroupDate: Date | null
	): CardActionItem[] {
		const items: CardActionItem[] = [];

		if (dog.isOutOnDayTrip) {
			items.push({
				label: 'Currently out on day trip: mark returned when back.',
				tone: 'info',
				priority: 100
			});
		} else {
			for (const reason of tripEligibility.reasons) {
				const normalized = reason.toLowerCase();
				let priority = 50;
				if (normalized.includes('isolation')) priority = 95;
				else if (normalized.includes('must be vaccinated')) priority = 90;
				else if (normalized.includes('must be spayed/neutered')) priority = 85;
				else if (normalized.includes('must have intake date')) priority = 80;
				else if (normalized.includes('behavior check')) priority = 75;
				else if (normalized.includes('difficult')) priority = 60;

				items.push({
					label: reason,
					tone: normalized.includes('difficult') ? 'info' : 'blocked',
					priority
				});
			}
		}

		const dayTripGap = daysSince(dog.lastDayTripDate, today);
		if (dayTripGap === null) {
			items.push({
				label: 'No day trip logged yet.',
				tone: 'info',
				priority: 68
			});
		} else if (dayTripGap >= ACTIVITY_DUE_DAYS) {
			items.push({
				label: `${dayTripGap} days since last day trip.`,
				tone: 'info',
				priority: 66
			});
		} else if (dayTripGap >= ACTIVITY_WARNING_DAYS) {
			items.push({
				label: `${dayTripGap} days since last day trip (watch).`,
				tone: 'info',
				priority: 64
			});
		}

		const playgroupGap = daysSince(lastPlaygroupDate, today);
		if (playgroupGap === null) {
			items.push({
				label: 'No playgroup logged yet.',
				tone: 'info',
				priority: 63
			});
		} else if (playgroupGap >= ACTIVITY_DUE_DAYS) {
			items.push({
				label: `${playgroupGap} days since last playgroup.`,
				tone: 'info',
				priority: 62
			});
		} else if (playgroupGap >= ACTIVITY_WARNING_DAYS) {
			items.push({
				label: `${playgroupGap} days since last playgroup (watch).`,
				tone: 'info',
				priority: 61
			});
		}

		const pendingEvaluation = missingEvaluations(dog);
		if (pendingEvaluation.length > 0) {
			items.push({
				label: `Needs evaluation: ${pendingEvaluation.join(', ')}`,
				tone: 'blocked',
				priority: 60
			});
		}

		if (bathDue) {
			items.push({
				label: 'Bath is due.',
				tone: 'ready',
				priority: 59,
				action: 'log_bath'
			});
		}

		if (dog.inFoster) {
			items.push({
				label: 'In foster: keep foster updates current.',
				tone: 'info',
				priority: 20
			});
		}

		return items.sort((a, b) => b.priority - a.priority);
	}

	function actionItemClass(tone: CardActionTone) {
		if (tone === 'ready') return 'next-action-ready';
		if (tone === 'blocked') return 'next-action-blocked';
		return 'next-action-info';
	}

	function sortArrow(key: typeof sortKey) {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? '(asc)' : '(desc)';
	}


	function toSearchText(dog: Dog) {
		return [
			dog.name,
			dog.breed,
			sexLabel(dog.sex),
			dog.origin,
			dog.idealHome,
			pottyLabel(dog.pottyTrained),
			compatibilityLabel(dog.goodWithDogs),
			compatibilityLabel(dog.goodWithCats),
			compatibilityLabel(dog.goodWithKids),
			energyLabel(dog.energyLevel)
		]
			.join(' ')
			.toLowerCase();
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
</script>

<section class="marker-dogs" aria-label="Dogs board">
	<div class="dogs-grid-board">
		<section class="dogs-control-strip" aria-label="Roster controls">
			<div class="dogs-summary-row">
				<div class="dogs-title-wrap">
					<p class="dogs-board-sub marker-line marker-blue-line">{activeCount}/{capacity} active dogs</p>
					<p class="dogs-capacity-note marker-line marker-muted">
						{#if capacityReached}
							capacity full
						{:else}
							{availableSpots} open spot{availableSpots === 1 ? '' : 's'}
						{/if}
					</p>
				</div>
				<div class="dogs-header-actions">
					{#if !$authProfile}
						<label class="role-selector typewriter">
							role
							<select bind:value={$localRole}>
								<option value="admin">Admin</option>
								<option value="manager">Manager</option>
								<option value="staff">Staff</option>
							</select>
						</label>
					{/if}
					<button
						class="board-control-btn board-control-btn-fill"
						on:click={openAddModal}
						disabled={!canEdit || capacityReached}
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
			<details class="dogs-filters-drawer">
				<summary class="dogs-filters-summary typewriter">filters and sort</summary>
				<div class="dogs-filters-body">
					<div class="dogs-sort-group" role="group" aria-label="Sort dogs">
						<span class="control-label typewriter">sort</span>
						<button
							class={`sort-chip ${sortKey === 'name' ? 'sort-chip-active' : ''}`}
							on:click={() => setSort('name')}
						>
							name {sortArrow('name')}
						</button>
						<button
							class={`sort-chip ${sortKey === 'days' ? 'sort-chip-active' : ''}`}
							on:click={() => setSort('days')}
						>
							days {sortArrow('days')}
						</button>
						<button
							class={`sort-chip ${sortKey === 'age' ? 'sort-chip-active' : ''}`}
							on:click={() => setSort('age')}
						>
							age {sortArrow('age')}
						</button>
					</div>
					<label class="archived-toggle typewriter">
						<input type="checkbox" bind:checked={showArchived} />
						show archived
					</label>
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
						{@const bathDue = isBathDue(dog)}
						{@const lastPlaygroupDate = lastPlaygroupByDogId[dog.id] ?? null}
						{@const cardPendingItems = pendingItems(dog, tripEligibility, bathDue, lastPlaygroupDate)}
						<div
							class={`dog-card dog-card-clickable ${dog.isOutOnDayTrip ? 'dog-card-trip' : ''} ${dog.inFoster ? 'dog-card-foster' : ''}`}
							role="link"
							tabindex="0"
							aria-label={`Open ${dog.name} profile`}
							on:click={(event) => handleCardClick(event, dog.id)}
							on:keydown={(event) => handleCardKeydown(event, dog.id)}
						>
							<header class="dog-card-header">
								<div class="dog-card-headline">
									<a class="dog-name-link" href={`/dogs/${dog.id}`}>{dog.name}</a>
									<p class="dog-kennel typewriter">kennel: {dog.outdoorKennelAssignment || 'unassigned'}</p>
								</div>
								<span class="days-tag typewriter">{daysSince(dog.intakeDate, today) ?? 0} days</span>
							</header>

							<div class="dog-front-status-list">
								<span class={`status-pill ${adoptionPillClass(dog)}`}>
									{adoptionLabel(dog)}
								</span>
								<span class={`status-pill ${tripPillClass(tripEligibility.status)}`}>
									{tripLabel(tripEligibility.status)}
								</span>
							</div>

							<div class="dog-fact-grid">
								<p class="fact-row">
									<span class="fact-label typewriter">age</span>
									<span class="fact-value erase-marker-purple">{formatAge(dog.dateOfBirth, today)}</span>
								</p>
								<p class="fact-row">
									<span class="fact-label typewriter">sex</span>
									<span class="fact-value erase-marker-blue">{sexLabel(dog.sex)}</span>
								</p>
							</div>

							<details class="dog-details-drawer">
								<summary class="dog-details-summary typewriter">
									care details
									<span class="dog-details-count">{cardPendingItems.length} pending</span>
								</summary>
								<div class="dog-details-body">
									<div class="meet-card">
										<p class="fact-label typewriter">meet and greet quick answers</p>
										<dl class="meet-grid">
											<div class="meet-row">
												<dt class="meet-key">Origin</dt>
												<dd class="meet-value">{dog.origin || 'Unknown'}</dd>
											</div>
											<div class="meet-row">
												<dt class="meet-key">Potty Trained</dt>
												<dd class="meet-value">{pottyLabel(dog.pottyTrained)}</dd>
											</div>
											<div class="meet-row">
												<dt class="meet-key">Good w/ Dogs</dt>
												<dd class="meet-value">{compatibilityLabel(dog.goodWithDogs)}</dd>
											</div>
											<div class="meet-row">
												<dt class="meet-key">Good w/ Cats</dt>
												<dd class="meet-value">{compatibilityLabel(dog.goodWithCats)}</dd>
											</div>
											<div class="meet-row">
												<dt class="meet-key">Good w/ Kids</dt>
												<dd class="meet-value">{compatibilityLabel(dog.goodWithKids)}</dd>
											</div>
											<div class="meet-row">
												<dt class="meet-key">Energy</dt>
												<dd class="meet-value">{energyLabel(dog.energyLevel)}</dd>
											</div>
										</dl>
										<p class="meet-home">
											<span class="meet-key">Best Home</span>
											<span class="meet-home-value">{dog.idealHome || 'Not yet documented'}</span>
										</p>
									</div>

									<div class="next-step-card">
										<p class="fact-label typewriter">pending items</p>
										{#if cardPendingItems.length === 0}
											<p class="next-action-empty">No pending items.</p>
										{:else}
											<ul class="next-action-list">
												{#each cardPendingItems as item}
													<li class={`next-action-item ${actionItemClass(item.tone)}`}>
														<span>{item.label}</span>
														{#if item.action === 'log_bath'}
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
								<button
									class="action-btn"
									on:click={() => handleTripToggle(dog)}
									disabled={!dog.isOutOnDayTrip && !tripEligibility.eligible}
								>
									{dog.isOutOnDayTrip ? 'mark returned' : 'send out'}
								</button>
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
		border: 4px solid var(--marker-black);
		background: rgba(255, 255, 255, 0.9);
	}

	.marker-line {
		margin: 0;
		font-family: var(--font-marker);
		font-weight: 700;
		letter-spacing: 0.01em;
		line-height: 1.16;
		text-shadow:
			0.58px 0 currentColor,
			-0.48px 0 currentColor,
			0 0.48px currentColor;
	}

	.marker-blue-line {
		color: #2f79b6;
	}

	.marker-muted {
		color: #667388 !important;
		font-weight: 600;
		text-shadow: none;
	}

	.dogs-summary-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.42rem;
	}

	.dogs-title-wrap {
		display: grid;
		gap: 0.08rem;
		flex: 1 1 auto;
		min-width: 0;
	}

	.dogs-board-sub {
		margin: 0;
		font-size: clamp(1rem, 4.4vw, 1.34rem);
	}

	.dogs-capacity-note {
		margin: 0;
		font-size: clamp(0.82rem, 3.8vw, 1rem);
	}

	.dogs-header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.36rem;
		width: auto;
		flex: 0 0 auto;
		justify-content: flex-end;
	}

	.role-selector {
		display: inline-flex;
		align-items: center;
		gap: 0.36rem;
		min-height: 2rem;
		padding: 0.3rem 0.54rem;
		border: 2px solid var(--marker-black);
		background: #ffffff;
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.role-selector select {
		border: 0;
		background: transparent;
		font-size: 0.68rem;
		font-weight: 700;
		color: #2f3f53;
	}

	.board-control-btn {
		min-height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.24rem;
		border: 2px solid var(--marker-black);
		border-radius: 0.24rem;
		padding: 0.28rem 0.64rem;
		font-family: var(--font-typewriter);
		font-size: 0.56rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--marker-black);
		background: #ffffff;
		text-decoration: none;
		flex: 0 0 auto;
	}

	.add-plus {
		font-size: 1.22rem;
		line-height: 0.8;
		font-weight: 900;
	}

	.board-control-btn:hover {
		background: #edf4ff;
	}

	.board-control-btn-fill {
		background: #dcebf8;
	}

	.board-control-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.dogs-control-strip {
		display: grid;
		gap: 0.5rem;
		padding: 0.64rem 0.62rem;
		border-bottom: 4px solid var(--marker-black);
	}

	.dogs-search-wrap {
		display: grid;
		gap: 0.12rem;
	}

	.control-label {
		font-size: 0.56rem;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		color: #4f6178;
	}

	.dogs-search-input {
		width: 100%;
		min-height: 1.72rem;
		border: 2px solid var(--marker-black);
		border-radius: 0.24rem;
		padding: 0.08rem 0.54rem;
		font-size: 0.84rem;
		line-height: 1.2;
		letter-spacing: 0.04em;
		color: #26354a;
		background: #ffffff;
	}

	.dogs-filters-drawer {
		border: 2px solid rgba(26, 31, 40, 0.32);
		border-radius: 0.24rem;
		background: rgba(248, 251, 255, 0.78);
	}

	.dogs-filters-summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.34rem 0.46rem;
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #2f3f53;
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
		padding: 0 0.46rem 0.46rem;
	}

	.dogs-filters-drawer[open] .dogs-filters-body {
		display: grid;
		gap: 0.36rem;
	}

	.dogs-sort-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.32rem;
	}

	.sort-chip {
		min-height: 1.84rem;
		border: 2px solid var(--marker-black);
		border-radius: 0.24rem;
		background: #ffffff;
		padding: 0.24rem 0.54rem;
		font-family: var(--font-typewriter);
		font-size: 0.54rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #243346;
	}

	.sort-chip-active {
		background: #e8f3ff;
	}

	.archived-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
		min-height: 1.84rem;
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #33475f;
	}

	.archived-toggle input {
		width: 1rem;
		height: 1rem;
		accent-color: #33475f;
	}

	.dogs-zone {
		padding: 0.7rem 0.62rem;
	}

	.dogs-state {
		margin-top: 0;
		padding: 0.58rem 0.6rem;
		border: 2px solid rgba(68, 83, 102, 0.35);
		background: rgba(255, 255, 255, 0.84);
	}

	.dogs-card-grid {
		margin-top: 0;
		display: grid;
		gap: 0;
	}

	.dog-card {
		border: 0;
		border-bottom: 3px solid var(--marker-black);
		background: transparent;
		padding: 0.62rem 0.08rem;
		display: grid;
		gap: 0.44rem;
	}

	.dog-card:last-child {
		border-bottom: 0;
	}

	.dog-card-clickable {
		cursor: pointer;
		transition: background-color 140ms ease;
	}

	.dog-card-clickable:hover {
		background: rgba(233, 241, 251, 0.36);
	}

	.dog-card-clickable:focus-visible {
		outline: 3px solid #3d85c6;
		outline-offset: 2px;
	}

	.dog-card-trip {
		background: rgba(239, 248, 255, 0.88);
	}

	.dog-card-foster {
		background: rgba(255, 247, 236, 0.9);
	}

	.dog-card-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.42rem;
		align-items: start;
	}

	.dog-name-link {
		font-family: var(--font-printed);
		font-size: clamp(1.16rem, 5.4vw, 1.38rem);
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--marker-black);
		text-decoration: none;
	}

	.dog-name-link:hover {
		text-decoration: underline;
	}

	.dog-kennel {
		margin: 0.13rem 0 0;
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #486079;
	}

	.days-tag {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 1.82rem;
		border: 2px solid var(--marker-black);
		border-radius: 0.22rem;
		padding: 0.18rem 0.46rem;
		background: #edf4fb;
		font-size: 0.56rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #25364a;
		white-space: nowrap;
	}

	.dog-fact-grid {
		display: grid;
		gap: 0.24rem;
	}

	.dog-front-status-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.28rem;
	}

	.dog-details-drawer {
		border: 2px dashed rgba(56, 77, 104, 0.45);
		border-radius: 0.22rem;
		background: rgba(241, 247, 255, 0.72);
		padding: 0.22rem 0.34rem;
	}

	.dog-details-summary {
		list-style: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		cursor: pointer;
		font-size: 0.54rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #30455d;
	}

	.dog-details-summary::-webkit-details-marker {
		display: none;
	}

	.dog-details-count {
		font-family: var(--font-typewriter);
		font-size: 0.5rem;
		letter-spacing: 0.08em;
		color: #4b627f;
	}

	.dog-details-drawer[open] .dog-details-body {
		display: grid;
		gap: 0.44rem;
		padding-top: 0.34rem;
	}

	.meet-card {
		border: 2px solid rgba(37, 72, 120, 0.32);
		background: rgba(234, 244, 255, 0.7);
		padding: 0.44rem 0.48rem;
		display: grid;
		gap: 0.3rem;
	}

	.meet-grid {
		margin: 0;
		display: grid;
		gap: 0;
	}

	.meet-row {
		display: grid;
		grid-template-columns: minmax(6.2rem, 8.2rem) minmax(0, 1fr);
		gap: 0.38rem;
		align-items: start;
		padding: 0.22rem 0;
		border-bottom: 1px solid rgba(79, 97, 120, 0.22);
	}

	.meet-row:last-child {
		border-bottom: 0;
	}

	.meet-key {
		margin: 0;
		font-family: var(--font-typewriter);
		font-size: 0.54rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #4f6178;
	}

	.meet-value {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.24;
		font-weight: 700;
		color: #1f3045;
	}

	.meet-home {
		margin: 0;
		padding-top: 0.26rem;
		border-top: 1px dashed rgba(79, 97, 120, 0.35);
		display: grid;
		grid-template-columns: minmax(6.2rem, 8.2rem) minmax(0, 1fr);
		gap: 0.38rem;
		align-items: start;
	}

	.meet-home-value {
		font-size: 0.72rem;
		line-height: 1.28;
		font-weight: 700;
		color: #1e2f44;
	}

	.fact-row {
		margin: 0;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.38rem;
		align-items: baseline;
		padding-bottom: 0.12rem;
		border-bottom: 2px solid rgba(26, 31, 40, 0.16);
	}

	.fact-label {
		font-size: 0.52rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #50627a;
	}

	.fact-value {
		font-size: 1.04rem;
		line-height: 1.12;
	}

	.next-step-card {
		border: 2px solid rgba(35, 132, 90, 0.42);
		background: rgba(235, 248, 241, 0.82);
		padding: 0.44rem 0.48rem;
	}

	.next-action-list {
		margin: 0.22rem 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.24rem;
	}

	.next-action-item {
		margin: 0;
		padding: 0.24rem 0.34rem;
		border: 1.5px solid #b9c4d2;
		border-radius: 0.2rem;
		font-size: 0.66rem;
		line-height: 1.2;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.35rem;
	}

	.pending-inline-btn {
		min-height: 1.84rem;
		border: 1.5px solid var(--marker-black);
		border-radius: 0.2rem;
		padding: 0.22rem 0.56rem;
		font-family: var(--font-typewriter);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #1d2c3f;
		background: #ffffff;
	}

	.pending-inline-btn:hover {
		background: #edf4ff;
	}

	.next-action-empty {
		margin: 0.22rem 0 0;
		font-size: 0.66rem;
		color: #4f6178;
	}

	.next-action-ready {
		background: #ddf3e6;
		color: #1f5f43;
	}

	.next-action-blocked {
		background: #f9e3e1;
		color: #8f2f2b;
	}

	.next-action-info {
		background: #e2effd;
		color: #264b73;
	}

	.dog-status-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.28rem;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		border: 2px solid var(--marker-black);
		border-radius: 0.22rem;
		padding: 0.17rem 0.42rem;
		font-family: var(--font-typewriter);
		font-size: 0.54rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #1d2c3f;
	}

	.status-pill-green {
		background: #ddf3e6;
	}

	.status-pill-yellow {
		background: #fbf2d7;
	}

	.status-pill-red {
		background: #f9e3e1;
	}

	.status-pill-blue {
		background: #e2effd;
	}

	.status-pill-foster {
		background: #f7eada;
	}

	.status-alert {
		width: 100%;
		font-size: 0.96rem;
		line-height: 1.14;
	}

	.dog-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.34rem;
	}

	.action-btn {
		min-height: 2.02rem;
		border: 2px solid var(--marker-black);
		border-radius: 0.22rem;
		padding: 0.2rem 0.55rem;
		font-family: var(--font-typewriter);
		font-size: 0.56rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #1c2b3c;
		background: #e8f1fb;
	}

	.action-btn:hover {
		background: #dce8f6;
	}

	.action-btn:disabled {
		opacity: 0.5;
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
		min-height: 2.24rem;
		border: 2px solid var(--marker-black);
		border-radius: 0.24rem;
		padding: 0.26rem 0.72rem;
		font-family: var(--font-typewriter);
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #1d2a3a;
		background: #ffffff;
	}

	.modal-btn-fill {
		background: #dcebf8;
	}

	.modal-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	@media (min-width: 760px) {
		.dogs-control-strip {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			align-items: end;
			gap: 0.8rem;
			padding: 0.95rem;
		}

		.dogs-summary-row {
			grid-column: 1 / -1;
			align-items: center;
		}

		.dogs-header-actions {
			justify-content: flex-end;
			width: auto;
		}

		.board-control-btn {
			flex: 0 0 auto;
			font-size: 0.62rem;
			min-height: 2.28rem;
		}

		.dogs-filters-drawer {
			border: 0;
			background: transparent;
		}

		.dogs-filters-summary {
			display: none;
		}

		.dogs-filters-body {
			display: grid !important;
			gap: 0.44rem;
			padding: 0;
		}

		.dogs-zone {
			padding: 0.95rem;
		}

		.dog-details-drawer {
			border: 0;
			background: transparent;
			padding: 0;
		}

		.dog-details-summary {
			display: none;
		}

		.dog-details-body {
			display: grid !important;
			gap: 0.56rem;
		}

		.dogs-card-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.dog-card {
			padding-left: 0.08rem;
			padding-right: 0.08rem;
			border-right: 0;
		}

		.dog-card:last-child {
			border-bottom: 3px solid var(--marker-black);
		}

		.dog-card:nth-child(odd) {
			border-right: 3px solid var(--marker-black);
			padding-right: 0.62rem;
		}

		.dog-card:nth-child(even) {
			padding-left: 0.62rem;
		}

	}

	@media (min-width: 1180px) {
		.dogs-card-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.dog-card {
			border-right: 0;
			padding-left: 0.62rem;
			padding-right: 0.62rem;
		}

		.dog-card:nth-child(3n + 1),
		.dog-card:nth-child(3n + 2) {
			border-right: 3px solid var(--marker-black);
		}

		.dog-card:nth-child(3n + 1) {
			padding-left: 0.08rem;
			padding-right: 0.62rem;
		}

		.dog-card:nth-child(3n + 2) {
			padding-left: 0.62rem;
			padding-right: 0.62rem;
		}

		.dog-card:nth-child(3n) {
			padding-left: 0.62rem;
			padding-right: 0.08rem;
		}

	}
</style>
