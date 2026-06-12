<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { canAccessDayTrips, canEditDayTrips as checkCanEditDayTrips, resolveRole } from '$lib/utils/permissions';
	import { listDogs, startDayTrip, endDayTrip, setDogTripStatus, listAllDayTripLogs, importHistoricalDayTrip, clearDayTripLogs, updateDog, createDog, deleteDayTripLog, logManualTrip, patchDayTripLog } from '$lib/data/dogs';
	import { listVolunteers } from '$lib/data/volunteers';
	import type { DayTripLog, Dog, UserRole, Volunteer } from '$lib/types';
	import TripLogForm from '$lib/components/daytrips/TripLogForm.svelte';
	import ImportTab from '$lib/components/daytrips/ImportTab.svelte';
	import { checkDayTripEligibility, daysSince, sinceReturn, dogStripeColor, formatDateTime, toDate } from '$lib/utils/dates';
	import { getDayTripGapDays, isDayTripEligible, DAYTRIP_OVERDUE_DAYS } from '$lib/utils/attention';
	import { durationHours, formatDuration, formatTime, formatShortDate } from '$lib/utils/daytrips';
	import { matchDogByName } from '$lib/utils/dogs';
	import { parseDayTripNotes, stripDayTripNotes, type ParsedTrip } from '$lib/utils/tripNotesParser';

	const now = new Date();
	const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	let dogs: Dog[] = [];
	let sheetColors: Record<string, 'green' | 'yellow' | 'red'> = {};
	let logs: DayTripLog[] = [];
	let loading = true;
	let monthFilter = defaultMonth;
	let loaded = false;
	let activeTab: 'board' | 'log' | 'dogs' | 'stats' | 'import' = 'board';
	let boardColorFilter: 'green' | 'yellow' | null = null;

	let volunteers: Volunteer[] = [];
	let tripCopyText = '';
	let showAllLogs = false;
	let deletingTripId = '';
	let formOpen = false;
	let tripSaved = false;

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success('Copied!');
		} catch {
			toast.error('Copy failed — select and copy manually.');
		}
	}

	async function autoImportFromHiddenNotes() {
		const dogsWithNotes = dogs.filter(d => /day trip notes/i.test(d.hiddenComments ?? ''));
		if (dogsWithNotes.length === 0) return;

		let totalNew = 0;
		let totalPatched = 0;
		try {
			for (const dog of dogsWithNotes) {
				const parsed = parseDayTripNotes(dog.hiddenComments!);

				for (const trip of parsed) {
					const tripDay = trip.date.toDateString();
					const existing = logs.find(
						l => l.dogId === dog.id && toDate(l.startedAt)?.toDateString() === tripDay
					);

					if (existing) {
						// Patch only if notes/ratings are still empty
						const needsPatch =
							!existing.tripNotes &&
							!existing.reactionToDogs && !existing.reactionToStrangers &&
							!existing.reactionToCats && !existing.reactionToKids &&
							!existing.reactionToLeash && !existing.reactionToCarRides &&
							!existing.reactionToToys;
						if (!needsPatch) continue;
						await patchDayTripLog(dog.id, existing.id, {
							tripNotes: trip.tripNotes || null,
							reactionToDogs: trip.reactionToDogs,
							reactionToStrangers: trip.reactionToStrangers,
							reactionToCats: trip.reactionToCats,
							reactionToKids: trip.reactionToKids,
							reactionToLeash: trip.reactionToLeash,
							reactionToCarRides: trip.reactionToCarRides,
							reactionToToys: trip.reactionToToys,
						});
						totalPatched++;
					} else {
						await logManualTrip(dog.id, {
							startedAt: trip.date,
							endedAt: trip.date,
							volunteerName: null,
							reactionToDogs: trip.reactionToDogs,
							reactionToStrangers: trip.reactionToStrangers,
							reactionToCats: trip.reactionToCats,
							reactionToKids: trip.reactionToKids,
							reactionToLeash: trip.reactionToLeash,
							reactionToCarRides: trip.reactionToCarRides,
							reactionToToys: trip.reactionToToys,
							tripNotes: trip.tripNotes,
							source: 'staff',
						}, null);
						totalNew++;
					}
				}

				// Strip processed notes from hiddenComments
				const stripped = stripDayTripNotes(dog.hiddenComments!);
				if (stripped !== dog.hiddenComments) {
					await updateDog(dog.id, { hiddenComments: stripped });
				}
			}
		} catch (e) {
			console.error('[autoImport] error:', e);
			toast.error('Failed to sync some trips from hidden notes.');
			return;
		}

		const total = totalNew + totalPatched;
		if (total > 0) {
			await refresh();
			const parts = [];
			if (totalNew) parts.push(`${totalNew} new`);
			if (totalPatched) parts.push(`${totalPatched} updated`);
			toast.success(`Synced trips from hidden notes: ${parts.join(', ')}.`);
		}
	}

	$: {
		const canLoad = !firebaseEnabled || ($authReady && Boolean($authUser));
		if (canLoad && !loaded) {
			loaded = true;
			void refresh();
		}
	}

	$: activeDogs = dogs
		.filter((dog) => dog.status === 'active' && !dog.permanentFoster && !dog.inFoster)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: dtvNames = volunteers
		.filter((v) => (v.volunteerType ?? 'dtv') === 'dtv' && v.isEstablished && !v.isNonActive)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((v) => v.name);
	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canViewDayTrips = canAccessDayTrips($authProfile?.role);
	$: canEditDayTrips = checkCanEditDayTrips($authProfile?.role);

	$: monthStart = (() => {
		const [year, month] = monthFilter.split('-').map(Number);
		if (Number.isFinite(year) && Number.isFinite(month)) {
			return new Date(year, month - 1, 1);
		}
		return new Date(now.getFullYear(), now.getMonth(), 1);
	})();
	$: monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
	$: monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	$: currentYear = monthStart.getFullYear();

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

	$: allTimeTripsCountByDog = logs.reduce<Record<string, number>>((acc, log) => {
		acc[log.dogId] = (acc[log.dogId] ?? 0) + 1;
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

	$: dogsEligible = activeDogs.filter((d) => isDayTripEligible(d, sheetColors))
		.sort((a, b) => {
			const aDays = daysSince(a.lastDayTripDate) ?? 999;
			const bDays = daysSince(b.lastDayTripDate) ?? 999;
			return bDays - aDays;
		});

	$: dogsIneligible = activeDogs
		.filter((d) => !d.isOutOnDayTrip && !isDayTripEligible(d, sheetColors))
		.sort((a, b) => a.name.localeCompare(b.name));

	$: dogStatsRows = activeDogs.slice().sort((a, b) => {
		const aDays = daysSince(a.lastDayTripDate) ?? 9999;
		const bDays = daysSince(b.lastDayTripDate) ?? 9999;
		return bDays - aDays;
	});

	$: sortedMonthlyLogs = [...monthlyLogs]
		.filter((log) => Boolean(log.endedAt))
		.sort((a, b) => {
			const aTime = toDate(a.startedAt)?.getTime() ?? 0;
			const bTime = toDate(b.startedAt)?.getTime() ?? 0;
			return bTime - aTime;
		});

	$: visibleLogs = showAllLogs
		? [...logs].filter(l => Boolean(l.endedAt)).sort((a, b) => (toDate(b.startedAt)?.getTime() ?? 0) - (toDate(a.startedAt)?.getTime() ?? 0))
		: sortedMonthlyLogs;

	async function handleDeleteTrip(log: DayTripLog) {
		if (!confirm(`Delete this trip for ${dogs.find(d => d.id === log.dogId)?.name ?? 'this dog'}? This cannot be undone.`)) return;
		deletingTripId = log.id;
		try {
			await deleteDayTripLog(log.dogId, log.id);
			await refresh();
		} catch {
			toast.error('Failed to delete trip.');
		} finally {
			deletingTripId = '';
		}
	}

	$: yearLogs = logs.filter((log) => {
		const d = toDate(log.startedAt);
		return d ? d.getFullYear() === currentYear : false;
	});

	$: yearlyStats = (() => {
		const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
		const stats = MONTHS.map((name) => ({ name, trips: 0, hours: 0 }));
		for (const log of yearLogs) {
			const d = toDate(log.startedAt);
			if (!d) continue;
			stats[d.getMonth()].trips += 1;
			stats[d.getMonth()].hours += durationHours(log);
		}
		return stats;
	})();

	$: yearTripTotal = yearLogs.length;
	$: yearHourTotal = yearLogs.reduce((sum, log) => sum + durationHours(log), 0);

	function getEligibility(dog: Dog) {
		return checkDayTripEligibility(
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
			dog.surgeryDate,
			dog.surgeryRestDays,
			dog.awaitingEvaluation,
			role,
			new Date()
		);
	}

	async function refresh() {
		loading = true;
		try {
			let dogRows: typeof dogs = [];
			let colorsRes: Record<string, string> = {};
			[dogRows, logs, colorsRes, volunteers] = await Promise.all([
				listDogs(),
				listAllDayTripLogs(),
				fetch('/api/sheets/dog-colors').then(r => r.ok ? r.json() : {}).catch(() => ({})),
				listVolunteers()
			]);
			sheetColors = colorsRes as Record<string, 'green' | 'yellow' | 'red'>;
			dogs = dogRows;

			const evaluated = dogRows.filter((d) => {
				if (!d.awaitingEvaluation) return false;
				const key = d.name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
				return Boolean(colorsRes[key]);
			});
			if (evaluated.length > 0) {
				await Promise.all(evaluated.map((d) => updateDog(d.id, { awaitingEvaluation: false })));
				dogs = dogs.map((d) => evaluated.some((e) => e.id === d.id) ? { ...d, awaitingEvaluation: false } : d);
			}
		} catch (error) {
			const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
			toast.error(code ? `Unable to load day trip data (${code}).` : 'Unable to load day trip data.');
		} finally {
			loading = false;
		}
		void autoImportFromHiddenNotes();
	}

	function statusPillClass(status: Dog['dayTripStatus']) {
		if (status === 'eligible') return 'pill-green';
		if (status === 'difficult') return 'pill-yellow';
		return 'pill-red';
	}

	async function toggleOut(dog: Dog) {
		const eligibility = getEligibility(dog);
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
		await refresh();
	}
</script>

<svelte:head>
	<title>Day Trips | Cache Humane Society</title>
</svelte:head>

<section class="dt-page">
{#if !canViewDayTrips}
	<div class="dt-restricted">
		<p class="dt-restricted-title">Manager only</p>
		<p class="dt-restricted-sub">Day trips are available to manager and admin accounts only.</p>
	</div>
{:else}
	<div class="dt-shell">

		<!-- Top bar -->
		<div class="dt-topbar">
			<div class="dt-topbar-left">
				{#if outNowCount > 0}
					<span class="dt-chip dt-chip-blue">{outNowCount} out now</span>
				{/if}
				<span class="dt-chip">{monthLabel} · {monthlyTripCount} trips · {monthlyHourTotal.toFixed(1)}h</span>
			</div>
			<div class="dt-topbar-right">
				<button class="dt-btn-sm" on:click={refresh}>Refresh</button>
			</div>
		</div>

		<!-- Tab bar -->
		<nav class="dt-tabbar" aria-label="Day trip views">
			<button class="dt-tab" class:dt-tab-active={activeTab === 'board'} on:click={() => activeTab = 'board'}>Board</button>
			{#if canEditDayTrips}<button class="dt-tab" class:dt-tab-active={activeTab === 'log'} on:click={() => activeTab = 'log'}>Log</button>{/if}
			<button class="dt-tab" class:dt-tab-active={activeTab === 'dogs'} on:click={() => activeTab = 'dogs'}>Dogs</button>
			<button class="dt-tab" class:dt-tab-active={activeTab === 'stats'} on:click={() => activeTab = 'stats'}>Stats</button>
			{#if canEditDayTrips}<button class="dt-tab" class:dt-tab-active={activeTab === 'import'} on:click={() => activeTab = 'import'}>Import</button>{/if}
		</nav>

		{#if loading}
			<p class="dt-loading">Loading trip board...</p>

		<!-- ───── BOARD ───── -->
		{:else if activeTab === 'board'}
			<div class="cal-filters">
				<button class="cal-filter-pill" class:cal-filter-active={boardColorFilter === null} on:click={() => boardColorFilter = null}>All</button>
				<button class="cal-filter-pill cal-filter-green" class:cal-filter-active={boardColorFilter === 'green'} on:click={() => boardColorFilter = boardColorFilter === 'green' ? null : 'green'}>Green</button>
				<button class="cal-filter-pill cal-filter-yellow" class:cal-filter-active={boardColorFilter === 'yellow'} on:click={() => boardColorFilter = boardColorFilter === 'yellow' ? null : 'yellow'}>Yellow</button>
			</div>
			<div class="cal-board">

				<!-- Out Now -->
				<div class="cal-col">
					<div class="cal-col-head cal-col-head-blue">
						<span class="cal-col-title">Out Now</span>
						<span class="cal-col-badge cal-badge-blue">{dogsOut.length}</span>
					</div>
					{#if dogsOut.length === 0}
						<p class="cal-empty">None out right now</p>
					{:else}
						{#each dogsOut as dog}
							{@const openTrip = openTripByDog[dog.id]}
							{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
							<div class="cal-event cal-event-blue">
								<p class="cal-event-name"><a class="dog-name-link" href="/dogs/{dog.id}">{dog.name}</a></p>
								<p class="cal-event-meta">Kennel {dog.outdoorKennelAssignment || '—'}</p>
								<p class="cal-event-meta">Out since {formatDateTime(openTrip?.startedAt ?? dog.currentDayTripStartedAt)}</p>
								<p class="cal-event-count">{allTime} total trip{allTime !== 1 ? 's' : ''}</p>
								<button class="cal-btn cal-btn-blue" on:click={() => toggleOut(dog)}>Mark Returned</button>
							</div>
						{/each}
					{/if}
				</div>

				<!-- Eligible -->
				<div class="cal-col">
					<div class="cal-col-head cal-col-head-green">
						<span class="cal-col-title">Eligible</span>
						<span class="cal-col-badge cal-badge-green">{dogsEligible.length}</span>
					</div>
					{#if dogsEligible.length === 0}
						<p class="cal-empty">None ready</p>
					{:else}
						{#each dogsEligible.filter(d => !boardColorFilter || dogStripeColor(d, sheetColors) === boardColorFilter) as dog}
							{@const eligibility = getEligibility(dog)}
							{@const displayDays = daysSince(dog.lastDayTripDate)}
							{@const sinceReturnDays = getDayTripGapDays(dog, now)}
							{@const daysAtShelter = daysSince(dog.shelterSince ?? dog.intakeDate) ?? 0}
							{@const overdue = sinceReturnDays !== null ? sinceReturnDays >= DAYTRIP_OVERDUE_DAYS : daysAtShelter >= DAYTRIP_OVERDUE_DAYS}
							{@const stripe = dogStripeColor(dog, sheetColors)}
							{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
							<div class="cal-event" class:cal-event-red={stripe === 'red'} class:cal-event-orange={stripe === 'yellow'} class:cal-event-green={stripe === 'green'}>
								<p class="cal-event-name"><a class="dog-name-link" href="/dogs/{dog.id}">{dog.name}</a></p>
								<p class="cal-event-meta">Kennel {dog.outdoorKennelAssignment || '—'} · {displayDays !== null ? `${displayDays}d ago` : 'No trips yet'}</p>
								<div class="cal-event-tags">
									{#if eligibility.status === 'difficult'}<span class="cal-tag cal-tag-yellow">Adults only</span>{/if}
									{#if overdue}<span class="cal-tag cal-tag-red">Overdue</span>{/if}
								</div>
								<p class="cal-event-count">{allTime} trip{allTime !== 1 ? 's' : ''} total</p>
								{#if eligibility.reasons.length > 0}
									<p class="cal-event-warning">{eligibility.reasons[0]}</p>
								{/if}
								<button class="cal-btn cal-btn-green" on:click={() => toggleOut(dog)}>Send Out</button>
							</div>
						{/each}
					{/if}
				</div>

				<!-- Not Eligible -->
				<div class="cal-col">
					<div class="cal-col-head">
						<span class="cal-col-title">Not Eligible</span>
						<span class="cal-col-badge">{dogsIneligible.length}</span>
					</div>
					{#if dogsIneligible.length === 0}
						<p class="cal-empty">None</p>
					{:else}
						{#each dogsIneligible.filter(d => !boardColorFilter || dogStripeColor(d, sheetColors) === boardColorFilter) as dog}
							{@const eligibility = getEligibility(dog)}
							{@const stripe = dogStripeColor(dog, sheetColors)}
							<div class="cal-event" class:cal-event-red={stripe === 'red'} class:cal-event-orange={stripe === 'yellow'} class:cal-event-green={stripe === 'green'}>
								<p class="cal-event-name"><a class="dog-name-link" href="/dogs/{dog.id}">{dog.name}</a></p>
								<p class="cal-event-meta">{eligibility.reasons[0] ?? `Kennel ${dog.outdoorKennelAssignment || '—'}`}</p>
							</div>
						{/each}
					{/if}
				</div>

			</div>

		<!-- ───── LOG ───── -->
		{:else if activeTab === 'log'}
			<!-- Collapsible log form (coordinators only) -->
			{#if canEditDayTrips}
			<div class="dt-panel dt-logform-panel">
				<button class="dt-logform-toggle" on:click={() => { formOpen = !formOpen; tripSaved = false; tripCopyText = ''; }}>
					<span class="dt-logform-toggle-label">Log a trip</span>
					<span class="dt-logform-toggle-icon">{formOpen ? '▲' : '▼'}</span>
				</button>

				{#if formOpen}
					{#if tripSaved && tripCopyText}
						<div class="trip-copy-block">
							<p class="trip-copy-label">Saved — copy for ASM:</p>
							<pre class="trip-copy-pre">{tripCopyText}</pre>
							<div class="trip-copy-actions">
								<button class="dt-import-btn dt-import-btn-go" on:click={() => copyToClipboard(tripCopyText)}>Copy</button>
								<button class="dt-import-btn" on:click={() => { tripSaved = false; tripCopyText = ''; }}>Log another</button>
							</div>
						</div>
					{:else}
						<div class="trip-form-wrap">
							<TripLogForm
								dogs={dogsEligible}
								source="staff"
								profile={$authProfile}
								volunteerNames={dtvNames}
								on:submitted={async (e) => {
									tripCopyText = e.detail.copyText;
									tripSaved = true;
									await refresh();
								}}
							/>
						</div>
					{/if}
				{/if}
			</div>
			{/if}

			<div class="dt-panel">
				<div class="dt-panel-head">
					<div>
						<p class="dt-panel-title">{showAllLogs ? 'All trips' : monthLabel}</p>
						<p class="dt-panel-sub">{visibleLogs.length} completed trip{visibleLogs.length === 1 ? '' : 's'}{!showAllLogs ? ` · ${monthlyHourTotal.toFixed(1)} total hrs` : ''}
						{outNowCount > 0 ? ` · ${outNowCount} in progress` : ''}</p>
					</div>
					<div class="dt-log-controls">
						{#if !showAllLogs}
							<input class="dt-month-input" type="month" bind:value={monthFilter} />
						{/if}
						<button class="dt-toggle-btn" class:active={showAllLogs} on:click={() => showAllLogs = !showAllLogs}>
							{showAllLogs ? 'Show month' : 'All time'}
						</button>
					</div>
				</div>

				{#if visibleLogs.length === 0}
					<p class="dt-panel-empty">No completed trips logged{showAllLogs ? '.' : ` for ${monthLabel}.`}</p>
				{:else}
					<div class="dt-table-wrap">
						<table class="dt-table">
							<thead>
								<tr>
									<th>Date</th>
									<th>Dog</th>
									<th>Volunteer</th>
									<th>Time Out</th>
									<th>Time In</th>
									<th>Duration</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each visibleLogs as log}
									{@const startDate = toDate(log.startedAt)}
									{@const endDate = toDate(log.endedAt)}
									{@const dog = dogs.find(d => d.id === log.dogId)}
									<tr class:deleting={deletingTripId === log.id}>
										<td class="td-muted">{formatShortDate(startDate)}</td>
										<td class="td-name">
											{#if dog}
												<a href="/dogs/{dog.id}" class="dt-name-link">{dog.name}</a>
											{:else}
												<span class="td-muted">Unknown</span>
											{/if}
										</td>
										<td class="td-muted">{log.volunteerName || '—'}</td>
										<td class="td-muted">{formatTime(startDate)}</td>
										<td class="td-muted">{formatTime(endDate)}</td>
										<td class="td-strong">{formatDuration(durationHours(log))}</td>
										<td class="td-delete">
											<button class="dt-delete-btn" on:click={() => handleDeleteTrip(log)} disabled={deletingTripId === log.id} title="Delete trip">✕</button>
										</td>
									</tr>
									{#if log.tripNotes?.trim()}
										<tr class="tr-notes" class:deleting={deletingTripId === log.id}>
											<td colspan="7" class="td-notes">{log.tripNotes.trim()}</td>
										</tr>
									{/if}
								{/each}
							</tbody>
							{#if !showAllLogs}
							<tfoot>
								<tr class="dt-table-foot">
									<td colspan="5" class="td-foot-label">Total</td>
									<td class="td-strong">{formatDuration(monthlyHourTotal)}</td>
									<td></td>
								</tr>
							</tfoot>
							{/if}
						</table>
					</div>
				{/if}
			</div>

		<!-- ───── DOGS ───── -->
		{:else if activeTab === 'dogs'}
			<div class="dt-panel">
				<div class="dt-panel-head">
					<div>
						<p class="dt-panel-title">All Dogs</p>
						<p class="dt-panel-sub">Sorted by most overdue · {monthStart.toLocaleDateString('en-US', { month: 'short' })} stats shown for monthly columns</p>
					</div>
				</div>

				<div class="dt-table-wrap">
					<table class="dt-table">
						<thead>
							<tr>
								<th>Dog</th>
								<th class="th-center">All-Time</th>
								<th>Last Trip</th>
								<th class="th-center">{monthStart.toLocaleDateString('en-US', { month: 'short' })} Trips</th>
								<th class="th-center">{monthStart.toLocaleDateString('en-US', { month: 'short' })} Hrs</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{#each dogStatsRows as dog}
								{@const displayDays = daysSince(dog.lastDayTripDate)}
								{@const sinceReturnDays = getDayTripGapDays(dog, now)}
								{@const daysAtShelter = daysSince(dog.shelterSince ?? dog.intakeDate) ?? 0}
								{@const overdue = sinceReturnDays !== null ? sinceReturnDays >= DAYTRIP_OVERDUE_DAYS : daysAtShelter >= DAYTRIP_OVERDUE_DAYS}
								{@const eligibility = getEligibility(dog)}
								{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
								<tr class:tr-overdue={overdue && eligibility.eligible && !dog.isOutOnDayTrip}>
									<td class="td-name">
										<a href="/dogs/{dog.id}" class="dt-name-link">{dog.name}</a>
										{#if dog.isOutOnDayTrip}
											<span class="dt-out-badge">out now</span>
										{/if}
									</td>
									<td class="td-center">
										<span class="dt-alltime-num">{allTime}</span>
									</td>
									<td class="td-muted">
										{#if displayDays !== null}
											{displayDays}d ago{#if overdue && eligibility.eligible && !dog.isOutOnDayTrip}&thinsp;<span class="dt-overdue-flag">overdue</span>{/if}
										{:else}
											never
										{/if}
									</td>
									<td class="td-center td-muted">{tripCountByDog[dog.id] ?? 0}</td>
									<td class="td-center td-muted">{(tripHoursByDog[dog.id] ?? 0).toFixed(1)}</td>
									<td>
										{#if dog.isOutOnDayTrip}
											<span class="dt-on-trip-tag">on trip</span>
										{:else}
											<span class={`pill pill-sm ${statusPillClass(eligibility.status)}`}>{eligibility.status === 'eligible' ? 'Eligible' : eligibility.status === 'difficult' ? 'Difficult' : 'Ineligible'}</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

		<!-- ───── STATS ───── -->
		{:else if activeTab === 'stats'}
			{#await import('$lib/components/daytrips/StatsTab.svelte')}
			<p class="dt-loading">Loading stats…</p>
		{:then mod}
			<svelte:component this={mod.default} {logs} {dogs} {activeDogs} />
		{/await}

		<!-- ───── IMPORT ───── -->
		{:else if activeTab === 'import'}
			<ImportTab {dogs} {refresh} />
		{/if}

	</div>
{/if}
</section>

<style>
	/* ── Shell ── */
	.dt-page { width: 100%; max-width: 100%; overflow-x: hidden; }


	.dt-restricted {
		padding: 3rem 1.5rem;
		text-align: center;
	}

	.dt-restricted-title {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 0.4rem;
	}

	.dt-restricted-sub {
		font-size: 0.85rem;
		color: #5f6368;
		margin: 0;
	}


	.dt-shell {
		display: grid;
		gap: 0;
	}


	/* ── Top bar ── */
	.dt-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0 0.1rem 0.6rem;
	}


	.dt-topbar-left {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}


	.dt-topbar-right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}


	.dt-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.22rem 0.6rem;
		border-radius: 999px;
		background: #f1f3f4;
		font-size: 0.72rem;
		font-weight: 500;
		color: #5f6368;
	}


	.dt-chip-blue {
		background: #e8f0fe;
		color: #1a73e8;
	}


	.dt-month-input {
		height: 2rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0 0.5rem;
		font-size: 0.82rem;
		color: #202124;
		background: #fff;
	}


	.dt-btn-sm {
		height: 2rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0 0.75rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: #3c4043;
		background: #fff;
		cursor: pointer;
	}


	.dt-btn-sm:hover { background: #f8f9fa; }


	/* ── Tab bar ── */
	.dt-tabbar {
		display: flex;
		border-bottom: 1px solid #dadce0;
		margin-bottom: 0.9rem;
		gap: 0;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}

	.dt-tabbar::-webkit-scrollbar { display: none; }


	.dt-tab {
		position: relative;
		padding: 0.6rem 0.9rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: #5f6368;
		background: none;
		border: none;
		cursor: pointer;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}


	.dt-tab:hover { color: #1a73e8; background: #f8f9fa; }


	.dt-tab-active {
		color: #1a73e8;
	}


	.dt-tab-active::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: 0;
		right: 0;
		height: 2px;
		background: #1a73e8;
		border-radius: 2px 2px 0 0;
	}


	/* ── Loading ── */
	.dt-loading {
		padding: 1.5rem;
		color: #5f6368;
		font-size: 0.88rem;
	}


	/* ── Calendar Board ── */
	.cal-board {
		display: grid;
		gap: 0.75rem;
	}


	.cal-col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}


	.cal-col-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0.6rem;
		border-radius: 6px 6px 0 0;
		border-bottom: 2px solid #dadce0;
	}


	.cal-col-head-blue { border-bottom-color: #016aa5; }

	.cal-col-head-green { border-bottom-color: #3aaf2a; }


	.cal-col-title {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #3c4043;
	}


	.cal-col-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.35rem;
		height: 1.35rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		background: #f1f3f4;
		color: #5f6368;
	}


	.cal-badge-blue { background: #e8f0fe; color: #1a73e8; }

	.cal-badge-green { background: #e6f4ea; color: #1e7e34; }


	.cal-empty {
		font-size: 0.78rem;
		color: #9aa0a6;
		padding: 0.5rem 0.6rem;
	}


	/* ── Board filters ── */
	.cal-filters {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1rem 0;
	}

	.cal-filter-pill {
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.78rem;
		font-weight: 500;
		color: #5f6368;
		cursor: pointer;
	}

	.cal-filter-pill.cal-filter-active { border-color: #5f6368; background: #f1f3f4; color: #202124; }

	.cal-filter-green.cal-filter-active { border-color: #3aaf2a; background: #e8f5e9; color: #2a6248; }

	.cal-filter-yellow.cal-filter-active { border-color: #f29900; background: #fff8e1; color: #7a5100; }


	/* ── Event chips ── */
	.cal-event {
		background: #fff;
		border: 1px solid #dadce0;
		border-left-width: 4px;
		border-radius: 6px;
		padding: 0.6rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		box-shadow: 0 1px 2px rgba(60,64,67,.06);
	}


	.cal-event-blue  { border-left-color: #016aa5; }

	.cal-event-green { border-left-color: #3aaf2a; }

	.cal-event-orange { border-left-color: #f29900; }

	.cal-event-red   { border-left-color: #cf4b4b; }

	.cal-event-gray  { border-left-color: #bdc1c6; opacity: 0.7; }


	.cal-event-name {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 600;
		color: #202124;
		line-height: 1.2;
	}


	.cal-event-meta {
		margin: 0;
		font-size: 0.72rem;
		color: #5f6368;
	}


	.cal-event-count {
		margin: 0;
		font-size: 0.68rem;
		color: #9aa0a6;
	}


	.cal-event-warning {
		margin: 0;
		font-size: 0.72rem;
		color: #d93025;
	}


	.cal-event-tags {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}


	.cal-tag {
		display: inline-flex;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.03em;
	}


	.cal-tag-yellow { background: #fef7e0; color: #b06000; }

	.cal-tag-red    { background: #fce8e6; color: #c5221f; }


	.cal-btn {
		margin-top: 0.3rem;
		align-self: flex-start;
		padding: 0.28rem 0.7rem;
		border-radius: 4px;
		font-size: 0.72rem;
		font-weight: 500;
		border: 1px solid #dadce0;
		background: #fff;
		cursor: pointer;
		color: #3c4043;
	}


	.cal-btn:hover { background: #f8f9fa; }


	.cal-btn-blue  { border-color: #aecbfa; color: #1a73e8; background: #e8f0fe; }

	.cal-btn-blue:hover  { background: #d2e3fc; }

	.cal-btn-green { border-color: #a8d5a2; color: #1e7e34; background: #e6f4ea; }

	.cal-btn-green:hover { background: #ceead6; }


	@media (min-width: 640px) {
		.cal-board {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}


	/* ── Panel (Log / Dogs / Stats / Import) ── */
	.dt-panel {
		border: 1px solid #dadce0;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 1px 3px rgba(60,64,67,.08);
		padding: 1rem;
		display: grid;
		gap: 0.8rem;
	}


	.dt-panel-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}


	.dt-panel-title {
		font-size: 1rem;
		font-weight: 600;
		color: #202124;
		margin: 0 0 0.15rem;
	}


	.dt-panel-sub {
		font-size: 0.72rem;
		color: #5f6368;
		margin: 0;
	}


	.dt-logform-panel { padding: 0; overflow: hidden; }


	.dt-logform-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.75rem 1rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}


	.dt-logform-toggle:hover { background: #f8f9fa; }


	.dt-logform-toggle-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: #016aa5;
	}


	.dt-logform-toggle-icon {
		font-size: 0.65rem;
		color: #9aa0a6;
	}


	.trip-form-wrap { padding: 0 20px 20px; }

	.trip-copy-block { padding: 0 1rem 1rem; }


	.dt-log-controls {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}


	.dt-toggle-btn {
		padding: 0.28rem 0.7rem;
		border-radius: 4px;
		font-size: 0.72rem;
		font-weight: 500;
		border: 1px solid #dadce0;
		background: #fff;
		color: #3c4043;
		cursor: pointer;
		white-space: nowrap;
	}


	.dt-toggle-btn:hover { background: #f8f9fa; }

	.dt-toggle-btn.active { background: #e8f0fe; border-color: #aecbfa; color: #1a73e8; }


	.td-delete { width: 2rem; text-align: center; }


	.dt-delete-btn {
		background: none;
		border: none;
		color: #bdc1c6;
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		line-height: 1;
	}


	.dt-delete-btn:hover { color: #cf4b4b; background: #fce8e6; }

	.dt-delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }


	tr.deleting { opacity: 0.4; pointer-events: none; }


	.tr-notes { background: #fafbfc; }

	.td-notes {
		padding: 0.3rem 0.75rem 0.55rem 0.75rem;
		font-size: 0.78rem;
		color: #5f6368;
		font-style: italic;
		border-top: none;
	}


	.dt-panel-empty {
		font-size: 0.82rem;
		color: #9aa0a6;
	}


	/* ── Table ── */
	.dt-table-wrap {
		overflow-x: auto;
		border: 1px solid #dadce0;
		border-radius: 6px;
	}


	.dt-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		min-width: 400px;
	}


	.dt-table th {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5f6368;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #dadce0;
		background: #f8f9fa;
		white-space: nowrap;
	}


	.dt-table td {
		padding: 0.55rem 0.75rem;
		border-top: 1px solid #f1f3f4;
		vertical-align: middle;
		font-size: 0.82rem;
	}


	.dt-table tbody tr:first-child td { border-top: none; }

	.dt-table tbody tr:hover td { background: #f8f9fa; }


	.td-name { font-weight: 600; color: #202124; }

	.td-muted { color: #5f6368; }

	.td-strong { font-weight: 600; color: #202124; }

	.td-center { text-align: center; }

	.th-center { text-align: center; }

	.td-month-name { font-weight: 600; color: #202124; }


	.dt-name-link { color: inherit; text-decoration: none; }

	.dt-name-link:hover { color: #1a73e8; text-decoration: underline; }


	.dt-table-foot td {
		border-top: 2px solid #dadce0;
		background: #f8f9fa;
	}


	.td-foot-label {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5f6368;
	}


	.tr-overdue td { background: #fffbf0; }


	/* ── Badges / Tags ── */
	.dt-out-badge {
		display: inline-block;
		margin-left: 0.3rem;
		padding: 0.06rem 0.35rem;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 600;
		background: #e8f0fe;
		color: #1a73e8;
		vertical-align: middle;
	}


	.dt-overdue-flag {
		display: inline-block;
		margin-left: 0.2rem;
		padding: 0.04rem 0.28rem;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 600;
		background: #fce8e6;
		color: #c5221f;
		vertical-align: middle;
	}


	.dt-on-trip-tag {
		display: inline-flex;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		font-size: 0.66rem;
		font-weight: 600;
		background: #e8f0fe;
		color: #1a73e8;
	}


	.dt-alltime-num {
		font-size: 0.88rem;
		font-weight: 700;
		color: #202124;
	}


	.pill-sm { font-size: 0.62rem; padding: 0.1rem 0.34rem; }


	/* ── Import Tab ── */
	.dt-import-panel { display: grid; gap: 0.9rem; }


	.dt-import-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}


	.dt-import-btn {
		display: inline-flex;
		align-items: center;
		height: 2rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0 0.9rem;
		background: #fff;
		font-size: 0.78rem;
		font-weight: 500;
		color: #3c4043;
		cursor: pointer;
	}


	.dt-import-btn:hover:not(:disabled) { background: #f8f9fa; }

	.dt-import-btn:disabled { opacity: 0.5; cursor: not-allowed; }


	.dt-import-btn-go {
		border-color: #a8d5a2;
		background: #e6f4ea;
		color: #1e7e34;
	}


	.dt-import-btn-go:hover:not(:disabled) { background: #ceead6; }


	.dt-import-done  { font-size: 0.74rem; font-weight: 600; color: #1e7e34; }

	.dt-import-loaded { font-size: 0.74rem; font-weight: 500; color: #1a73e8; }

	.dt-import-error  { font-size: 0.74rem; font-weight: 600; color: #d93025; }


	.dt-import-preview, .dt-import-log { display: grid; gap: 0.38rem; }


	.dt-import-section-label {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5f6368;
		margin: 0;
	}






	.dt-import-create {
		font-size: 0.72rem;
		font-weight: 600;
		color: #b06000;
		display: block;
		margin-bottom: 0.2rem;
	}


	.dt-import-match { color: #1e7e34; font-weight: 600; font-size: 0.82rem; }

	.dt-import-miss  { color: #d93025; font-size: 0.74rem; }


	.dt-import-override {
		font-size: 0.76rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		background: #fff;
		color: #202124;
		max-width: 14rem;
	}


	.dt-import-dates { font-size: 0.72rem; color: #5f6368; }


	.dt-import-log-pre {
		margin: 0;
		padding: 0.7rem 0.9rem;
		background: #f8f9fa;
		border: 1px solid #dadce0;
		border-radius: 6px;
		font-size: 0.75rem;
		line-height: 1.7;
		color: #202124;
		white-space: pre-wrap;
	}


	/* ── Trip log form ── */
	.dt-logform-panel { display: grid; gap: 0.9rem; }


	.trip-form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.7rem;
	}


	.trip-field { display: flex; flex-direction: column; gap: 0.3rem; }

	.trip-field-wide { grid-column: 1 / -1; }


	.trip-label {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5f6368;
	}


	.trip-input, .trip-select {
		height: 2.1rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0 0.6rem;
		font-size: 0.82rem;
		color: #202124;
		background: #fff;
		width: 100%;
	}


	.trip-textarea {
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0.4rem 0.6rem;
		font-size: 0.82rem;
		color: #202124;
		background: #fff;
		resize: vertical;
		width: 100%;
		font-family: inherit;
	}


	.trip-ratings-grid { display: grid; gap: 0.4rem; }


	.trip-rating-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}


	.trip-rating-label {
		font-size: 0.78rem;
		color: #3c4043;
		min-width: 5rem;
	}


	.trip-rating-btns { display: flex; gap: 0.3rem; flex-wrap: wrap; }


	.trip-rating-btn {
		padding: 0.2rem 0.6rem;
		border-radius: 4px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.72rem;
		color: #5f6368;
		cursor: pointer;
	}


	.trip-rating-btn.active { border-color: #016aa5; background: #e8f0fe; color: #016aa5; font-weight: 600; }

	.trip-rating-btn:hover:not(.active) { background: #f8f9fa; }


	.trip-actions { padding-top: 0.2rem; }


	.trip-copy-block { display: grid; gap: 0.5rem; }


	.trip-copy-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: #1e7e34;
	}


	.trip-copy-pre {
		margin: 0;
		padding: 0.75rem 1rem;
		background: #f8f9fa;
		border: 1px solid #dadce0;
		border-radius: 6px;
		font-size: 0.8rem;
		line-height: 1.6;
		white-space: pre-wrap;
		color: #202124;
	}


	.trip-copy-actions { display: flex; gap: 0.5rem; }


	/* ── Volunteers ── */
	.vol-shell {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}


	/* Header row */
	.vol-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}


	.vol-header-left {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
	}


	.vol-header-title {
		font-size: 1rem;
		font-weight: 700;
		color: #202124;
	}


	.vol-header-count {
		font-size: 0.82rem;
		font-weight: 600;
		color: #9aa0a6;
	}


	.vol-header-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}


	.vol-sync-btn {
		height: 2rem;
		border-color: #b8d7ee;
		background: #f8fbff;
		color: #016aa5;
		font-weight: 700;
	}


	.vol-sync-btn:hover:not(:disabled) {
		background: #e8f4fd;
		border-color: #8bbfe4;
	}


	/* Next orientation hero */
	.vol-next-hero {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: #f8faff;
		border: 1px solid #dadce0;
		border-radius: 8px;
		flex-wrap: wrap;
	}


	/* Calendar day tile */
	.vol-cal-icon {
		display: flex;
		flex-direction: column;
		align-items: center;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid #dadce0;
		min-width: 3.8rem;
		flex-shrink: 0;
		box-shadow: 0 1px 3px rgba(0,0,0,0.08);
	}


	.vol-cal-month {
		width: 100%;
		background: #016aa5;
		color: #fff;
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-align: center;
		padding: 0.22rem 0;
		text-transform: uppercase;
	}


	.vol-cal-day {
		background: #fff;
		width: 100%;
		text-align: center;
		font-size: 1.9rem;
		font-weight: 700;
		color: #202124;
		line-height: 1.1;
		padding: 0.15rem 0 0;
	}


	.vol-cal-weekday {
		background: #fff;
		width: 100%;
		text-align: center;
		font-size: 0.52rem;
		font-weight: 600;
		color: #5f6368;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0 0 0.22rem;
	}


	.vol-next-hero-right {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		flex: 1;
		min-width: 0;
	}


	.vol-next-hero-label {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #016aa5;
	}


	.vol-next-hero-names {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}


	.vol-next-hero-name {
		padding: 0.2rem 0.55rem;
		background: #e8f0fe;
		border: 1px solid #aecbfa;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
		color: #016aa5;
	}


	.vol-add-cal-btn {
		padding: 0.22rem 0.65rem;
		border-radius: 4px;
		border: 1px solid #aecbfa;
		background: #fff;
		font-size: 0.72rem;
		font-weight: 600;
		color: #1a73e8;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		margin-left: auto;
	}

	.vol-add-cal-btn:hover { background: #e8f0fe; }


	/* Also-upcoming list */
	.vol-upcoming {
		border: 1px solid #dadce0;
		border-radius: 6px;
		overflow: hidden;
	}


	.vol-section-label {
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #5f6368;
		margin: 0;
		padding: 0.4rem 0.75rem;
		background: #f8f9fa;
		border-bottom: 1px solid #dadce0;
	}


	.vol-upcoming-date-group {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		padding: 0.45rem 0.75rem;
		border-bottom: 1px solid #f1f3f4;
	}


	.vol-upcoming-date-group:last-child { border-bottom: none; }


	.vol-upcoming-date-label {
		font-size: 0.75rem;
		font-weight: 700;
		color: #1a73e8;
		white-space: nowrap;
		min-width: 8rem;
		padding-top: 0.1rem;
	}


	.vol-upcoming-names {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}


	.vol-upcoming-name-chip {
		font-size: 0.75rem;
		color: #202124;
		font-weight: 500;
	}


	.vol-upcoming-name-chip:not(:last-child)::after {
		content: ',';
		color: #9aa0a6;
	}


	/* Attention indicator */
	.vol-alert-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1rem;
		height: 1.1rem;
		background: #f9ab00;
		color: #fff;
		border-radius: 50%;
		font-size: 0.65rem;
		font-weight: 800;
		flex-shrink: 0;
		line-height: 1;
	}


	.vol-card-alert { outline: 2px solid #f9ab00; outline-offset: -1px; }


	.vol-alert-reason {
		font-size: 0.68rem;
		font-weight: 600;
		color: #7a5800;
		white-space: nowrap;
	}


	.vol-filter-attention { border-color: #f9ab00; color: #7a5800; background: #fff8e1; }

	.vol-filter-attention:hover { background: #fff3cc; }

	.vol-filter-attention.vol-filter-active { background: #f9ab00; border-color: #f9ab00; color: #fff; }


	/* Search + filter bar */
	.vol-controls-bar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}


	.vol-search-input {
		height: 2rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0 0.6rem;
		font-size: 0.82rem;
		color: #202124;
		background: #fff;
		width: 11rem;
		flex-shrink: 0;
	}


	.vol-filter-pills {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
	}


	.vol-filter-pill {
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.72rem;
		font-weight: 500;
		color: #5f6368;
		cursor: pointer;
		white-space: nowrap;
		line-height: 1.4;
	}


	.vol-filter-pill:hover { background: #f1f3f4; color: #202124; }


	.vol-filter-active {
		background: #016aa5;
		border-color: #016aa5;
		color: #fff;
	}


	.vol-filter-active:hover { background: #015a8e; }


	.vol-filter-flagged { border-color: #fde68a; color: #b06000; }

	.vol-filter-flagged:hover { background: #fffde7; }

	.vol-filter-flagged.vol-filter-active { background: #b06000; border-color: #b06000; color: #fff; }


	/* Volunteer list */
	.vol-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}


	.vol-card {
		border: 1px solid #dadce0;
		border-radius: 6px;
		overflow: hidden;
		background: #fff;
	}


	.vol-card-open {
		box-shadow: 0 1px 4px rgba(0,0,0,0.10);
	}


	/* Status-based card colors — left border accent + background tint matching sheet colors */
	.vol-card-pending      { border-left: 3px solid #dadce0; background: #fff; }

	.vol-card-emailed      { border-left: 3px solid #6fa8dc; background: #cfe2f3; }

	.vol-card-scheduled    { border-left: 3px solid #f9ab00; background: #fff2cc; }

	.vol-card-signed_waiver{ border-left: 3px solid #6aa84f; background: #d9ead3; }

	.vol-card-answered_no  { border-left: 3px solid #cc0000; background: #f4cccc; }

	.vol-card-no_showed    { border-left: 3px solid #cc0000; background: #f4cccc; }

	.vol-card-established  { border-left: 3px solid #3aaf2a; background: #d9ead3; }


	.vol-card-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.75rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
	}


	.vol-card-row:hover { background: #f8f9fa; }


	.vol-card-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}


	.vol-card-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: #202124;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	.vol-card-email {
		font-size: 0.74rem;
		color: #5f6368;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	.vol-card-warning {
		width: fit-content;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		background: #fff8e1;
		border: 1px solid #f9ab00;
		color: #7a5800;
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1.35;
	}


	.vol-card-right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}


	.vol-card-chevron {
		font-size: 0.55rem;
		color: #9aa0a6;
	}


	/* Expanded detail panel */
	.vol-card-detail {
		padding: 0.75rem;
		border-top: 1px solid #f1f3f4;
		background: #fafafa;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}


	/* Status stepper */
	.vol-stepper {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
	}


	.vol-step-btn {
		padding: 0.2rem 0.6rem;
		border-radius: 4px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.72rem;
		font-weight: 500;
		color: #5f6368;
		cursor: pointer;
	}


	.vol-step-btn:hover { background: #f8f9fa; color: #202124; }


	.vol-step-active {
		border-color: #016aa5;
		background: #e8f0fe;
		color: #016aa5;
		font-weight: 600;
	}


	/* Info grid */
	.vol-info-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}


	/* Detail fields */
	.vol-detail-field { display: flex; flex-direction: column; gap: 0.2rem; }


	.vol-detail-label {
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #9aa0a6;
	}


	.vol-detail-val {
		font-size: 0.78rem;
		color: #202124;
		line-height: 1.4;
	}


	/* Notes */
	.vol-notes-input {
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0.4rem 0.6rem;
		font-size: 0.78rem;
		color: #202124;
		font-family: inherit;
		resize: vertical;
		width: 100%;
		background: #fff;
	}


	.vol-notes-actions { display: flex; gap: 0.5rem; margin-top: 0.3rem; }


	/* Card actions row */
	.vol-card-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding-top: 0.25rem;
		border-top: 1px solid #f1f3f4;
	}


	/* Date fields */
	.vol-date-chip {
		font-size: 0.7rem;
		font-weight: 500;
		color: #1a73e8;
		background: #e8f0fe;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		white-space: nowrap;
	}


	.vol-date-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}


	.vol-date-input {
		height: 2rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0 0.5rem;
		font-size: 0.82rem;
		color: #202124;
		background: #fff;
	}


	.vol-date-inline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}


	.vol-date-unset {
		font-size: 0.72rem;
		color: #9aa0a6;
		font-style: italic;
	}


	/* Status pills */
	.vol-status {
		display: inline-flex;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 600;
		white-space: nowrap;
	}


	.vol-status-green  { background: #e6f4ea; color: #1e7e34; }

	.vol-status-blue   { background: #e8f0fe; color: #1a73e8; }

	.vol-status-yellow { background: #fef7e0; color: #b06000; }

	.vol-status-red    { background: #fce8e6; color: #c5221f; }

	.vol-status-gray   { background: #f1f3f4; color: #5f6368; }

	.vol-status-dtv    { background: #e6f4ea; color: #1e7e34; }


	/* Empty state */
	.vol-empty-state {
		font-size: 0.82rem;
		color: #9aa0a6;
		text-align: center;
		padding: 1.5rem 0;
		margin: 0;
	}


	/* Dropout / delete buttons */
	.vol-dropout-btn { color: #b06000; border-color: #fde68a; }

	.vol-dropout-btn:hover:not(:disabled) { background: #fffde7; }

	.vol-delete-btn { color: #c5221f; border-color: #f5c6cb; }

	.vol-delete-btn:hover:not(:disabled) { background: #fce8e6; }


	/* ── IHV type toggle ── */
	.vol-type-toggle {
		display: flex;
		gap: 0;
		border: 1px solid #dadce0;
		border-radius: 6px;
		overflow: hidden;
		align-self: flex-start;
	}


	.vol-type-btn {
		padding: 0.35rem 0.9rem;
		font-size: 0.76rem;
		font-weight: 600;
		color: #5f6368;
		background: #fff;
		border: none;
		cursor: pointer;
		border-right: 1px solid #dadce0;
	}


	.vol-type-btn:last-child { border-right: none; }

	.vol-type-btn:hover { background: #f1f3f4; color: #202124; }


	.vol-type-active {
		background: #016aa5;
		color: #fff;
	}


	.vol-type-active:hover { background: #015a8e; }


	/* ── IHV training steps ── */
	.vol-training-steps {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}


	.vol-training-step {
		display: inline-flex;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		font-size: 0.65rem;
		font-weight: 600;
		background: #f1f3f4;
		color: #9aa0a6;
	}


	.vol-training-done {
		background: #e6f4ea;
		color: #1e7e34;
	}


	.vol-phone-link {
		color: #1a73e8;
		text-decoration: none;
	}


	.vol-phone-link:hover { text-decoration: underline; }


	.vol-cross-role-badge {
		display: inline-flex;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 700;
		background: #f3e8ff;
		color: #7c3aed;
		border: 1px solid #ddd6fe;
		white-space: nowrap;
	}


	/* ── Responsive ── */
	@media (max-width: 640px) {

		.vol-shell {
			gap: 0.75rem;
		}

		.vol-header {
			align-items: center;
			flex-direction: row;
			flex-wrap: wrap;
			gap: 0.45rem 0.65rem;
		}

		.vol-header-left {
			flex: 1 1 auto;
			min-width: 0;
		}

		.vol-header-right {
			align-items: center;
			flex: 0 0 auto;
			margin-left: auto;
		}

		.vol-sync-btn {
			height: 1.85rem;
			padding: 0 0.7rem;
			font-size: 0.72rem;
			white-space: nowrap;
		}

		/* Contain any overflow so a wide child can't push the page wider */
		.vol-shell { overflow-x: hidden; }
		.vol-list   { overflow-x: hidden; }

.vol-upcoming-date-group {
			flex-direction: column;
			gap: 0.35rem;
		}

		.vol-upcoming-date-label {
			min-width: 0;
		}

		.vol-controls-bar {
			align-items: stretch;
			flex-direction: column;
			gap: 0.5rem;
		}

		.vol-search-input {
			width: 100%;
		}

		.vol-filter-pills {
			flex-wrap: wrap;
		}

		/* Card rows: name + email on top, then right-side items below */
		.vol-card-row {
			align-items: flex-start;
			flex-wrap: wrap;
			gap: 0.35rem 0.5rem;
			padding: 0.65rem 0.75rem;
		}

		.vol-card-main { flex: 1 1 0; min-width: 0; }

		.vol-card-right {
			flex: 0 0 100%;
			flex-wrap: wrap;
			gap: 0.3rem;
			justify-content: flex-start;
		}

		/* Hide verbose reason on mobile — the ! dot + tooltip is enough */
		.vol-alert-reason { display: none; }

		.vol-card-chevron { margin-left: auto; }

		.vol-card-detail { padding: 0.65rem 0.75rem; }

		.vol-stepper,
		.vol-card-actions,
		.vol-date-row,
		.vol-date-inline,
		.vol-notes-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.vol-step-btn,
		.vol-date-input {
			width: 100%;
		}

		.vol-info-grid { grid-template-columns: 1fr; }
	}


	@media (min-width: 768px) {
		.dt-panel { padding: 1.2rem; }
	}

</style>
