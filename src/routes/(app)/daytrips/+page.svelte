<script lang="ts">
	import toast from 'svelte-french-toast';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { resolveRole } from '$lib/utils/permissions';
	import { listDogs, startDayTrip, endDayTrip, listAllDayTripLogs, importHistoricalDayTrip, mergeDayTripLogs, updateDog, createDog, deleteDog } from '$lib/data/dogs';
	import type { DayTripLog, Dog, UserRole } from '$lib/types';
	import { checkDayTripEligibility, daysSince, formatDateTime, toDate } from '$lib/utils/dates';

	const now = new Date();
	const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	let dogs: Dog[] = [];
	let logs: DayTripLog[] = [];
	let loading = true;
	let monthFilter = defaultMonth;
	let loaded = false;
	let activeTab: 'board' | 'log' | 'dogs' | 'stats' | 'import' = 'board';

	// ── Import state ──
	let sheetData: { name: string; dates: string[] }[] = [];
	let sheetLoading = false;
	let sheetError = '';

	async function loadFromSheet() {
		sheetLoading = true;
		sheetError = '';
		importDryRunDone = false;
		importDone = false;
		importPreview = [];
		importLog = [];
		try {
			const res = await fetch('/api/sheets/daytrips');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			sheetData = await res.json();
		} catch (e) {
			sheetError = e instanceof Error ? e.message : String(e);
		} finally {
			sheetLoading = false;
		}
	}

	interface ImportPreviewRow {
		sheetName: string;
		dogId: string | null;
		dogName: string | null;
		dates: string[];
		tripCount: number;
		matched: boolean;
		willCreate: boolean;
		asmStatus?: string;  // status found in ASM for unmatched dogs
		overrideId?: string;
	}

	let importPreview: ImportPreviewRow[] = [];
	let importDryRunDone = false;
	let importing = false;
	let importDone = false;
	let importLog: string[] = [];

	// ── Merge duplicates ──
	let merging = false;
	let mergeDryRunDone = false;
	let mergeLog: string[] = [];

	interface MergePreviewRow {
		created: Dog;
		match: Dog | null;
		tripDates: string[];
		datesMatch: boolean;
	}
	let mergePreview: MergePreviewRow[] = [];

	// Strict name match: first word must be identical (case-insensitive), or base name matches exactly
	function strictMatchName(candidate: string, target: string): boolean {
		const a = candidate.toLowerCase().trim();
		const b = target.toLowerCase().trim();
		if (a === b) return true;
		// Strip parentheticals from either side and compare
		const aBase = a.replace(/\s*\(.*?\)\s*$/, '').trim();
		const bBase = b.replace(/\s*\(.*?\)\s*$/, '').trim();
		if (aBase === bBase) return true;
		if (aBase === b || a === bBase) return true;
		return false;
	}

	async function runMergeDryRun() {
		mergeLog = [];
		mergeDryRunDone = false;
		mergePreview = [];

		// Build trip date lookup from loaded logs
		const tripDatesByDog: Record<string, string[]> = {};
		for (const log of logs) {
			const d = toDate(log.startedAt);
			if (!d) continue;
			const ds = `${d.getMonth() + 1}/${d.getDate()}`;
			(tripDatesByDog[log.dogId] ??= []).push(ds);
		}

		const realDogs = dogs.filter((d) => d.status === 'active');

		const candidates = dogs.filter((d) =>
			d.status !== 'active' ||
			(d.hiddenComments ?? '').includes('Auto-created during day trip import')
		);

		if (candidates.length === 0) {
			mergeLog = ['No duplicate candidates found.'];
			mergeDryRunDone = true;
			return;
		}

		mergePreview = candidates
			.map((created) => {
				const match = realDogs.find((r) => strictMatchName(created.name, r.name));
				const tripDates = tripDatesByDog[created.id] ?? [];

				let datesMatch = false;
				if (match && tripDates.length > 0) {
					const intakeMs = toDate(match.intakeDate ?? match.shelterSince)?.getTime() ?? 0;
					const leftMs = toDate(match.leftShelterDate)?.getTime() ?? Date.now();
					// At least one trip date falls within the real dog's shelter stay
					datesMatch = tripDates.some((ds) => {
						const [m, day] = ds.split('/').map(Number);
						const year = new Date().getFullYear();
						const t = new Date(year, m - 1, day).getTime();
						return intakeMs === 0 || (t >= intakeMs && t <= leftMs + 86_400_000);
					});
				}

				return { created, match: match ?? null, tripDates, datesMatch };
			})
			.filter((row) => row.match !== null);

		if (mergePreview.length === 0) {
			mergeLog = ['No matches found — nothing to merge.'];
		}
		mergeDryRunDone = true;
	}

	async function runMerge() {
		if (!mergeDryRunDone) return;
		merging = true;
		mergeLog = [];
		for (const row of mergePreview) {
			if (!row.match || !row.datesMatch) {
				mergeLog = [...mergeLog, `⚠ Skipped "${row.created.name}" — ${!row.match ? 'no match' : 'dates do not align'}`];
				continue;
			}
			const count = await mergeDayTripLogs(row.created.id, row.match.id);
			await deleteDog(row.created.id);
			mergeLog = [...mergeLog, `✓ "${row.created.name}" → "${row.match.name}" — ${count} trip${count === 1 ? '' : 's'} moved, record deleted`];
		}
		mergeLog = [...mergeLog, '', 'Merge complete.'];
		merging = false;
		mergeDryRunDone = false;
		mergePreview = [];
		await refresh();
	}

	function normalizeName(n: string): string {
		return n.toLowerCase().replace(/[^a-z]/g, '');
	}

	function buildLookup(): { exact: Record<string, Dog>; fuzzy: Record<string, Dog> } {
		const exact: Record<string, Dog> = {};
		const fuzzy: Record<string, Dog> = {};
		for (const dog of dogs) {
			exact[dog.name.toLowerCase().trim()] = dog;
			fuzzy[normalizeName(dog.name)] = dog;
			// Also index by base name with any parenthetical stripped (e.g. "Sadie (Jazmine)" → "sadie")
			const baseName = dog.name.replace(/\s*\(.*?\)\s*$/, '').toLowerCase().trim();
			if (baseName !== dog.name.toLowerCase().trim()) {
				exact[baseName] = dog;
				fuzzy[normalizeName(baseName)] = dog;
			}
		}
		return { exact, fuzzy };
	}

	function lookupDog(name: string, lookup: { exact: Record<string, Dog>; fuzzy: Record<string, Dog> }): Dog | undefined {
		const exact = lookup.exact[name.toLowerCase().trim()];
		if (exact) return exact;
		const fuzzyKey = normalizeName(name);
		const fuzzy = lookup.fuzzy[fuzzyKey];
		if (fuzzy) return fuzzy;
		// Partial: sheet name contained in dog name or vice versa (e.g. "Arcanine" matches "Arcanine (Jerry)")
		return dogs.find((d) => {
			const dn = normalizeName(d.name);
			return dn.includes(fuzzyKey) || fuzzyKey.includes(dn);
		});
	}

	async function runDryRun() {
		const lookup = buildLookup();

		importPreview = sheetData.map((row) => {
			const matched = lookupDog(row.name, lookup);
			return {
				sheetName: row.name,
				dogId: matched?.id ?? null,
				dogName: matched?.name ?? null,
				dates: row.dates,
				tripCount: row.dates.length,
				matched: Boolean(matched),
				willCreate: !matched
			};
		});
		importDryRunDone = true;
		importDone = false;
		importLog = [];

		// Look up unmatched dogs in ASM to show their status
		const unmatched = importPreview.filter((r) => r.willCreate);
		await Promise.all(
			unmatched.map(async (row) => {
				try {
					const res = await fetch(`/api/asm/search?q=${encodeURIComponent(row.sheetName)}`);
					if (!res.ok) return;
					const results: { name: string; status: string }[] = await res.json();
					const hit = results.find((a) =>
						normalizeName(a.name).includes(normalizeName(row.sheetName)) ||
						normalizeName(row.sheetName).includes(normalizeName(a.name))
					);
					if (hit) {
						importPreview = importPreview.map((r) =>
							r.sheetName === row.sheetName ? { ...r, asmStatus: hit.status } : r
						);
					}
				} catch {
					// silently ignore ASM lookup failures
				}
			})
		);
	}

	async function runImport() {
		if (!importDryRunDone) return;
		importing = true;
		importLog = [];

		const lookup = buildLookup();

		let totalCreated = 0;
		let totalSkipped = 0;

		const previewMap = Object.fromEntries(importPreview.map((r) => [r.sheetName, r]));
		let totalNewDogs = 0;

		for (const row of sheetData) {
			const preview = previewMap[row.name];
			const overrideDog = preview?.overrideId ? dogs.find((d) => d.id === preview.overrideId) : undefined;
			let dog = overrideDog ?? lookupDog(row.name, lookup);

			if (!dog) {
				// Create a minimal record flagged as adopted (not in system)
				const newDog = await createDog({
					name: row.name,
					breed: '',
					sex: 'unknown',
					intakeDate: null,
					originalIntakeDate: null,
					reentryDates: [],
					dateOfBirth: null,
					weightLbs: null,
					foodType: '',
					foodAmount: '',
					dietaryNotes: '',
					origin: '',
					pottyTrained: 'unknown',
					goodWithDogs: 'unknown',
					goodWithCats: 'unknown',
					goodWithKids: 'unknown',
					idealHome: '',
					energyLevel: 'unknown',
					outdoorKennelAssignment: '',
					lastBathDate: null,
					lastBathBy: null,
					lastDayTripDate: null,
					isOutOnDayTrip: false,
					currentDayTripStartedAt: null,
					surgeryDate: null,
					surgeryRestDays: null,
					lastSurgeryDate: null,
					isMicrochipped: false,
					isFixed: false,
					fixedDate: null,
					isVaccinated: false,
					vaccineCount: 0,
					vaccinatedDate: null,
					dayTripStatus: 'eligible',
					dayTripManagerOnly: false,
					dayTripNotes: null,
					handlingLevel: 'volunteer',
					inFoster: false,
					isolationStatus: 'none',
					isolationStartDate: null,
					status: 'adopted',
					hiddenComments: 'Auto-created during day trip import — not found in system'
				});
				if (!newDog) {
					importLog = [...importLog, `⚠ Skipped "${row.name}" — could not create dog record`];
					totalSkipped++;
					continue;
				}
				dog = newDog;
				totalNewDogs++;
				importLog = [...importLog, `+ Created "${row.name}" as adopted (not in system)`];
			}

			const sortedDates = [...row.dates].sort();
			if (sortedDates.length === 0) {
				importLog = [...importLog, `⚠ Skipped "${row.name}" — no valid dates`];
				totalSkipped++;
				continue;
			}

			// Wipe existing logs — spreadsheet is source of truth
			await clearDayTripLogs(dog.id);

			for (const dateStr of sortedDates) {
				const parts = dateStr.split('-').map(Number);
				const tripDate = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0);
				await importHistoricalDayTrip(dog.id, tripDate, $authProfile);
				totalCreated++;
			}

			// Update lastDayTripDate to the most recent imported date
			const lastDateStr = sortedDates[sortedDates.length - 1];
			const lp = lastDateStr.split('-').map(Number);
			const lastDate = new Date(lp[0], lp[1] - 1, lp[2], 0, 0, 0);
			await updateDog(dog.id, {
				lastDayTripDate: lastDate,
				isOutOnDayTrip: false,
				currentDayTripStartedAt: null
			});

			importLog = [...importLog, `✓ ${dog.name} — ${row.dates.length} trip${row.dates.length === 1 ? '' : 's'} imported (${sortedDates.join(', ')})`];
		}

		importLog = [...importLog, ``, `Done: ${totalCreated} trips created, ${totalNewDogs} new dogs added, ${totalSkipped} skipped.`];
		importing = false;
		importDone = true;
		await refresh();
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
	$: role = resolveRole($authProfile, $localRole as UserRole);

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

	function durationHours(log: DayTripLog) {
		const startedAt = toDate(log.startedAt);
		const endedAt = toDate(log.endedAt) ?? new Date();
		if (!startedAt) return 0;
		return Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 3_600_000);
	}

	function formatDuration(hours: number): string {
		if (hours < 0.01) return '—';
		const totalMins = Math.round(hours * 60);
		const h = Math.floor(totalMins / 60);
		const m = totalMins % 60;
		if (h === 0) return `${m}m`;
		return m === 0 ? `${h}h` : `${h}h ${m}m`;
	}

	function formatTime(d: Date | null): string {
		if (!d) return '—';
		if (d.getHours() === 0 && d.getMinutes() === 0) return '—';
		return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
	}

	function formatShortDate(d: Date | null): string {
		if (!d) return '—';
		return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
	}

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
			role,
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

<section class="dt-page">
	<div class="dt-grid">

		<!-- Header -->
		<div class="dt-header">
			<div class="dt-header-top">
				<div class="dt-header-info">
					<h2 class="dt-title">Day Trips</h2>
					<div class="dt-stats-row">
						{#if outNowCount > 0}
							<span class="dt-stat-chip dt-stat-chip-out typewriter">{outNowCount} out now</span>
						{/if}
						<span class="dt-stat-chip typewriter">{monthLabel} · {monthlyTripCount} trips · {monthlyHourTotal.toFixed(1)} hrs</span>
					</div>
				</div>
				<div class="dt-header-controls">
					<input type="month" class="dt-month-input typewriter" bind:value={monthFilter} />
					<button class="dt-control-btn typewriter" on:click={refresh}>Refresh</button>
				</div>
			</div>

			<nav class="dt-tabs" aria-label="Day trip views">
				<button class="dt-tab" class:dt-tab-active={activeTab === 'board'} on:click={() => activeTab = 'board'}>Board</button>
				<button class="dt-tab" class:dt-tab-active={activeTab === 'log'} on:click={() => activeTab = 'log'}>Log</button>
				<button class="dt-tab" class:dt-tab-active={activeTab === 'dogs'} on:click={() => activeTab = 'dogs'}>Dogs</button>
				<button class="dt-tab" class:dt-tab-active={activeTab === 'stats'} on:click={() => activeTab = 'stats'}>Stats</button>
				<button class="dt-tab dt-tab-import" class:dt-tab-active={activeTab === 'import'} on:click={() => activeTab = 'import'}>Import</button>
			</nav>
		</div>

		{#if loading}
			<p class="dt-loading typewriter">Loading trip board...</p>

		<!-- ───── BOARD ───── -->
		{:else if activeTab === 'board'}
			<div class="dt-board">

				<!-- Eligible -->
				<div class="dt-section dt-section-sage">
					<div class="dt-section-head">
						<h3 class="dt-section-title">Eligible</h3>
						<span class="dt-section-count typewriter">{dogsEligible.length}</span>
					</div>
					{#if dogsEligible.length === 0}
						<p class="dt-section-empty typewriter">none ready</p>
					{:else}
						{#each dogsEligible as dog}
							{@const eligibility = getEligibility(dog)}
							{@const days = daysSince(dog.lastDayTripDate)}
							{@const overdue = days === null || days >= 14}
							{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
							<div class="dt-row" class:dt-row-overdue={overdue}>
								<div class="dt-row-main">
									<div class="dt-row-info">
										<p class="dt-row-name">{dog.name}</p>
										<p class="dt-row-meta typewriter">Kennel {dog.outdoorKennelAssignment || '—'} · {days !== null ? `Last trip ${days}d ago` : 'No trips yet'}</p>
										<div class="dt-row-pills">
											<span class={`pill ${statusPillClass(eligibility.status)}`}>{eligibility.status === 'difficult' ? 'Difficult' : 'Eligible'}</span>
											{#if overdue}<span class="pill pill-orange">overdue</span>{/if}
										</div>
									</div>
									<div class="dt-row-aside">
										<span class="dt-alltime-num whiteboard-hand erase-marker-red">{allTime}</span>
										<span class="dt-alltime-label typewriter">trips</span>
									</div>
								</div>
								{#if eligibility.reasons.length > 0}
									<p class="dt-row-warning">{eligibility.reasons[0]}</p>
								{/if}
								<button class="board-control-btn board-control-btn-sm" on:click={() => toggleOut(dog)}>Send Out</button>
							</div>
						{/each}
					{/if}
				</div>

				<!-- Out Now -->
				<div class="dt-section dt-section-sky">
					<div class="dt-section-head">
						<h3 class="dt-section-title">Out Now</h3>
						<span class="dt-section-count typewriter">{dogsOut.length}</span>
					</div>
					{#if dogsOut.length === 0}
						<p class="dt-section-empty typewriter">none out right now</p>
					{:else}
						{#each dogsOut as dog}
							{@const openTrip = openTripByDog[dog.id]}
							{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
							<div class="dt-row dt-row-out">
								<div class="dt-row-main">
									<div class="dt-row-info">
										<p class="dt-row-name">{dog.name}</p>
										<p class="dt-row-meta typewriter">Kennel {dog.outdoorKennelAssignment || '—'} · Out since {formatDateTime(openTrip?.startedAt ?? dog.currentDayTripStartedAt)}</p>
									</div>
									<div class="dt-row-aside">
										<span class="dt-alltime-num whiteboard-hand erase-marker-red">{allTime}</span>
										<span class="dt-alltime-label typewriter">trips</span>
									</div>
								</div>
								<button class="board-control-btn board-control-btn-sm" on:click={() => toggleOut(dog)}>Mark Returned</button>
							</div>
						{/each}
					{/if}
				</div>

				<!-- Not Eligible -->
				<div class="dt-section dt-section-sand dt-section-dim">
					<div class="dt-section-head">
						<h3 class="dt-section-title">Not Eligible</h3>
						<span class="dt-section-count typewriter">{dogsIneligible.length}</span>
					</div>
					{#if dogsIneligible.length === 0}
						<p class="dt-section-empty typewriter">none</p>
					{:else}
						{#each dogsIneligible as dog}
							{@const eligibility = getEligibility(dog)}
							<div class="dt-row dt-row-ineligible">
								<div class="dt-row-main">
									<div class="dt-row-info">
										<p class="dt-row-name">{dog.name}</p>
										<p class="dt-row-meta typewriter">Kennel {dog.outdoorKennelAssignment || '—'}</p>
									</div>
									<span class="pill pill-red">Ineligible</span>
								</div>
								{#if eligibility.reasons.length > 0}
									<p class="dt-row-warning">{eligibility.reasons[0]}</p>
								{/if}
							</div>
						{/each}
					{/if}
				</div>

			</div>

		<!-- ───── LOG ───── -->
		{:else if activeTab === 'log'}
			<div class="dt-panel">
				<div class="dt-panel-head">
					<div>
						<p class="dt-panel-title">{monthLabel}</p>
						<p class="dt-panel-sub typewriter">{sortedMonthlyLogs.length} completed trip{sortedMonthlyLogs.length === 1 ? '' : 's'} · {monthlyHourTotal.toFixed(1)} total hrs{outNowCount > 0 ? ` · ${outNowCount} in progress` : ''}</p>
					</div>
				</div>

				{#if sortedMonthlyLogs.length === 0}
					<p class="dt-panel-empty typewriter">No completed trips logged for {monthLabel}.</p>
				{:else}
					<div class="dt-table-wrap">
						<table class="dt-table">
							<thead>
								<tr>
									<th>Date</th>
									<th>Dog</th>
									<th>Time Out</th>
									<th>Time In</th>
									<th>Duration</th>
								</tr>
							</thead>
							<tbody>
								{#each sortedMonthlyLogs as log}
									{@const startDate = toDate(log.startedAt)}
									{@const endDate = toDate(log.endedAt)}
									{@const dog = dogs.find(d => d.id === log.dogId)}
									<tr>
										<td class="td-muted typewriter">{formatShortDate(startDate)}</td>
										<td class="td-name">
											{#if dog}
												<a href="/dogs/{dog.id}" class="dt-name-link">{dog.name}</a>
											{:else}
												<span class="td-muted">Unknown</span>
											{/if}
										</td>
										<td class="td-muted typewriter">{formatTime(startDate)}</td>
										<td class="td-muted typewriter">{formatTime(endDate)}</td>
										<td class="td-strong typewriter">{formatDuration(durationHours(log))}</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr class="dt-table-foot">
									<td colspan="4" class="td-foot-label typewriter">Total</td>
									<td class="td-strong typewriter">{formatDuration(monthlyHourTotal)}</td>
								</tr>
							</tfoot>
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
						<p class="dt-panel-sub typewriter">Sorted by most overdue · {monthStart.toLocaleDateString('en-US', { month: 'short' })} stats shown for monthly columns</p>
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
								{@const days = daysSince(dog.lastDayTripDate)}
								{@const overdue = days === null || days >= 14}
								{@const eligibility = getEligibility(dog)}
								{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
								<tr class:tr-overdue={overdue && eligibility.eligible && !dog.isOutOnDayTrip}>
									<td class="td-name">
										<a href="/dogs/{dog.id}" class="dt-name-link">{dog.name}</a>
										{#if dog.isOutOnDayTrip}
											<span class="dt-out-badge typewriter">out now</span>
										{/if}
									</td>
									<td class="td-center">
										<span class="dt-alltime-num whiteboard-hand erase-marker-red">{allTime}</span>
									</td>
									<td class="td-muted typewriter">
										{#if days !== null}
											{days}d ago{#if overdue && eligibility.eligible && !dog.isOutOnDayTrip}&thinsp;<span class="dt-overdue-flag">overdue</span>{/if}
										{:else}
											never
										{/if}
									</td>
									<td class="td-center td-muted typewriter">{tripCountByDog[dog.id] ?? 0}</td>
									<td class="td-center td-muted typewriter">{(tripHoursByDog[dog.id] ?? 0).toFixed(1)}</td>
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
			<div class="dt-panel">
				<div class="dt-panel-head">
					<div>
						<p class="dt-panel-title">{currentYear} Summary</p>
						<p class="dt-panel-sub typewriter">{yearTripTotal} trips · {yearHourTotal.toFixed(1)} hrs total</p>
					</div>
				</div>

				<div class="dt-table-wrap">
					<table class="dt-table dt-table-stats">
						<thead>
							<tr>
								<th>Month</th>
								<th class="th-center">Trips</th>
								<th class="th-center">Hours</th>
								<th class="th-center">Avg per Trip</th>
							</tr>
						</thead>
						<tbody>
							{#each yearlyStats as month}
								<tr class:tr-empty={month.trips === 0}>
									<td class="td-month-name">{month.name}</td>
									<td class="td-center typewriter">{month.trips > 0 ? month.trips : '—'}</td>
									<td class="td-center typewriter">{month.hours > 0 ? month.hours.toFixed(1) : '—'}</td>
									<td class="td-center typewriter">{month.trips > 0 ? formatDuration(month.hours / month.trips) : '—'}</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr class="dt-table-foot">
								<td class="td-foot-label typewriter">Total</td>
								<td class="td-center typewriter">{yearTripTotal}</td>
								<td class="td-center typewriter">{yearHourTotal.toFixed(1)}</td>
								<td class="td-center typewriter">{yearTripTotal > 0 ? `${formatDuration(yearHourTotal / yearTripTotal)} avg` : '—'}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>

		<!-- ───── IMPORT ───── -->
		{:else if activeTab === 'import'}
			<div class="dt-panel dt-import-panel">
				<div class="dt-panel-head">
					<div>
						<p class="dt-panel-title">Import Day Trip Data</p>
						<p class="dt-panel-sub typewriter">Load from the DT Numbers spreadsheet, then preview and import.</p>
					</div>
				</div>

				<div class="dt-import-actions">
					<button class="dt-import-btn" on:click={loadFromSheet} disabled={sheetLoading || importing}>
						{sheetLoading ? 'Loading…' : 'Load from Sheet'}
					</button>
					{#if sheetError}
						<span class="dt-import-error typewriter">{sheetError}</span>
					{/if}
					{#if sheetData.length > 0 && !sheetLoading}
						<span class="dt-import-loaded typewriter">{sheetData.length} dogs loaded</span>
						<button class="dt-import-btn" on:click={runDryRun} disabled={importing}>
							Dry Run
						</button>
					{/if}
					{#if importDryRunDone && !importDone}
						<button class="dt-import-btn dt-import-btn-go" on:click={runImport} disabled={importing}>
							{importing ? 'Importing…' : 'Import Now'}
						</button>
					{/if}
					{#if importDone}
						<span class="dt-import-done typewriter">Import complete!</span>
					{/if}
				</div>

				{#if importDryRunDone}
					<div class="dt-import-preview">
						<p class="dt-import-section-label typewriter">Preview</p>
						<div class="dt-table-wrap">
							<table class="dt-table dt-import-table">
								<thead>
									<tr>
										<th>Spreadsheet Name</th>
										<th>Matched Dog</th>
										<th class="th-center">Trips</th>
										<th>Dates</th>
									</tr>
								</thead>
								<tbody>
									{#each importPreview as row, i}
										{@const resolved = row.overrideId ? dogs.find(d => d.id === row.overrideId) : null}
										{@const isResolved = row.matched || Boolean(resolved) || row.willCreate}
										<tr class:dt-import-row-miss={!row.matched && !resolved && !row.willCreate} class:dt-import-row-new={row.willCreate && !resolved}>
											<td class="typewriter">{row.sheetName}</td>
											<td>
												{#if row.matched}
													<span class="dt-import-match">{row.dogName}</span>
												{:else if row.willCreate && !row.overrideId}
													<span class="dt-import-create typewriter">will create{row.asmStatus ? ` · ASM: ${row.asmStatus}` : ''}</span>
													<select class="dt-import-override"
														bind:value={importPreview[i].overrideId}
														on:change={() => importPreview = [...importPreview]}>
														<option value="">— create new —</option>
														{#each dogs.slice().sort((a,b) => a.name.localeCompare(b.name)) as dog}
															<option value={dog.id}>{dog.name}{dog.status !== 'active' ? ` (${dog.status})` : ''}</option>
														{/each}
													</select>
												{:else if resolved}
													<span class="dt-import-match">{resolved.name}</span>
												{/if}
											</td>
											<td class="td-center typewriter">{isResolved ? row.tripCount : '—'}</td>
											<td class="dt-import-dates typewriter">
												{#if isResolved}
													{row.dates.map(d => d.replace(/^\d{4}-0?/, '')).join(', ')}
												{:else}
													—
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
								<tfoot>
									<tr class="dt-table-foot">
										<td class="td-foot-label typewriter">Total</td>
										<td class="td-foot-label typewriter">{importPreview.filter(r => r.matched).length} matched</td>
										<td class="td-center typewriter">{importPreview.filter(r => r.matched).reduce((s, r) => s + r.tripCount, 0)}</td>
										<td></td>
									</tr>
								</tfoot>
							</table>
						</div>
					</div>
				{/if}

				{#if importLog.length > 0}
					<div class="dt-import-log">
						<p class="dt-import-section-label typewriter">Import Log</p>
						<pre class="dt-import-log-pre typewriter">{importLog.join('\n')}</pre>
					</div>
				{/if}

				<div class="dt-import-note">
					<p class="typewriter">After importing, use <strong>Merge Duplicates</strong> to consolidate any auto-created records back to the real dog.</p>
				</div>

				<div class="dt-merge-section">
					<p class="dt-import-section-label typewriter">Merge Duplicates</p>
					<p class="dt-merge-desc typewriter">Finds dogs auto-created during import, matches them to real shelter dogs by name, moves their trips over, and deletes the duplicates.</p>
					<div class="dt-import-actions">
						<button class="dt-import-btn" on:click={runMergeDryRun} disabled={merging}>Preview</button>
						{#if mergeDryRunDone && mergePreview.length > 0}
							<button class="dt-import-btn dt-import-btn-go" on:click={runMerge} disabled={merging}>
								{merging ? 'Merging…' : 'Merge Now'}
							</button>
						{/if}
					</div>
					{#if mergeDryRunDone && mergePreview.length > 0}
						<div class="dt-table-wrap">
							<table class="dt-table dt-import-table">
								<thead>
									<tr>
										<th>Duplicate Record</th>
										<th>Will Merge Into</th>
										<th>Trip Dates</th>
										<th>Dates OK?</th>
									</tr>
								</thead>
								<tbody>
									{#each mergePreview as row}
										<tr class:dt-import-row-miss={!row.datesMatch}>
											<td class="typewriter">{row.created.name}</td>
											<td>
												{#if row.match}
													<span class="dt-import-match">{row.match.name}</span>
												{:else}
													<span class="dt-import-miss">No match</span>
												{/if}
											</td>
											<td class="typewriter dt-import-dates">{row.tripDates.join(', ') || '—'}</td>
											<td class="typewriter">
												{#if row.datesMatch}
													<span style="color:#2a6e3a">✓</span>
												{:else}
													<span style="color:#b84a4a">✗</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
					{#if mergeLog.length > 0}
						<pre class="dt-import-log-pre typewriter">{mergeLog.join('\n')}</pre>
					{/if}
				</div>
			</div>
		{/if}

	</div>
</section>

<style>
	/* ── Page ── */
	.dt-page {
		width: 100%;
	}

	.dt-grid {
		display: grid;
		gap: 0.58rem;
	}

	/* ── Header ── */
	.dt-header {
		display: grid;
		gap: 0.5rem;
		padding: 0.08rem;
	}

	.dt-header-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.dt-header-info {
		display: grid;
		gap: 0.22rem;
	}

	.dt-title {
		margin: 0;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.45rem, 2.4vw, 2.05rem);
		font-weight: 500;
		letter-spacing: 0.01em;
		line-height: 1.04;
		color: #303948;
	}

	.dt-stats-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.dt-stat-chip {
		display: inline-flex;
		align-items: center;
		min-height: 1.72rem;
		padding: 0.18rem 0.52rem;
		border: 1px solid #d8e0ea;
		border-radius: 0.52rem;
		background: #f7f9fc;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #4a5a6e;
	}

	.dt-stat-chip-out {
		border-color: #b3d4c0;
		background: #ecf7f0;
		color: #2a6040;
	}

	.dt-header-controls {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		flex-shrink: 0;
	}

	.dt-month-input {
		min-height: 1.96rem;
		border: 1px solid #d8e0ea;
		border-radius: 0.52rem;
		padding: 0.24rem 0.52rem;
		background: #f7f9fc;
		color: #2d3b4f;
		font-size: 1rem;
	}

	.dt-control-btn {
		display: inline-flex;
		align-items: center;
		min-height: 1.96rem;
		border: 1px solid #cad7e8;
		border-radius: 0.58rem;
		padding: 0.24rem 0.66rem;
		font-size: 0.63rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #2f435c;
		background: #f4f8fd;
		cursor: pointer;
	}

	.dt-control-btn:hover {
		background: #eaf2fb;
	}

	/* ── Tabs ── */
	.dt-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.dt-tab {
		min-height: 1.88rem;
		border: 1px solid #d2dbe8;
		border-radius: 0.52rem;
		background: #ffffff;
		padding: 0.26rem 0.68rem;
		font-family: var(--font-ui);
		font-size: 0.63rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #2f425b;
		cursor: pointer;
	}

	.dt-tab:hover {
		background: #f4f8fd;
	}

	.dt-tab-active {
		border-color: #2e84b7;
		background: #e8f3ff;
		color: #1e4f72;
	}

	/* ── Loading ── */
	.dt-loading {
		padding: 0.72rem 0.74rem;
		border: 1px solid #d4dde8;
		border-radius: 0.7rem;
		background: #f8fbff;
		font-size: 0.88rem;
		color: var(--ink-soft);
	}

	/* ── Board ── */
	.dt-board {
		display: grid;
		gap: 0.58rem;
	}

	.dt-section {
		display: grid;
		gap: 0.42rem;
		border-radius: 0.92rem;
		padding: 0.62rem 0.58rem 0.58rem;
	}

	/* Out Now — blue (#016aa5) tint */
	.dt-section-sky {
		background: linear-gradient(180deg, #ddeef8 0%, #d4e8f4 100%);
	}

	/* Eligible — green (#3aaf2a) tint */
	.dt-section-sage {
		background: linear-gradient(180deg, #ddf0d8 0%, #d5ebd0 100%);
	}

	/* Not Eligible — purple (#933980) tint */
	.dt-section-sand {
		background: linear-gradient(180deg, #f0e4ee 0%, #e9dde8 100%);
	}

	.dt-section-dim {
		opacity: 0.82;
	}

	.dt-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.44rem;
	}

	.dt-section-title {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #4a5a6e;
		line-height: 1;
	}

	.dt-section-count {
		font-size: 0.66rem;
		font-weight: 700;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		color: #ffffff;
		background: rgba(50, 80, 110, 0.45);
	}

	.dt-section-empty {
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
		padding: 0.1rem 0;
	}

	/* ── Rows (inside sections) ── */
	.dt-row {
		display: flex;
		flex-direction: column;
		gap: 0.36rem;
		border: 1px solid rgba(96, 109, 123, 0.15);
		border-radius: 0.36rem;
		background: rgba(255, 255, 255, 0.56);
		padding: 0.52rem 0.56rem;
	}

	.dt-row-out {
		border-color: rgba(50, 120, 180, 0.22);
		background: rgba(255, 255, 255, 0.7);
	}

	.dt-row-overdue {
		border-color: rgba(200, 140, 50, 0.3);
		background: rgba(255, 252, 244, 0.75);
	}

	.dt-row-ineligible {
		opacity: 0.72;
		padding: 0.28rem 0.56rem;
		gap: 0.18rem;
	}

	.dt-row-ineligible .dt-row-info {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
	}

	.dt-row-ineligible .dt-row-meta {
		font-size: 0.62rem;
	}

	.dt-row-main {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dt-row-info {
		min-width: 0;
		flex: 1;
		display: grid;
		gap: 0.14rem;
	}

	.dt-row-name {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--marker-black);
		line-height: 1;
	}

	.dt-row-meta {
		margin: 0;
		font-size: 0.66rem;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
	}

	.dt-row-pills {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
		margin-top: 0.12rem;
	}

	.dt-row-aside {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.04rem;
		flex-shrink: 0;
	}

	.dt-alltime-num {
		font-size: 1.44rem;
		line-height: 1;
		font-weight: 700;
	}

	.dt-alltime-label {
		font-size: 0.56rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.dt-row-warning {
		margin: 0;
		font-size: 0.74rem;
		color: var(--marker-red);
		line-height: 1.2;
	}

	/* board-control-btn inherited from global — small variant */
	.board-control-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
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
		cursor: pointer;
		align-self: flex-start;
	}

	.board-control-btn:hover {
		background: #eaf2fb;
	}

	.board-control-btn-sm {
		min-height: 1.72rem;
		font-size: 0.62rem;
		padding: 0.22rem 0.56rem;
	}

	/* ── Panel (Log / Dogs / Stats) ── */
	.dt-panel {
		border: 1px solid #d3dbe6;
		border-radius: 0.92rem;
		background: linear-gradient(180deg, #ffffff 0%, #f9fbfe 100%);
		box-shadow: 0 8px 18px rgba(28, 50, 71, 0.06);
		padding: 0.78rem;
		display: grid;
		gap: 0.72rem;
	}

	.dt-panel-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dt-panel-title {
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.1rem, 2vw, 1.5rem);
		font-weight: 500;
		color: #303948;
		line-height: 1;
		margin-bottom: 0.18rem;
	}

	.dt-panel-sub {
		font-size: 0.66rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.dt-panel-empty {
		font-size: 0.78rem;
		color: var(--ink-soft);
		letter-spacing: 0.04em;
	}

	/* ── Table ── */
	.dt-table-wrap {
		overflow-x: auto;
		border-radius: 0.52rem;
		border: 1px solid #dde4ee;
	}

	.dt-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		min-width: 400px;
	}

	.dt-table th {
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-soft);
		padding: 0.42rem 0.64rem;
		border-bottom: 1px solid #dde4ee;
		background: #f5f8fc;
		white-space: nowrap;
	}

	.dt-table td {
		padding: 0.5rem 0.64rem;
		border-top: 1px solid #edf1f7;
		vertical-align: middle;
	}

	.dt-table tbody tr:first-child td {
		border-top: none;
	}

	.dt-table tbody tr:hover td {
		background: #f8fbff;
	}

	.td-name {
		font-family: var(--font-ui);
		font-size: 0.88rem;
		font-weight: 700;
		color: var(--marker-black);
	}

	.td-muted {
		font-size: 0.78rem;
		color: #4a5e72;
	}

	.td-strong {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--marker-black);
	}

	.td-center {
		text-align: center;
	}

	.th-center {
		text-align: center;
	}

	.td-month-name {
		font-family: var(--font-ui);
		font-size: 0.86rem;
		font-weight: 600;
		color: #303948;
	}

	.dt-name-link {
		color: inherit;
		text-decoration: none;
	}

	.dt-name-link:hover {
		text-decoration: underline;
		color: #1e5a8a;
	}

	.dt-table-foot td {
		border-top: 2px solid #dde4ee;
		background: #f5f8fc;
	}

	.td-foot-label {
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
		font-weight: 700;
	}

	.tr-overdue td {
		background: #fffdf5;
	}

	.tr-empty td {
		color: #aab4c0;
	}

	/* ── Badges / Tags ── */
	.dt-out-badge,
	.dt-overdue-flag {
		display: inline-block;
		margin-left: 0.28rem;
		padding: 0.06rem 0.3rem;
		border-radius: 999px;
		font-family: var(--font-typewriter);
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		vertical-align: middle;
	}

	.dt-out-badge {
		background: #d6eeff;
		color: #1e5a8a;
	}

	.dt-overdue-flag {
		background: #fde8c8;
		color: #8a5010;
	}

	.dt-on-trip-tag {
		display: inline-flex;
		border: 1px solid #95bee1;
		border-radius: 0.28rem;
		background: #e8f5ff;
		padding: 0.16rem 0.4rem;
		font-family: var(--font-typewriter);
		font-size: 0.62rem;
		font-weight: 700;
		color: #275982;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.pill-sm {
		font-size: 0.62rem;
		padding: 0.1rem 0.34rem;
	}

	/* ── Import Tab ── */
	.dt-tab-import {
		border-color: #d2c8e8;
		color: #5a3e7a;
	}

	.dt-tab-import.dt-tab-active {
		border-color: #8b5fa8;
		background: #f2eafa;
		color: #5a2e7c;
	}

	.dt-import-panel {
		display: grid;
		gap: 0.9rem;
	}

	.dt-import-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.dt-import-btn {
		display: inline-flex;
		align-items: center;
		min-height: 2.1rem;
		border: 1px solid #c8d4e4;
		border-radius: 0.65rem;
		padding: 0.3rem 0.9rem;
		background: #f6f9fd;
		font-family: var(--font-typewriter);
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #2a3f55;
		cursor: pointer;
	}

	.dt-import-btn:hover:not(:disabled) {
		background: #eaf2fb;
	}

	.dt-import-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dt-import-btn-go {
		border-color: #7b4eab;
		background: #f3ebfa;
		color: #5c2d8a;
	}

	.dt-import-btn-go:hover:not(:disabled) {
		background: #ead9f7;
	}

	.dt-import-done {
		font-size: 0.74rem;
		font-weight: 700;
		color: #2f8d24;
		letter-spacing: 0.04em;
	}

	.dt-import-loaded {
		font-size: 0.74rem;
		font-weight: 600;
		color: #016aa5;
		letter-spacing: 0.03em;
	}

	.dt-import-error {
		font-size: 0.74rem;
		font-weight: 600;
		color: #cf4b4b;
		letter-spacing: 0.03em;
	}

	.dt-import-preview,
	.dt-import-log {
		display: grid;
		gap: 0.38rem;
	}

	.dt-import-section-label {
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-soft);
		margin: 0;
	}

	.dt-import-table td,
	.dt-import-table th {
		white-space: nowrap;
	}

	.dt-import-row-miss td {
		opacity: 0.55;
	}

	.dt-import-row-new td {
		background: #fdf8f0;
	}

	.dt-import-create {
		font-size: 0.72rem;
		font-weight: 600;
		color: #a06c10;
		display: block;
		margin-bottom: 0.25rem;
	}

	.dt-import-match {
		color: #2a6e3a;
		font-weight: 600;
		font-size: 0.82rem;
	}

	.dt-import-miss {
		color: #b84a4a;
		font-size: 0.74rem;
	}

	.dt-import-override {
		font-size: 0.76rem;
		font-family: var(--font-typewriter);
		border: 1px solid #c8d4e4;
		border-radius: 0.4rem;
		padding: 0.2rem 0.4rem;
		background: #f6f9fd;
		color: #2a3f55;
		max-width: 14rem;
	}

	.dt-import-dates {
		font-size: 0.72rem;
		color: #56698a;
	}

	.dt-import-log-pre {
		margin: 0;
		padding: 0.62rem 0.74rem;
		background: #f4f8fd;
		border: 1px solid #d0dcea;
		border-radius: 0.6rem;
		font-size: 0.75rem;
		line-height: 1.7;
		color: #253545;
		white-space: pre-wrap;
	}

	.dt-merge-section {
		display: grid;
		gap: 0.5rem;
	}

	.dt-merge-desc {
		font-size: 0.74rem;
		color: #6b5530;
		margin: 0;
	}

	.dt-import-note {
		padding: 0.52rem 0.68rem;
		background: #fefaf2;
		border: 1px solid #edd9a0;
		border-radius: 0.6rem;
	}

	.dt-import-note p {
		margin: 0;
		font-size: 0.74rem;
		color: #6b5530;
		line-height: 1.5;
	}

	/* ── Desktop ── */
	@media (min-width: 900px) {
		.dt-board {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.dt-panel {
			padding: 0.95rem;
		}
	}
</style>
