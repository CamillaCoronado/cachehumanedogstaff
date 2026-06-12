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
	import LogTab from '$lib/components/daytrips/LogTab.svelte';
	import BoardTab from '$lib/components/daytrips/BoardTab.svelte';
	import DogsTab from '$lib/components/daytrips/DogsTab.svelte';
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
		.filter((dog) => dog.status === 'active' && !dog.permanentFoster && !dog.inFoster && !dog.isIncoming)
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
			<BoardTab {dogsOut} {dogsEligible} {dogsIneligible} {openTripByDog}
				{allTimeTripsCountByDog} {sheetColors} {getEligibility} {toggleOut} />

		<!-- ───── LOG ───── -->
		{:else if activeTab === 'log'}
			<LogTab {dogs} {logs} {monthlyLogs} {monthLabel} {monthlyHourTotal} {outNowCount}
				{dogsEligible} {dtvNames} {canEditDayTrips} bind:monthFilter {refresh} />

		<!-- ───── DOGS ───── -->
		{:else if activeTab === 'dogs'}
			<DogsTab {dogStatsRows} {monthStart} {tripCountByDog} {tripHoursByDog}
				{allTimeTripsCountByDog} {getEligibility} />

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

</style>
