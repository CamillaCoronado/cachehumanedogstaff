<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { listDogs, addFeedingLog, addStoolLog, listFeedingLogs, listStoolLogs } from '$lib/data/dogs';
	import { formatDate, isSameCalendarDay, isSurgeryToday } from '$lib/utils/dates';
	import type { Dog, FeedingLog, StoolLog, MealTime, AmountEaten } from '$lib/types';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { isPuppyFood, isOwnFood, isNormalFood, foodTypeTone, foodTypeInstruction, foodTypeLabel } from '$lib/utils/feeding';

	type RunId = number | 'puppy' | 'rock';
	const MAX_DOGS_PER_RUN = 2;
	type WalkPathId = 'back_to_front' | 'front_to_back' | 'snake_route';

	type KennelCell = {
		id: string;
		runId: RunId | null;
		runKey?: string;
		label: string;
		row: number;
		col: number;
		colSpan?: number;
		isSpecial?: boolean;
		mobileCol: number;
		mobileRow: number;
		mobileRowSpan?: number;
	};

	const abnormalTypes = new Set([1, 2, 5, 6, 7]);
	const amounts: AmountEaten[] = ['all', 'most', 'half', 'little', 'none'];
	const HISTORY_LIMIT = 200;
	const routeOptions: Array<{ id: WalkPathId; label: string }> = [
		{ id: 'back_to_front', label: 'Back to Front' },
		{ id: 'front_to_back', label: 'Front to Back' },
		{ id: 'snake_route', label: 'Snake Route' }
	];

	function makeRunCells(start: number, count: number, row: number, colStart: number) {
		return Array.from({ length: count }, (_, index) => ({
			id: `run-${start + index}`,
			runId: start + index,
			runKey: String(start + index),
			label: String(start + index),
			row,
			col: colStart + index
		}));
	}

	const topRow = makeRunCells(1, 15, 1, 1);
	const bridgeRun = {
		id: 'run-35',
		runId: 35,
		runKey: '35',
		label: '35',
		row: 2,
		col: 1
	};
	const rockLeft = [
		{ id: 'run-17', runId: 17, runKey: '17', label: '17', row: 4, col: 1 },
		{ id: 'run-18', runId: 18, runKey: '18', label: '18', row: 4, col: 2 },
		{ id: 'run-19', runId: 19, runKey: '19', label: '19', row: 4, col: 3, colSpan: 2 },
		{ id: 'run-20', runId: 20, runKey: '20', label: '20', row: 4, col: 5, colSpan: 2 }
	];
	const rockRight = [
		{ id: 'run-21', runId: 21, runKey: '21', label: '21', row: 4, col: 8, colSpan: 2 },
		{ id: 'run-22', runId: 22, runKey: '22', label: '22', row: 4, col: 10, colSpan: 2 },
		{ id: 'run-23', runId: 23, runKey: '23', label: '23', row: 4, col: 12, colSpan: 2 },
		{ id: 'run-24', runId: 24, runKey: '24', label: '24', row: 4, col: 14, colSpan: 2 }
	];
	const bottomLeft = makeRunCells(25, 6, 6, 1);
	const bottomRight = [
		{ id: 'run-31', runId: 31, runKey: '31', label: '31', row: 6, col: 8, colSpan: 2 },
		{ id: 'run-32', runId: 32, runKey: '32', label: '32', row: 6, col: 10, colSpan: 2 },
		{ id: 'run-33', runId: 33, runKey: '33', label: '33', row: 6, col: 12, colSpan: 2 },
		{ id: 'run-34', runId: 34, runKey: '34', label: '34', row: 6, col: 14, colSpan: 2 }
	];

	const specialCells = [
		{
			id: 'puppy-run',
			runId: 'puppy' as const,
			runKey: 'puppy',
			label: 'Puppy Run',
			row: 1,
			col: 16,
			colSpan: 2,
			isSpecial: true
		},
		{
			id: 'rock-run',
			runId: 'rock' as const,
			runKey: 'rock',
			label: 'Rock Run',
			row: 2,
			col: 16,
			colSpan: 2,
			isSpecial: true
		}
	];

	const mobilePlacement = new Map<string, { col: number; row: number; rowSpan?: number }>();

	function assignMobileColumn(
		runIds: RunId[],
		col: number,
		startRow: number,
		rowSpans: Record<string, number>,
		gapAfter?: RunId
	) {
		let row = startRow;
		for (const runId of runIds) {
			const key = typeof runId === 'number' ? String(runId) : runId;
			const span = rowSpans[key] ?? 1;
			mobilePlacement.set(key, { col, row, rowSpan: span });
			row += span;
			if (gapAfter && runId === gapAfter) {
				row += 1;
			}
		}
	}

	topRow.forEach((cell, index) => {
		mobilePlacement.set(cell.runKey ?? String(cell.runId), { col: 4, row: index + 1 });
	});
	mobilePlacement.set('35', { col: 2, row: 1 });
	mobilePlacement.set('puppy', { col: 4, row: topRow.length + 1 });
	mobilePlacement.set('rock', { col: 3, row: topRow.length + 1 });

	assignMobileColumn(
		[17, 18, 19, 20, 21, 22, 23, 24],
		2,
		2,
		{ '19': 2, '20': 2, '21': 2, '22': 2, '23': 2, '24': 2 },
		20
	);

	assignMobileColumn([25, 26, 27, 28, 29, 30, 31, 32, 33, 34], 1, 1, { '31': 2, '32': 2, '33': 2, '34': 2 }, 30);

	const kennelCells: KennelCell[] = [
		...topRow,
		bridgeRun,
		...rockLeft,
		...rockRight,
		...bottomLeft,
		...bottomRight,
		...specialCells
	].map((cell) => {
		const key = cell.runKey ?? String(cell.runId ?? '');
		const placement = mobilePlacement.get(key);
		return {
			...cell,
			mobileCol: placement?.col ?? 4,
			mobileRow: placement?.row ?? 1,
			mobileRowSpan: placement?.rowSpan ?? 1
		};
	});

	const mobileRows = Math.max(
		...kennelCells.map((cell) => cell.mobileRow + (cell.mobileRowSpan ?? 1) - 1)
	);

	let dogs: Dog[] = [];
	let feedingLogs: Record<string, FeedingLog[]> = {};
	let stoolLogs: Record<string, StoolLog[]> = {};
	let loading = true;
	let mealTime: MealTime = new Date().getHours() < 12 ? 'am' : 'pm';
	const selectedDay = new Date();
	let markingAll = false;
	let notesByDog: Record<string, string> = {};
	let stoolDog: Dog | null = null;
	let stoolType = 4;
	let stoolNotes = '';
	let savingStool = false;
	let showHistory = false;
	let walkPath: WalkPathId = 'back_to_front';

	onMount(async () => {
		await refreshDogs();
	});

	$: activeDogs = dogs.filter((dog) => dog.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
	$: kennelAssignments = getAssignments(activeDogs);
	$: unassignedDogs = activeDogs.filter((dog) => !getDogRun(dog));
	$: assignedCount = activeDogs.length - unassignedDogs.length;
	$: fedMap = getFedMap(activeDogs, feedingLogs, selectedDay, mealTime);
	$: fedCount = Object.values(fedMap).filter(Boolean).length;
	$: abnormalCount = getAbnormalCount(activeDogs, stoolLogs, selectedDay);
	$: displayDogs = [...activeDogs].sort((a, b) => compareByWalkPath(a, b, walkPath));
	$: specialFeedDogs = displayDogs.filter((dog) => isSpecialFeeding(dog));
	$: feedingHistoryEntries = getFeedingHistoryEntries(activeDogs, feedingLogs).slice(0, HISTORY_LIMIT);

	function getDogRun(dog: Dog): RunId | null {
		const raw = dog.outdoorKennelAssignment?.toString().trim() ?? '';
		if (!raw) return null;
		const lower = raw.toLowerCase();
		if (lower.includes('puppy')) return 'puppy';
		if (lower.includes('rock')) return 'rock';
		const match = raw.match(/\d+/);
		if (!match) return null;
		const parsed = Number(match[0]);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function getRunLabel(dog: Dog) {
		const run = getDogRun(dog);
		if (!run) return 'Unassigned';
		if (run === 'puppy') return 'Puppy Run';
		if (run === 'rock') return 'Rock Run';
		return `Run ${run}`;
	}

	function runIdToKey(run: RunId | null) {
		if (!run) return null;
		return typeof run === 'number' ? String(run) : run;
	}

	function getRunPosition(run: RunId | null) {
		const key = runIdToKey(run);
		if (!key) return null;
		const cell = kennelCells.find((item) => item.runKey === key && item.runId !== null);
		if (!cell) return null;
		return { row: cell.row, col: cell.col };
	}

	function getWalkRank(run: RunId | null, path: WalkPathId) {
		const position = getRunPosition(run);
		if (!position) return 10_000;

		const allRows = Array.from(
			new Set(kennelCells.filter((cell) => cell.runId !== null).map((cell) => cell.row))
		).sort((a, b) => a - b);
		const maxRow = Math.max(...allRows);
		const maxCol = Math.max(...kennelCells.filter((cell) => cell.runId !== null).map((cell) => cell.col));

		if (path === 'front_to_back') {
			return position.row * 100 + position.col;
		}

		if (path === 'back_to_front') {
			return (maxRow - position.row) * 100 + (maxCol - position.col);
		}

		const rowIndex = allRows.indexOf(position.row);
		const colRank = rowIndex % 2 === 0 ? position.col : maxCol - position.col;
		return rowIndex * 100 + colRank;
	}

	function compareByWalkPath(a: Dog, b: Dog, path: WalkPathId) {
		const rankDiff = getWalkRank(getDogRun(a), path) - getWalkRank(getDogRun(b), path);
		if (rankDiff !== 0) return rankDiff;
		return a.name.localeCompare(b.name);
	}

	function getAssignments(list: Dog[]) {
		const map: Record<string, Dog[]> = {};
		for (const dog of list) {
			const run = getDogRun(dog);
			if (!run) continue;
			const key = typeof run === 'number' ? String(run) : run;
			if (!map[key]) map[key] = [];
			map[key].push(dog);
		}
		for (const key of Object.keys(map)) {
			map[key].sort((a, b) => a.name.localeCompare(b.name));
		}
		return map;
	}

	function foodAmountLabel(dog: Dog) {
		const value = dog.foodAmount?.trim();
		return value || '—';
	}

	function hasSupplements(dog: Dog) {
		const merged = `${(dog.foodType ?? '').trim().toLowerCase()} ${(dog.dietaryNotes ?? '').trim().toLowerCase()}`;
		return ['supplement', 'supplements', 'probiotic', 'pumpkin', 'vitamin', 'topper', 'add-in', 'med'].some((kw) => merged.includes(kw));
	}

	function hasSpecialDiet(dog: Dog) {
		const merged = `${(dog.foodType ?? '').trim().toLowerCase()} ${(dog.dietaryNotes ?? '').trim().toLowerCase()}`;
		return ['no chicken', 'no fish', 'allergy', 'sensitive', 'prescription', 'rx', 'special diet'].some((kw) => merged.includes(kw));
	}

	function feedingFlags(dog: Dog) {
		const flags: string[] = [];
		if (hasSupplements(dog)) flags.push('Supplements');
		if (hasSpecialDiet(dog)) flags.push('Special Diet');
		return flags;
	}

	function specialFeedingReasons(dog: Dog) {
		const reasons: string[] = [];
		if (isOwnFood(dog)) reasons.push('Own Food');
		if (dog.hasOwnFood && dog.transitionToHills === true) reasons.push('Transition to Hills');
		if (dog.hasOwnFood && dog.transitionToHills === false) reasons.push('No Hills Transition');
		if (isPuppyFood(dog)) reasons.push('Puppy Food');
		if (hasSupplements(dog)) reasons.push('Supplements');
		if (hasSpecialDiet(dog)) reasons.push('Special Diet');
		if (!isNormalFood(dog) && !isOwnFood(dog) && !isPuppyFood(dog)) {
			const rawType = dog.foodType?.trim();
			if (rawType) reasons.push(rawType);
		}
		if ((dog.dietaryNotes?.trim() ?? '').length > 0) reasons.push('Diet Notes');
		return Array.from(new Set(reasons));
	}

	function isSpecialFeeding(dog: Dog) {
		return specialFeedingReasons(dog).length > 0;
	}

	function foodSummary(dog: Dog) {
		return `${foodAmountLabel(dog)} • ${foodTypeLabel(dog)}`;
	}

	function getFedMap(list: Dog[], logs: Record<string, FeedingLog[]>, day: Date, meal: MealTime) {
		const map: Record<string, boolean> = {};
		for (const dog of list) {
			const entries = logs[dog.id] ?? [];
			map[dog.id] = entries.some((log) => log.mealTime === meal && isSameCalendarDay(log.date, day));
		}
		return map;
	}

	type FeedingHistoryEntry = {
		id: string;
		dogName: string;
		date: FeedingLog['date'];
		mealTime: FeedingLog['mealTime'];
		amountEaten: FeedingLog['amountEaten'];
		notes: FeedingLog['notes'];
		loggedByName: FeedingLog['loggedByName'];
		sortTime: number;
	};

	function toMillis(value: unknown) {
		if (value instanceof Date) return value.getTime();
		if (value && typeof value === 'object' && 'toDate' in value) {
			const candidate = (value as { toDate?: () => Date }).toDate;
			if (typeof candidate === 'function') {
				const asDate = candidate();
				return asDate instanceof Date ? asDate.getTime() : 0;
			}
		}
		return 0;
	}

	function getFeedingHistoryEntries(list: Dog[], logs: Record<string, FeedingLog[]>) {
		const entries: FeedingHistoryEntry[] = [];
		for (const dog of list) {
			for (const log of logs[dog.id] ?? []) {
				entries.push({
					id: log.id,
					dogName: dog.name,
					date: log.date,
					mealTime: log.mealTime,
					amountEaten: log.amountEaten,
					notes: log.notes,
					loggedByName: log.loggedByName,
					sortTime: toMillis(log.createdAt) || toMillis(log.date)
				});
			}
		}
		return entries.sort((a, b) => b.sortTime - a.sortTime);
	}

	function getAbnormalCount(list: Dog[], logs: Record<string, StoolLog[]>, day: Date) {
		let count = 0;
		for (const dog of list) {
			const entries = logs[dog.id] ?? [];
			for (const log of entries) {
				if (isSameCalendarDay(log.timestamp, day) && abnormalTypes.has(log.stoolType)) {
					count += 1;
				}
			}
		}
		return count;
	}

	async function refreshDogs() {
		loading = true;
		dogs = await listDogs();
		await refreshLogs();
		loading = false;
	}

	async function refreshLogs() {
		const feedingEntries = await Promise.all(
			dogs.map(async (dog) => [dog.id, await listFeedingLogs(dog.id)] as const)
		);
		const stoolEntries = await Promise.all(
			dogs.map(async (dog) => [dog.id, await listStoolLogs(dog.id)] as const)
		);
		feedingLogs = Object.fromEntries(feedingEntries);
		stoolLogs = Object.fromEntries(stoolEntries);
	}

	function isSurgeryBlocked(dog: Dog) {
		return isSurgeryToday(dog.surgeryDate, selectedDay);
	}

	async function logFeeding(dog: Dog, amount: AmountEaten) {
		if (fedMap[dog.id]) return;
		if (isSurgeryBlocked(dog)) {
			toast.error('Surgery today — do not feed.');
			return;
		}
		try {
			await addFeedingLog(
				dog.id,
				{
					date: selectedDay,
					mealTime,
					amountEaten: amount,
					notes: notesByDog[dog.id]?.trim() || null
				},
				$authProfile
			);
			notesByDog = { ...notesByDog, [dog.id]: '' };
			await refreshLogs();
			toast.success(`Feeding logged for ${dog.name}.`);
		} catch (error) {
			console.error(error);
			toast.error('Unable to log feeding.');
		}
	}

	function handleAmountChange(dog: Dog, event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value as AmountEaten;
		if (!value) return;
		logFeeding(dog, value);
	}

	async function markAllFed() {
		if (markingAll) return;
		markingAll = true;
		try {
			const targets = activeDogs.filter((dog) => !fedMap[dog.id] && !isSurgeryBlocked(dog));
			await Promise.all(
				targets.map((dog) =>
					addFeedingLog(
						dog.id,
						{
							date: selectedDay,
							mealTime,
							amountEaten: 'all',
							notes: null
						},
						$authProfile
					)
				)
			);
			await refreshLogs();
			toast.success('Marked all as fed.');
		} catch (error) {
			console.error(error);
			toast.error('Unable to mark all as fed.');
		} finally {
			markingAll = false;
		}
	}

	function openStoolModal(dog: Dog) {
		stoolDog = dog;
		stoolType = 4;
		stoolNotes = '';
	}

	async function saveStool() {
		if (!stoolDog) return;
		savingStool = true;
		try {
			await addStoolLog(
				stoolDog.id,
				{
					timestamp: new Date(),
					stoolType,
					notes: stoolNotes.trim() || null
				},
				$authProfile
			);
			await refreshLogs();
			stoolDog = null;
			toast.success('Stool log saved.');
		} catch (error) {
			console.error(error);
			toast.error('Unable to log stool.');
		} finally {
			savingStool = false;
		}
	}
</script>

<section class="feeding-board">
		<div class="feeding-grid-board">
			<div class="feeding-header">
			<div class="feeding-title">
				<p class="feeding-summary whiteboard-hand erase-marker-blue">
					{fedCount}/{activeDogs.length} dogs fed • {abnormalCount} abnormal stools logged
				</p>
			</div>
			<div class="feeding-controls">
				<div class="meal-switch" role="group" aria-label="Meal time">
					<button
						class={`meal-switch-btn ${mealTime === 'am' ? 'meal-switch-btn-active' : ''}`}
						type="button"
						on:click={() => (mealTime = 'am')}
					>
						AM
					</button>
					<button
						class={`meal-switch-btn ${mealTime === 'pm' ? 'meal-switch-btn-active' : ''}`}
						type="button"
						on:click={() => (mealTime = 'pm')}
					>
						PM
					</button>
				</div>
				<button
					class="mark-all-btn"
					on:click={markAllFed}
					disabled={markingAll}
				>
					{markingAll ? 'Saving...' : 'Mark all as fed'}
				</button>
			</div>
		</div>

		<div class="feeding-body">
			<section class="feeding-list-sheet">
				<div class="feeding-section-head">
					<h3 class="feeding-section-title">Dogs</h3>
					<div class="feeding-section-actions">
						<label class="feeding-route-control">
							<span class="feeding-route-label">Route</span>
							<select class="feeding-route-select" bind:value={walkPath}>
								{#each routeOptions as option}
									<option value={option.id}>{option.label}</option>
								{/each}
							</select>
						</label>
						<button type="button" class="feeding-history-btn" on:click={() => (showHistory = true)}>
							History
						</button>
						<span class="feeding-list-count">{displayDogs.length} dogs</span>
					</div>
				</div>
				<p class="feeding-order-note typewriter">Feed straight down the list.</p>
				{#if specialFeedDogs.length > 0}
					<div class="feeding-special-summary">
						<p class="feeding-special-title typewriter">special feeding list</p>
						<div class="feeding-special-list">
							{#each specialFeedDogs as dog}
								<div class="feeding-special-row">
									<span class="feeding-special-name">{dog.name}</span>
									<span class="feeding-special-amount">{foodAmountLabel(dog)}</span>
									<span class="feeding-special-reasons">{specialFeedingReasons(dog).join(' • ')}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if loading}
					<p class="feeding-status whiteboard-hand">Loading dogs...</p>
				{:else if displayDogs.length === 0}
					<p class="feeding-status whiteboard-hand">No dogs to show.</p>
				{:else}
					<div class="feeding-dog-list">
						{#each displayDogs as dog, index}
							{@const flags = feedingFlags(dog)}
							{@const notes = dog.dietaryNotes?.trim() ?? ''}
							{@const specialReasons = specialFeedingReasons(dog)}
							<article
								class={`feeding-feed-row ${fedMap[dog.id] ? 'feeding-feed-row-fed' : ''} ${
									isSurgeryBlocked(dog) ? 'feeding-feed-row-alert' : ''
								}`}
							>
								<div class="feeding-feed-order">{index + 1}</div>
								<div class="feeding-feed-main">
									<p class="feeding-feed-name">{dog.name}</p>
									<p class="feeding-feed-run typewriter">{getRunLabel(dog)}</p>
									{#if specialReasons.length > 0}
										<p class="feeding-feed-special typewriter">* {specialReasons.join(' • ')}</p>
									{/if}
								</div>
								<div class="feeding-feed-plan">
									<p class="feeding-feed-amount">
										<span class="feeding-feed-amount-label">Feed</span>
										<span>{foodAmountLabel(dog)}</span>
									</p>
									<p class={`feeding-feed-type feeding-feed-type-${foodTypeTone(dog)}`}>
										{foodTypeInstruction(dog)}
									</p>
									{#if flags.length > 0}
										<div class="feeding-feed-tags">
											{#each flags as flag}
												<span class="feeding-feed-tag">{flag}</span>
											{/each}
										</div>
									{/if}
									{#if notes}
										<p class="feeding-feed-notes"><span>Notes:</span> {notes}</p>
									{/if}
								</div>
								<div class="feeding-feed-actions">
									<div class="feeding-feed-badges">
										{#if fedMap[dog.id]}
											<span class="fed-badge">Logged</span>
										{/if}
										{#if isSurgeryBlocked(dog)}
											<span class="surgery-pill">Do not feed</span>
										{/if}
									</div>
									<select
										class="feeding-field"
										disabled={fedMap[dog.id] || isSurgeryBlocked(dog)}
										on:change={(event) => handleAmountChange(dog, event)}
									>
										<option value="">{fedMap[dog.id] ? 'Already logged' : 'Amount eaten'}</option>
										{#each amounts as amount}
											<option value={amount}>{amount}</option>
										{/each}
									</select>
									<input
										class="feeding-field"
										placeholder="Feeding notes"
										bind:value={notesByDog[dog.id]}
									/>
									<button class="feeding-action" on:click={() => openStoolModal(dog)}>
										Log Stool
									</button>
								</div>
							</article>
						{/each}
					</div>
				{/if}
			</section>

			<details class="feeding-reference feeding-map-reference">
				<summary class="typewriter">Kennel map reference</summary>
				<section class="feeding-map-sheet">
				<div class="feeding-section-head">
					<h3 class="feeding-section-title">Kennel Feeding Map (Reference)</h3>
					<div class="feeding-section-stats">
						<span class="hero-chip">{assignedCount} assigned</span>
						<span class="hero-chip">{unassignedDogs.length} unassigned</span>
					</div>
				</div>

				{#if loading}
					<p class="feeding-status whiteboard-hand">Loading kennel map...</p>
				{:else}
					<div class="feeding-kennel-map" style={`--mobile-rows: ${mobileRows};`}>
						{#each kennelCells as cell}
							{@const slotDogs = cell.runId !== null ? kennelAssignments[cell.runKey ?? ''] ?? [] : []}
							<div
								class={`feeding-kennel-cell ${cell.isSpecial ? 'feeding-kennel-special' : ''}`}
								style={`grid-column: ${cell.col}${cell.colSpan ? ` / span ${cell.colSpan}` : ''}; grid-row: ${cell.row}; --m-col: ${cell.mobileCol}; --m-row: ${cell.mobileRow}; --m-row-span: ${cell.mobileRowSpan ?? 1};`}
							>
								{#if cell.runId !== null}
									<div class="feeding-run-label">{cell.label}</div>
									{#if slotDogs.length > 0}
										{#each slotDogs.slice(0, MAX_DOGS_PER_RUN) as slotDog}
											<p class="feeding-run-entry">
												<span class="feeding-run-name">{slotDog.name}</span>
												<span class="feeding-run-divider">•</span>
												<span class="feeding-run-amount">{foodAmountLabel(slotDog)}</span>
												<span class="feeding-run-divider">•</span>
												<span class="feeding-run-kind">{foodTypeLabel(slotDog)}</span>
											</p>
										{/each}
										{#if slotDogs.length > MAX_DOGS_PER_RUN}
											<p class="feeding-run-overflow">+{slotDogs.length - MAX_DOGS_PER_RUN} more</p>
										{/if}
									{:else}
										<span class="feeding-run-empty">Empty</span>
									{/if}
								{:else}
									<span class="feeding-special-label">{cell.label}</span>
								{/if}
							</div>
						{/each}
					</div>

					{#if unassignedDogs.length > 0}
						<div class="feeding-unassigned">
							<p class="feeding-unassigned-label typewriter">Unassigned</p>
							<div class="feeding-unassigned-list">
								{#each unassignedDogs as dog}
									<span class="feeding-unassigned-chip">{dog.name}: {foodSummary(dog)}</span>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
				</section>
			</details>

			<details class="feeding-reference">
				<summary class="typewriter">Bristol Scale Reference</summary>
				<div class="mt-4 grid gap-2 text-sm text-ink-700">
					<div>Type 1: Separate hard lumps (constipation)</div>
					<div>Type 2: Lumpy sausage (constipation)</div>
					<div>Type 3: Cracked sausage (normal)</div>
					<div>Type 4: Smooth sausage (normal)</div>
					<div>Type 5: Soft blobs (borderline)</div>
					<div>Type 6: Mushy pieces (diarrhea)</div>
					<div>Type 7: Watery liquid (severe diarrhea)</div>
				</div>
			</details>
		</div>
	</div>
</section>

<Modal open={showHistory} title="Feeding History" onClose={() => (showHistory = false)}>
	<div class="feeding-history-shell">
		{#if feedingHistoryEntries.length === 0}
			<p class="feeding-history-empty">No feeding logs yet.</p>
		{:else}
			<p class="feeding-history-limit typewriter">Showing latest {feedingHistoryEntries.length} entries.</p>
			<div class="feeding-history-table-wrap">
				<table class="feeding-history-table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Meal</th>
							<th>Dog</th>
							<th>Eaten</th>
							<th>By</th>
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						{#each feedingHistoryEntries as entry}
							<tr>
								<td>{formatDate(entry.date)}</td>
								<td>{entry.mealTime.toUpperCase()}</td>
								<td>{entry.dogName}</td>
								<td>{entry.amountEaten}</td>
								<td>{entry.loggedByName}</td>
								<td>{entry.notes?.trim() || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
	<div class="mt-6 flex justify-end">
		<button class="rounded-full border border-ink-200 px-4 py-2 text-xs" on:click={() => (showHistory = false)}>
			Close
		</button>
	</div>
</Modal>

<Modal open={!!stoolDog} title={stoolDog ? `Log Stool — ${stoolDog.name}` : 'Log Stool'} onClose={() => (stoolDog = null)}>
	<div class="space-y-4">
		<div class="grid gap-2 text-xs text-ink-500">
			<div>Type 1: Separate hard lumps (constipation)</div>
			<div>Type 2: Lumpy sausage (constipation)</div>
			<div>Type 3: Cracked sausage (normal)</div>
			<div>Type 4: Smooth sausage (normal)</div>
			<div>Type 5: Soft blobs (borderline)</div>
			<div>Type 6: Mushy pieces (diarrhea)</div>
			<div>Type 7: Watery liquid (severe diarrhea)</div>
		</div>
		<select class="w-full rounded-2xl border border-ink-100 px-3 py-2 text-sm" bind:value={stoolType}>
			{#each [1, 2, 3, 4, 5, 6, 7] as type}
				<option value={type}>Type {type}</option>
			{/each}
		</select>
		<textarea
			class="min-h-[120px] w-full rounded-2xl border border-ink-100 px-3 py-2 text-sm"
			placeholder="Notes"
			bind:value={stoolNotes}
		></textarea>
	</div>
	<div class="mt-6 flex justify-end gap-3">
		<button class="rounded-full border border-ink-200 px-4 py-2 text-xs" on:click={() => (stoolDog = null)}>
			Cancel
		</button>
		<button
			class="rounded-full bg-brand-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-60"
			on:click={saveStool}
			disabled={savingStool}
		>
			{savingStool ? 'Saving...' : 'Save'}
		</button>
	</div>
</Modal>

<style>
	.feeding-board {
		width: 100%;
	}

	.feeding-grid-board {
		border: 4px solid var(--marker-black);
		background: rgba(255, 255, 255, 0.9);
	}

	.feeding-header {
		display: grid;
		gap: 0.64rem;
		padding: 0.82rem 0.8rem;
		border-bottom: 4px solid var(--marker-black);
	}

	.feeding-body {
		display: grid;
		gap: 0.72rem;
		padding: 0.72rem;
	}

	.feeding-summary {
		margin-top: 0;
		font-size: clamp(0.92rem, 3.8vw, 1.06rem);
	}

	.feeding-controls {
		display: grid;
		gap: 0.34rem;
	}

	.meal-switch {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		border-radius: 0.24rem;
		border: 1.5px solid var(--marker-black);
		background: #ffffff;
		padding: 0.2rem;
		gap: 0.16rem;
	}

	.meal-switch-btn {
		min-width: 3.2rem;
		min-height: 2.2rem;
		border-radius: 0.18rem;
		font-size: 0.88rem;
		font-family: var(--font-typewriter);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--marker-black);
	}

	.meal-switch-btn-active {
		background: var(--sticky-green);
		color: #1d5a3b;
	}

	.mark-all-btn {
		min-height: 2.75rem;
		border-radius: 0.24rem;
		border: 1.5px solid var(--marker-black);
		background: var(--sticky-blue);
		padding: 0.28rem 0.62rem;
		font-size: 0.88rem;
		font-family: var(--font-typewriter);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #103a5e;
		white-space: normal;
	}

	.mark-all-btn:disabled {
		opacity: 0.6;
	}

	.feeding-map-sheet,
	.feeding-reference {
		background: #ffffff;
		padding: 0;
		box-shadow: none;
	}

	.feeding-list-sheet {
		border: 0;
		background: transparent;
		padding: 0;
		box-shadow: none;
	}

	.feeding-section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.feeding-section-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
	}

	.feeding-route-control {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
	}

	.feeding-route-label {
		font-size: 0.62rem;
		font-family: var(--font-typewriter);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #4a6079;
	}

	.feeding-route-select {
		min-height: 1.9rem;
		border: 1.5px solid var(--marker-black);
		border-radius: 0.22rem;
		background: #ffffff;
		padding: 0.1rem 0.48rem;
		font-family: var(--font-typewriter);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #25384f;
	}

	.feeding-section-title {
		margin: 0;
		font-family: var(--font-printed);
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: clamp(1.28rem, 5.8vw, 1.8rem);
		line-height: 1.02;
		color: var(--marker-black);
	}

	.feeding-section-stats {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.28rem;
	}

	.hero-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid #bfd0e2;
		background: #f4f9ff;
		padding: 0.28rem 0.62rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #3e5f83;
	}

	.feeding-list-count {
		font-size: 0.62rem;
		font-family: var(--font-typewriter);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6b7f95;
	}

	.feeding-history-btn {
		min-height: 1.9rem;
		border: 1.5px solid var(--marker-black);
		border-radius: 0.22rem;
		background: #ffffff;
		padding: 0.12rem 0.56rem;
		font-family: var(--font-typewriter);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #25384f;
	}

	.feeding-status {
		margin-top: 0.5rem;
		font-size: 0.88rem;
		color: var(--ink-soft);
	}

	.feeding-kennel-map {
		--kennel-row: clamp(3.15rem, 7vw, 4.8rem);
		--kennel-gap: clamp(0.7rem, 2.8vw, 1.35rem);
		display: grid;
		grid-template-columns: repeat(17, minmax(0, 1fr));
		grid-template-rows:
			var(--kennel-row)
			var(--kennel-row)
			var(--kennel-gap)
			var(--kennel-row)
			var(--kennel-gap)
			var(--kennel-row);
		column-gap: 0;
		row-gap: 0;
		position: relative;
		width: 100%;
		padding: 0.25rem;
		margin-top: 0.62rem;
		background: #fbfdff;
		border-radius: 0.7rem;
	}

	.feeding-kennel-cell {
		display: grid;
		align-content: start;
		gap: 0.07rem;
		border: 1px solid #c5d2e1;
		background: rgba(255, 255, 255, 0.98);
		padding: 0.2rem 0.26rem;
		border-radius: 0.16rem;
	}

	.feeding-kennel-special {
		background: #f7faff;
		border-style: dashed;
	}

	.feeding-run-label {
		font-size: clamp(0.68rem, 1.8vw, 0.78rem);
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #7086a3;
	}

	.feeding-run-entry {
		margin: 0;
		font-size: clamp(0.72rem, 2.2vw, 0.82rem);
		line-height: 1.08;
		color: #1f3248;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.feeding-run-name {
		font-weight: 700;
	}

	.feeding-run-amount {
		font-family: var(--font-marker);
		font-weight: 700;
		color: #2f79b6;
	}

	.feeding-run-kind {
		font-family: var(--font-typewriter);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #4a6079;
	}

	.feeding-run-divider {
		padding-inline: 0.08rem;
		color: #7890ad;
	}

	.feeding-run-overflow {
		margin: 0;
		font-size: clamp(0.44rem, 1.3vw, 0.54rem);
		font-family: var(--font-typewriter);
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #7c5d2e;
	}

	.feeding-run-empty {
		font-size: clamp(0.62rem, 1.5vw, 0.72rem);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #7f96b2;
	}

	.feeding-special-label {
		font-size: clamp(0.54rem, 1.8vw, 0.7rem);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.11em;
		color: #547192;
	}

	.feeding-unassigned {
		margin-top: 0.64rem;
		display: grid;
		gap: 0.32rem;
	}

	.feeding-unassigned-label {
		margin: 0;
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #5b6f89;
	}

	.feeding-unassigned-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.32rem;
	}

	.feeding-unassigned-chip {
		display: inline-flex;
		align-items: center;
		border-radius: 0.4rem;
		border: 1px solid #c8d4e3;
		background: #f6fbff;
		padding: 0.2rem 0.46rem;
		font-size: 0.64rem;
		letter-spacing: 0.03em;
		color: #2d4258;
	}

	.feeding-dog-list {
		margin-top: 0.62rem;
		display: grid;
		gap: 0;
		border-top: 2px solid rgba(26, 31, 40, 0.38);
	}

	.feeding-order-note {
		margin: 0.42rem 0 0;
		font-size: 0.62rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #5b6f89;
	}

	.feeding-special-summary {
		margin-top: 0.48rem;
		border: 1.5px dashed #9fb4ca;
		background: #f7fbff;
		padding: 0.44rem 0.46rem;
	}

	.feeding-special-title {
		margin: 0;
		font-size: 0.56rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #4a6079;
	}

	.feeding-special-list {
		margin-top: 0.32rem;
		display: grid;
		gap: 0.24rem;
	}

	.feeding-special-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.22rem;
		align-items: baseline;
		border-bottom: 1px solid rgba(26, 31, 40, 0.28);
		padding-bottom: 0.18rem;
	}

	.feeding-special-name {
		font-family: var(--font-marker);
		font-size: 0.92rem;
		line-height: 1.06;
		color: #1f3248;
	}

	.feeding-special-amount {
		font-family: var(--font-marker);
		font-size: 0.9rem;
		line-height: 1.06;
		color: #2f79b6;
	}

	.feeding-special-reasons {
		grid-column: 1 / -1;
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #556d89;
	}

	.feeding-feed-row {
		border: 0;
		border-bottom: 2px solid rgba(26, 31, 40, 0.82);
		background: transparent;
		padding: 0.52rem 0.3rem;
		display: grid;
		gap: 0.42rem;
	}

	.feeding-feed-row:last-child {
		border-bottom: 2px solid rgba(26, 31, 40, 0.82);
	}

	.feeding-feed-row-fed {
		background: #f1fbf4;
		box-shadow: inset 0 0 0 1px #b6d9c2;
	}

	.feeding-feed-row-alert {
		background: #fff8df;
		box-shadow: inset 0 0 0 1px #ddc27b;
	}

	.feeding-feed-order {
		width: 1.84rem;
		height: 1.84rem;
		border-radius: 999px;
		border: 1.5px solid #b7c7d9;
		background: #f5f9ff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-typewriter);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #2d435c;
	}

	.feeding-feed-main {
		min-width: 0;
	}

	.feeding-feed-plan {
		display: grid;
		gap: 0.24rem;
		align-content: start;
	}

	.feeding-feed-name {
		margin: 0;
		font-family: var(--font-printed);
		font-size: clamp(1rem, 3.8vw, 1.24rem);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--marker-black);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.feeding-feed-run {
		margin: 0.14rem 0 0;
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #4a6079;
	}

	.feeding-feed-special {
		margin: 0.2rem 0 0;
		font-size: 0.52rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #8a4b46;
	}

	.feeding-feed-amount {
		margin: 0;
		display: inline-flex;
		align-items: baseline;
		gap: 0.34rem;
		font-family: var(--font-marker);
		font-size: clamp(1.05rem, 4vw, 1.28rem);
		font-weight: 700;
		line-height: 1;
		color: #2f79b6;
		white-space: nowrap;
	}

	.feeding-feed-amount-label {
		font-family: var(--font-typewriter);
		font-size: 0.56rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #4f6681;
	}

	.feeding-feed-type {
		margin: 0;
		display: inline-flex;
		align-items: center;
		width: fit-content;
		border: 1.5px solid #b9c8d9;
		border-radius: 999px;
		padding: 0.14rem 0.5rem;
		font-family: var(--font-typewriter);
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #425a73;
		background: #edf3fb;
	}

	.feeding-feed-type-normal {
		border-color: #b8cee6;
		background: #eaf4ff;
		color: #285c8e;
	}

	.feeding-feed-type-puppy {
		border-color: #e6c98f;
		background: #fff2d8;
		color: #8a5b12;
	}

	.feeding-feed-type-own {
		border-color: #c2d8ba;
		background: #edf8ea;
		color: #2f6a3e;
	}

	.feeding-feed-type-special {
		border-color: #d8c4ba;
		background: #f7eeea;
		color: #7a4f3b;
	}

	.feeding-feed-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.26rem;
	}

	.feeding-feed-tag {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		border: 1.5px solid #e1ca8a;
		background: #fff4cf;
		padding: 0.08rem 0.44rem;
		font-family: var(--font-typewriter);
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #7f5b17;
	}

	.feeding-feed-notes {
		margin: 0;
		font-size: 0.66rem;
		line-height: 1.3;
		color: #425971;
	}

	.feeding-feed-notes span {
		font-weight: 700;
		color: #273c55;
	}

	.feeding-feed-actions {
		display: grid;
		gap: 0.34rem;
	}

	.feeding-feed-badges {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.fed-badge {
		display: inline-flex;
		border: 1.5px solid #b6d9c2;
		border-radius: 0.2rem;
		padding: 0.14rem 0.42rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #266741;
		background: #eaf8ee;
	}

	.surgery-pill {
		display: inline-flex;
		border: 1.5px solid #e4c981;
		border-radius: 0.2rem;
		padding: 0.18rem 0.45rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #785c14;
		background: #fff0b8;
	}

	.feeding-field,
	.feeding-action {
		min-height: 2.75rem;
		border: 1.5px solid #bfc8d4;
		border-radius: 0.22rem;
		background: #ffffff;
		padding: 0.32rem 0.56rem;
		font-size: 1rem;
		color: var(--marker-black);
	}

	.feeding-action {
		font-family: var(--font-typewriter);
		font-size: 0.74rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 700;
		color: var(--marker-black);
	}

	.feeding-reference summary {
		cursor: pointer;
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-soft);
		font-weight: 700;
	}

	.feeding-history-shell {
		display: grid;
		gap: 0.45rem;
	}

	.feeding-history-limit {
		margin: 0;
		font-size: 0.62rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #4a6079;
	}

	.feeding-history-empty {
		margin: 0;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.feeding-history-table-wrap {
		max-height: 60vh;
		overflow: auto;
		border: 1.5px solid #bfc8d4;
		border-radius: 0.22rem;
	}

	.feeding-history-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.74rem;
	}

	.feeding-history-table th,
	.feeding-history-table td {
		padding: 0.4rem 0.46rem;
		border-bottom: 1px solid #d6dee8;
		text-align: left;
		vertical-align: top;
	}

	.feeding-history-table th {
		position: sticky;
		top: 0;
		background: #f6fbff;
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #425a73;
	}

	@media (min-width: 900px) {
		.feeding-header {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
			padding: 0.96rem 0.9rem 0.92rem;
		}

		.feeding-body {
			padding: 0.82rem 0.8rem;
		}

		.feeding-summary {
			font-size: 0.96rem;
		}

		.feeding-controls {
			grid-template-columns: auto auto auto;
			align-items: end;
		}

		.meal-switch,
		.mark-all-btn {
			min-height: 2.2rem;
		}

		.mark-all-btn {
			white-space: nowrap;
			padding-inline: 0.9rem;
		}

		.feeding-map-sheet,
		.feeding-list-sheet,
		.feeding-reference {
			padding: 0.86rem;
		}

		.feeding-kennel-map {
			--kennel-row: 5rem;
			--kennel-gap: 2rem;
		}

		.feeding-feed-row {
			grid-template-columns: auto minmax(0, 1fr) minmax(12rem, 16rem) minmax(21rem, 1.2fr);
			align-items: center;
		}

		.feeding-feed-actions {
			grid-template-columns: auto minmax(8rem, 10rem) minmax(10rem, 12rem) auto;
			align-items: center;
			justify-content: end;
		}
	}

	@media (max-width: 899px) {
		.feeding-feed-row {
			grid-template-columns: auto minmax(0, 1fr);
			align-items: start;
		}

		.feeding-feed-order {
			grid-column: 1;
			grid-row: 1;
			margin-top: 0.08rem;
		}

		.feeding-feed-main {
			grid-column: 2;
			grid-row: 1;
		}

		.feeding-feed-plan {
			grid-column: 2;
		}

		.feeding-feed-actions {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 640px) {
		.feeding-kennel-map {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			grid-template-rows: repeat(var(--mobile-rows), var(--kennel-row));
			row-gap: 0;
		}

		.feeding-kennel-cell {
			grid-column: var(--m-col) !important;
			grid-row: var(--m-row) / span var(--m-row-span, 1) !important;
		}
	}
</style>
