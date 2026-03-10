<script lang="ts">
	import toast from 'svelte-french-toast';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { listDogs, startDayTrip, endDayTrip, listAllDayTripLogs } from '$lib/data/dogs';
	import type { DayTripLog, Dog } from '$lib/types';
	import { checkDayTripEligibility, daysSince, formatDate, formatDateTime, toDate } from '$lib/utils/dates';

	const now = new Date();
	const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	let dogs: Dog[] = [];
	let logs: DayTripLog[] = [];
	let loading = true;
	let monthFilter = defaultMonth;
	let loaded = false;

	$: {
		const canLoad = !firebaseEnabled || ($authReady && Boolean($authUser));
		if (canLoad && !loaded) {
			loaded = true;
			void refresh();
		}
	}

	$: activeDogs = dogs
		.filter((dog) => dog.status === 'active')
		.sort((a, b) => a.name.localeCompare(b.name));

	$: monthStart = (() => {
		const [year, month] = monthFilter.split('-').map(Number);
		if (Number.isFinite(year) && Number.isFinite(month)) {
			return new Date(year, month - 1, 1);
		}
		return new Date(now.getFullYear(), now.getMonth(), 1);
	})();
	$: monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
	$: monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

	$: monthlyLogs = logs.filter((log) => {
		const startedAt = toDate(log.startedAt);
		if (!startedAt) return false;
		return startedAt >= monthStart && startedAt < monthEnd;
	});

	$: monthlyTripCount = monthlyLogs.length;
	$: monthlyHourTotal = monthlyLogs.reduce((sum, log) => sum + durationHours(log), 0);
	$: outNowCount = activeDogs.filter((dog) => dog.isOutOnDayTrip).length;

	$: tripCountByDog = monthlyLogs.reduce<Record<string, number>>((acc, log) => {
		acc[log.dogId] = (acc[log.dogId] ?? 0) + 1;
		return acc;
	}, {});

	$: tripHoursByDog = monthlyLogs.reduce<Record<string, number>>((acc, log) => {
		acc[log.dogId] = (acc[log.dogId] ?? 0) + durationHours(log);
		return acc;
	}, {});

	$: openTripByDog = logs.reduce<Record<string, DayTripLog>>((acc, log) => {
		if (log.endedAt) return acc;
		const existing = acc[log.dogId];
		const logStart = toDate(log.startedAt)?.getTime() ?? 0;
		const existingStart = toDate(existing?.startedAt)?.getTime() ?? 0;
		if (!existing || logStart > existingStart) {
			acc[log.dogId] = log;
		}
		return acc;
	}, {});

	$: dogsOut = activeDogs
		.filter((d) => d.isOutOnDayTrip)
		.sort((a, b) => {
			const aStart = toDate(openTripByDog[a.id]?.startedAt ?? a.currentDayTripStartedAt)?.getTime() ?? 0;
			const bStart = toDate(openTripByDog[b.id]?.startedAt ?? b.currentDayTripStartedAt)?.getTime() ?? 0;
			return aStart - bStart;
		});

	$: dogsEligible = activeDogs
		.filter((d) => !d.isOutOnDayTrip && getEligibility(d).eligible)
		.sort((a, b) => {
			const aDays = daysSince(a.lastDayTripDate) ?? 999;
			const bDays = daysSince(b.lastDayTripDate) ?? 999;
			return bDays - aDays;
		});

	$: dogsIneligible = activeDogs
		.filter((d) => !d.isOutOnDayTrip && !getEligibility(d).eligible)
		.sort((a, b) => a.name.localeCompare(b.name));

	function durationHours(log: DayTripLog) {
		const startedAt = toDate(log.startedAt);
		const endedAt = toDate(log.endedAt) ?? new Date();
		if (!startedAt) return 0;
		return Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 3_600_000);
	}

	function getEligibility(dog: Dog) {
		return checkDayTripEligibility(
			dog.intakeDate,
			dog.isVaccinated,
			dog.isFixed,
			dog.dayTripStatus,
			dog.isolationStatus,
			dog.dayTripIneligibleReason,
			dog.dayTripNotes,
			new Date()
		);
	}

	async function refresh() {
		loading = true;
		try {
			[dogs, logs] = await Promise.all([listDogs(), listAllDayTripLogs()]);
		} catch (error) {
			const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
			toast.error(code ? `Unable to load day trip data (${code}).` : 'Unable to load day trip data.');
		} finally {
			loading = false;
		}
	}

	function statusPillClass(status: Dog['dayTripStatus']) {
		if (status === 'eligible') return 'pill-green';
		if (status === 'difficult') return 'pill-yellow';
		return 'pill-red';
	}

	async function toggleOut(dog: Dog) {
		const eligibility = getEligibility(dog);
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
		await refresh();
	}
</script>

<section class="daytrip-board">
	<div class="daytrip-grid-board">
		<div class="daytrip-hero">
			<div>
				<h2 class="daytrip-title">
					{monthLabel} Trips: {monthlyTripCount} | Hours: {monthlyHourTotal.toFixed(1)}
				</h2>
				<p class="daytrip-sub whiteboard-hand erase-marker-blue">{outNowCount} dog(s) currently out on day trips</p>
			</div>
			<div class="daytrip-controls">
				<input type="month" class="month-input" bind:value={monthFilter} />
				<button class="refresh-trip-btn typewriter" on:click={refresh}>
					Refresh
				</button>
			</div>
		</div>

		<div class="daytrip-sheet">
			{#if loading}
				<p class="daytrip-status whiteboard-hand">Loading trip board...</p>
			{:else if activeDogs.length === 0}
				<p class="daytrip-status whiteboard-hand">No active dogs found.</p>
			{:else}

				<!-- Mobile card layout -->
				<div class="daytrip-mobile-list">

					<!-- Out Now -->
					<div class="trip-section">
						<h3 class="trip-section-label">Out Now <span class="trip-section-count">({dogsOut.length})</span></h3>
						{#if dogsOut.length === 0}
							<p class="trip-section-empty typewriter">none out right now</p>
						{:else}
							{#each dogsOut as dog}
								{@const openTrip = openTripByDog[dog.id]}
								<article class="trip-card trip-card-out">
									<header class="trip-card-header">
										<div>
											<p class="trip-name">{dog.name}</p>
											<p class="trip-meta typewriter">Kennel: {dog.outdoorKennelAssignment || 'Unassigned'}</p>
										</div>
										<p class="trip-count whiteboard-hand erase-marker-red">{tripCountByDog[dog.id] ?? 0}</p>
									</header>
									<p class="trip-active-note whiteboard-hand">Out since {formatDateTime(openTrip?.startedAt ?? dog.currentDayTripStartedAt)}</p>
									<button class="btn" on:click={() => toggleOut(dog)}>Mark Returned</button>
								</article>
							{/each}
						{/if}
					</div>

					<!-- Eligible -->
					<div class="trip-section">
						<h3 class="trip-section-label">Eligible <span class="trip-section-count">({dogsEligible.length})</span></h3>
						{#if dogsEligible.length === 0}
							<p class="trip-section-empty typewriter">none ready</p>
						{:else}
							{#each dogsEligible as dog}
								{@const eligibility = getEligibility(dog)}
								{@const days = daysSince(dog.lastDayTripDate)}
								{@const overdue = days === null || days >= 14}
								<article class="trip-card">
									<header class="trip-card-header">
										<div>
											<p class="trip-name">{dog.name}</p>
											<p class="trip-meta typewriter">Kennel: {dog.outdoorKennelAssignment || 'Unassigned'}</p>
										</div>
										<p class="trip-count whiteboard-hand erase-marker-red">{tripCountByDog[dog.id] ?? 0}</p>
									</header>
									<div class="trip-row">
										<span class={`pill ${statusPillClass(eligibility.status)}`}>
											{eligibility.status === 'difficult' ? 'Difficult' : 'Eligible'}
										</span>
										{#if overdue}
											<span class="pill pill-orange">overdue</span>
										{/if}
										<span class="trip-hours typewriter">{(tripHoursByDog[dog.id] ?? 0).toFixed(1)} hrs</span>
									</div>
									<p class="trip-idle typewriter">
										{days !== null ? `Last trip: ${days} day${days === 1 ? '' : 's'} ago` : 'No trips yet'}
									</p>
									{#if eligibility.reasons.length > 0}
										<p class="trip-warning">{eligibility.reasons[0]}</p>
									{/if}
									<button class="btn" on:click={() => toggleOut(dog)}>Send Out</button>
								</article>
							{/each}
						{/if}
					</div>

					<!-- Not Eligible -->
					<div class="trip-section">
						<h3 class="trip-section-label">Not Eligible <span class="trip-section-count">({dogsIneligible.length})</span></h3>
						{#if dogsIneligible.length === 0}
							<p class="trip-section-empty typewriter">none</p>
						{:else}
							{#each dogsIneligible as dog}
								{@const eligibility = getEligibility(dog)}
								<article class="trip-card trip-card-ineligible">
									<header class="trip-card-header">
										<div>
											<p class="trip-name">{dog.name}</p>
											<p class="trip-meta typewriter">Kennel: {dog.outdoorKennelAssignment || 'Unassigned'}</p>
										</div>
									</header>
									<div class="trip-row">
										<span class="pill pill-red">Ineligible</span>
									</div>
									{#if eligibility.reasons.length > 0}
										<p class="trip-warning">{eligibility.reasons[0]}</p>
									{/if}
								</article>
							{/each}
						{/if}
					</div>

				</div>

				<!-- Desktop table layout -->
				<div class="daytrip-table-wrap">
					<table class="daytrip-table">
						<thead>
							<tr>
								<th class="py-3">Dog</th>
								<th class="py-3 text-center">{monthStart.toLocaleDateString('en-US', { month: 'short' })} Trips</th>
								<th class="py-3">Status</th>
								<th class="py-3">Info</th>
								<th class="py-3">Actions</th>
							</tr>
						</thead>

						<!-- Out Now -->
						<tbody>
							<tr class="section-header-row">
								<td colspan="5" class="section-header-cell">Out Now ({dogsOut.length})</td>
							</tr>
							{#if dogsOut.length === 0}
								<tr><td colspan="5" class="section-empty-cell">none out right now</td></tr>
							{:else}
								{#each dogsOut as dog}
									{@const openTrip = openTripByDog[dog.id]}
									<tr>
										<td class="py-4">
											<p class="trip-table-name">{dog.name}</p>
											<p class="trip-table-meta">Kennel: {dog.outdoorKennelAssignment || '—'}</p>
										</td>
										<td class="py-4 text-center">
											<p class="trip-table-count">{tripCountByDog[dog.id] ?? 0}</p>
											<p class="trip-table-hours">{(tripHoursByDog[dog.id] ?? 0).toFixed(1)} hrs</p>
										</td>
										<td class="py-4">
											<div class="trip-tag">I'm on a day trip!</div>
										</td>
										<td class="py-4">
											<p class="trip-table-meta">Out since {formatDateTime(openTrip?.startedAt ?? dog.currentDayTripStartedAt)}</p>
										</td>
										<td class="py-4">
											<button class="btn" on:click={() => toggleOut(dog)}>Mark Returned</button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>

						<!-- Eligible -->
						<tbody>
							<tr class="section-header-row">
								<td colspan="5" class="section-header-cell">Eligible ({dogsEligible.length})</td>
							</tr>
							{#if dogsEligible.length === 0}
								<tr><td colspan="5" class="section-empty-cell">none ready</td></tr>
							{:else}
								{#each dogsEligible as dog}
									{@const eligibility = getEligibility(dog)}
									{@const days = daysSince(dog.lastDayTripDate)}
									{@const overdue = days === null || days >= 14}
									<tr>
										<td class="py-4">
											<p class="trip-table-name">{dog.name}</p>
											<p class="trip-table-meta">Kennel: {dog.outdoorKennelAssignment || '—'} | Last trip: {days !== null ? `${days}d ago` : 'never'}</p>
										</td>
										<td class="py-4 text-center">
											<p class="trip-table-count">{tripCountByDog[dog.id] ?? 0}</p>
											<p class="trip-table-hours">{(tripHoursByDog[dog.id] ?? 0).toFixed(1)} hrs</p>
										</td>
										<td class="py-4">
											<span class={`pill ${statusPillClass(eligibility.status)}`}>
												{eligibility.status === 'difficult' ? 'Difficult' : 'Eligible'}
											</span>
											{#if eligibility.reasons.length > 0}
												<p class="trip-warning mt-2">{eligibility.reasons[0]}</p>
											{/if}
										</td>
										<td class="py-4">
											{#if overdue}
												<span class="pill pill-orange">overdue</span>
											{/if}
										</td>
										<td class="py-4">
											<button class="btn" on:click={() => toggleOut(dog)}>Send Out</button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>

						<!-- Not Eligible -->
						<tbody>
							<tr class="section-header-row">
								<td colspan="5" class="section-header-cell">Not Eligible ({dogsIneligible.length})</td>
							</tr>
							{#if dogsIneligible.length === 0}
								<tr><td colspan="5" class="section-empty-cell">none</td></tr>
							{:else}
								{#each dogsIneligible as dog}
									{@const eligibility = getEligibility(dog)}
									<tr class="row-ineligible">
										<td class="py-4">
											<p class="trip-table-name">{dog.name}</p>
											<p class="trip-table-meta">Kennel: {dog.outdoorKennelAssignment || '—'}</p>
										</td>
										<td></td>
										<td class="py-4">
											<span class="pill pill-red">Ineligible</span>
										</td>
										<td colspan="2" class="py-4">
											{#if eligibility.reasons.length > 0}
												<p class="trip-warning">{eligibility.reasons[0]}</p>
											{/if}
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>

					</table>
				</div>

			{/if}
		</div>
	</div>
</section>

<style>
	.daytrip-board {
		width: 100%;
	}

	.daytrip-grid-board {
		border: 4px solid var(--marker-black);
		background: rgba(255, 255, 255, 0.9);
	}

	.daytrip-hero {
		padding: 0.82rem 0.78rem;
		display: grid;
		gap: 0.66rem;
		border-bottom: 4px solid var(--marker-black);
	}

	.daytrip-title {
		margin-top: 0.44rem;
		font-size: 1.34rem;
		line-height: 1.08;
		color: var(--marker-black);
	}

	.daytrip-sub {
		margin-top: 0.28rem;
		font-size: 0.86rem;
	}

	.daytrip-controls {
		display: grid;
		gap: 0.34rem;
	}

	.month-input,
	.refresh-trip-btn {
		min-height: 2rem;
		border: 1.5px solid var(--marker-black);
		border-radius: 0.24rem;
		padding: 0.28rem 0.58rem;
		background: #ffffff;
		color: var(--marker-black);
	}

	.month-input {
		font-size: 1rem;
	}

	.refresh-trip-btn {
		font-size: 0.72rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		font-weight: 700;
		background: var(--sticky-yellow);
	}

	.daytrip-sheet {
		padding: 0;
	}

	.daytrip-status {
		font-size: 0.88rem;
		color: var(--ink-soft);
		padding: 0.72rem;
	}

	/* Sections */
	.daytrip-mobile-list {
		display: grid;
		gap: 0;
	}

	.trip-section {
		display: grid;
		gap: 0.42rem;
		padding: 0.72rem 0.78rem;
		border-top: 4px solid var(--marker-black);
	}

	.trip-section-label {
		font-family: var(--font-printed);
		font-size: clamp(1.28rem, 5.8vw, 1.8rem);
		font-weight: 400;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--marker-black);
		line-height: 1.02;
	}

	.trip-section-count {
		font-weight: 400;
	}

	.trip-section-empty {
		font-size: 0.76rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
		padding: 0.3rem 0;
	}

	/* Cards */
	.trip-card {
		border: 1.5px solid #c7cfda;
		border-radius: 0.25rem;
		background: #ffffff;
		padding: 0.52rem 0.56rem;
	}

	.trip-card-out {
		border-color: #95bee1;
		background: #f0f8ff;
	}

	.trip-card-ineligible {
		opacity: 0.72;
	}

	.trip-card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.45rem;
	}

	.trip-name {
		font-size: 1rem;
		font-weight: 800;
		color: var(--marker-black);
		line-height: 1;
	}

	.trip-meta {
		margin-top: 0.14rem;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.trip-count {
		font-size: 1.3rem;
		line-height: 1;
		font-weight: 700;
	}

	.trip-row {
		margin-top: 0.44rem;
		display: flex;
		align-items: center;
		gap: 0.42rem;
		flex-wrap: wrap;
	}


	.trip-hours {
		margin-left: auto;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.trip-warning {
		margin-top: 0.38rem;
		font-size: 0.76rem;
		color: var(--marker-red);
		line-height: 1.2;
	}

	.trip-active-note,
	.trip-idle {
		margin-top: 0.35rem;
		font-size: 0.78rem;
		color: var(--ink-soft);
	}


	.trip-tag {
		display: inline-flex;
		border: 1.5px solid #95bee1;
		border-radius: 0.2rem;
		background: #e8f5ff;
		padding: 0.22rem 0.48rem;
		font-size: 0.76rem;
		font-weight: 700;
		color: #275982;
	}

	/* Desktop table */
	.daytrip-table-wrap {
		display: none;
		overflow-x: auto;
	}

	.daytrip-table {
		min-width: 100%;
		border-collapse: collapse;
		text-align: left;
	}

	.daytrip-table th {
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-soft);
		padding: 0.5rem 0.44rem;
	}

	.daytrip-table td {
		padding: 0.58rem 0.44rem;
		vertical-align: top;
		border-top: 1px dashed #c7d0dc;
	}

	.section-header-row td {
		border-top: 4px solid var(--marker-black);
	}

	.section-header-cell {
		padding: 0.48rem 0.72rem !important;
		font-family: var(--font-printed);
		font-size: clamp(1.1rem, 4.5vw, 1.5rem);
		font-weight: 400;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--marker-black);
		background: transparent;
	}

	.section-empty-cell {
		font-family: var(--font-typewriter);
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.row-ineligible td {
		opacity: 0.62;
	}

	.trip-table-name {
		font-size: 0.94rem;
		font-weight: 700;
		color: var(--marker-black);
	}

	.trip-table-meta {
		font-size: 0.7rem;
		color: var(--ink-soft);
	}

	.trip-table-count {
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--marker-red);
		line-height: 1;
	}

	.trip-table-hours {
		font-size: 0.66rem;
		color: var(--ink-soft);
	}

	@media (min-width: 900px) {
		.daytrip-hero {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
			padding: 0.95rem;
		}

		.daytrip-title {
			font-size: 1.56rem;
		}

		.daytrip-sub {
			font-size: 0.92rem;
		}

		.daytrip-controls {
			grid-template-columns: auto auto;
			align-items: end;
		}

		.month-input,
		.refresh-trip-btn {
			min-height: 2.15rem;
		}

		.daytrip-sheet {
			padding: 0.84rem;
		}

		.daytrip-mobile-list {
			display: none;
		}

		.daytrip-table-wrap {
			display: block;
		}

		.btn {
			margin-top: 0;
		}
	}
</style>
