<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { resolveRole, canEditDogs } from '$lib/utils/permissions';
	import { listDogs, updateDog } from '$lib/data/dogs';
	import type { Dog, UserRole } from '$lib/types';

	type RunId = number | 'puppy' | 'rock';
	const MAX_DOGS_PER_RUN = 2;

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
		{
			id: 'run-17',
			runId: 17,
			runKey: '17',
			label: '17',
			row: 4,
			col: 1
		},
		{
			id: 'run-18',
			runId: 18,
			runKey: '18',
			label: '18',
			row: 4,
			col: 2
		},
		{
			id: 'run-19',
			runId: 19,
			runKey: '19',
			label: '19',
			row: 4,
			col: 3,
			colSpan: 2
		},
		{
			id: 'run-20',
			runId: 20,
			runKey: '20',
			label: '20',
			row: 4,
			col: 5,
			colSpan: 2
		}
	];
	const rockRight = [
		{
			id: 'run-21',
			runId: 21,
			runKey: '21',
			label: '21',
			row: 4,
			col: 8,
			colSpan: 2
		},
		{
			id: 'run-22',
			runId: 22,
			runKey: '22',
			label: '22',
			row: 4,
			col: 10,
			colSpan: 2
		},
		{
			id: 'run-23',
			runId: 23,
			runKey: '23',
			label: '23',
			row: 4,
			col: 12,
			colSpan: 2
		},
		{
			id: 'run-24',
			runId: 24,
			runKey: '24',
			label: '24',
			row: 4,
			col: 14,
			colSpan: 2
		}
	];
	const bottomLeft = makeRunCells(25, 6, 6, 1);
	const bottomRight = [
		{
			id: 'run-31',
			runId: 31,
			runKey: '31',
			label: '31',
			row: 6,
			col: 8,
			colSpan: 2
		},
		{
			id: 'run-32',
			runId: 32,
			runKey: '32',
			label: '32',
			row: 6,
			col: 10,
			colSpan: 2
		},
		{
			id: 'run-33',
			runId: 33,
			runKey: '33',
			label: '33',
			row: 6,
			col: 12,
			colSpan: 2
		},
		{
			id: 'run-34',
			runId: 34,
			runKey: '34',
			label: '34',
			row: 6,
			col: 14,
			colSpan: 2
		}
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

	// Match desktop layout on mobile by transposing into four columns,
	// keeping the 1-15 line on the right side.
	topRow.forEach((cell, index) => {
		mobilePlacement.set(cell.runKey ?? String(cell.runId), { col: 4, row: index + 1 });
	});
	mobilePlacement.set('35', { col: 3, row: 1 });
	mobilePlacement.set('puppy', { col: 4, row: topRow.length + 1 });
	mobilePlacement.set('rock', { col: 3, row: topRow.length + 1 });

	assignMobileColumn(
		[17, 18, 19, 20, 21, 22, 23, 24],
		2,
		1,
		{ '19': 2, '20': 2, '21': 2, '22': 2, '23': 2, '24': 2 },
		20
	);

	// Shift only the 21-24 bank down for visual alignment on mobile.
	for (const key of ['21', '22', '23', '24']) {
		const placement = mobilePlacement.get(key);
		if (!placement) continue;
		mobilePlacement.set(key, { ...placement, row: placement.row + 1 });
	}

	assignMobileColumn([25, 26, 27, 28, 29, 30, 31, 32, 33, 34], 1, 1, { '31': 2, '32': 2, '33': 2, '34': 2 }, 30);

	// Slight downward offset keeps the 31-34 bank visually aligned on mobile.
	for (const key of ['31', '32', '33', '34']) {
		const placement = mobilePlacement.get(key);
		if (!placement) continue;
		mobilePlacement.set(key, { ...placement, row: placement.row + 1 });
	}

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

	const runOptions: RunId[] = [
		...Array.from(
			new Set(
				kennelCells
					.filter((cell) => cell.runId !== null && typeof cell.runId === 'number')
					.map((cell) => cell.runId as number)
			)
		).sort((a, b) => a - b),
		'puppy',
		'rock'
	];

	let dogs: Dog[] = [];
	let loading = true;
	let draggingId: string | null = null;
	let hoveredRun: RunId | null = null;
	let hoveredUnassigned = false;
	let selectedDogId: string | null = null;

	onMount(async () => {
		await refreshDogs();
	});

	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canEdit = canEditDogs(role);
	$: activeDogs = dogs.filter((dog) => dog.status === 'active');
	$: fosterDogs = activeDogs.filter((dog) => dog.inFoster);
	$: kennelEligibleDogs = activeDogs.filter((dog) => !dog.inFoster);
	$: assignments = getAssignments(kennelEligibleDogs);
	$: unassigned = kennelEligibleDogs.filter((dog) => !getDogRun(dog));
	$: selectedDog = selectedDogId
		? kennelEligibleDogs.find((dog) => dog.id === selectedDogId) ?? null
		: null;

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

	function runIdToLabel(runId: RunId) {
		if (runId === 'puppy') return 'Puppy Run';
		if (runId === 'rock') return 'Rock Run';
		return String(runId);
	}

	function runIdToAssignment(runId: RunId | null) {
		if (!runId) return '';
		return runIdToLabel(runId);
	}

	function runIdToKey(runId: RunId) {
		return typeof runId === 'number' ? String(runId) : runId;
	}

	function runIdToSelectValue(runId: RunId | null) {
		if (!runId) return '';
		return typeof runId === 'number' ? String(runId) : runId;
	}

	function getAssignments(list: Dog[]) {
		const map: Record<string, Dog[]> = {};
		for (const dog of list) {
			const run = getDogRun(dog);
			if (!run) continue;
			const key = runIdToKey(run);
			if (!map[key]) map[key] = [];
			map[key].push(dog);
		}
		for (const key of Object.keys(map)) {
			map[key].sort((a, b) => a.name.localeCompare(b.name));
		}
		return map;
	}

	async function refreshDogs() {
		loading = true;
		dogs = await listDogs();
		loading = false;
	}

	function handleDragStart(event: DragEvent, dog: Dog) {
		if (!canEdit) return;
		draggingId = dog.id;
		event.dataTransfer?.setData('text/plain', dog.id);
		event.dataTransfer?.setDragImage?.(event.currentTarget as Element, 20, 20);
	}

	function handleDragEnd() {
		draggingId = null;
		hoveredRun = null;
		hoveredUnassigned = false;
	}

	function toggleSelect(dog: Dog) {
		if (!canEdit) return;
		selectedDogId = selectedDogId === dog.id ? null : dog.id;
	}

	function isRunFull(runId: RunId, movingDogId?: string) {
		const occupants = assignments[runIdToKey(runId)] ?? [];
		const count = movingDogId
			? occupants.filter((occupant) => occupant.id !== movingDogId).length
			: occupants.length;
		return count >= MAX_DOGS_PER_RUN;
	}

	async function assignDog(dog: Dog, runId: RunId | null) {
		if (!canEdit) return;
		if (dog.inFoster && runId !== null) {
			toast.error('Dogs in foster cannot be assigned to a kennel.');
			return;
		}
		const currentRun = getDogRun(dog);
		if (currentRun === runId) return;

		if (runId && isRunFull(runId, dog.id)) {
			toast.error(`${runIdToLabel(runId)} already has ${MAX_DOGS_PER_RUN} dogs.`);
			return;
		}

		dogs = dogs.map((item) => {
			if (item.id === dog.id) {
				return { ...item, outdoorKennelAssignment: runIdToAssignment(runId) };
			}
			return item;
		});

		try {
			await updateDog(dog.id, { outdoorKennelAssignment: runIdToAssignment(runId) });
			toast.success(runId ? `${dog.name} assigned to ${runIdToLabel(runId)}.` : `${dog.name} unassigned.`);
		} catch (error) {
			console.error(error);
			toast.error('Unable to update kennel assignment.');
			await refreshDogs();
		}
	}

	async function handleDrop(event: DragEvent, runId: RunId | null) {
		event.preventDefault();
		if (!canEdit) return;
		const id = draggingId ?? event.dataTransfer?.getData('text/plain');
		const dog = dogs.find((item) => item.id === id);
		if (!dog) return;
		await assignDog(dog, runId);
	}

	async function handleSelect(event: Event, dog: Dog) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (!value) {
			await assignDog(dog, null);
			return;
		}
		if (value === 'puppy' || value === 'rock') {
			await assignDog(dog, value);
			return;
		}
		const runNumber = Number(value);
		await assignDog(dog, Number.isFinite(runNumber) ? runNumber : null);
	}

	async function handleTapAssign(runId: RunId | null) {
		if (!canEdit || !selectedDog) return;
		await assignDog(selectedDog, runId);
		selectedDogId = null;
	}
</script>

<section class="kennels-board">
	<div class="kennels-grid-board">
		<div class="kennel-hero">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="flex flex-wrap gap-2">
					<span class="hero-chip">{kennelEligibleDogs.length} in shelter</span>
					<span class="hero-chip">{unassigned.length} unassigned</span>
					{#if fosterDogs.length > 0}
						<span class="hero-chip hero-chip-muted">{fosterDogs.length} in foster</span>
					{/if}
					{#if !canEdit}
						<span class="hero-chip hero-chip-muted">Read only</span>
					{/if}
				</div>
			</div>
		</div>
		<div class="kennels-body space-y-4">
			<div class="space-y-4">
				<div class="map-sheet">
					<div class="kennel-map" style={`--mobile-rows: ${mobileRows};`}>
						{#each kennelCells as cell}
							<div
								class={`kennel-cell ${cell.isSpecial ? 'kennel-special' : ''} ${
									hoveredRun === cell.runId ? 'kennel-cell-active' : ''
								}`}
								style={`grid-column: ${cell.col}${cell.colSpan ? ` / span ${cell.colSpan}` : ''}; grid-row: ${cell.row}; --m-col: ${cell.mobileCol}; --m-row: ${cell.mobileRow}; --m-row-span: ${cell.mobileRowSpan ?? 1};`}
								on:dragover|preventDefault={() => cell.runId !== null && (hoveredRun = cell.runId)}
								on:dragenter|preventDefault={() => cell.runId !== null && (hoveredRun = cell.runId)}
								on:dragleave={() => (hoveredRun = null)}
								on:drop={(event) => cell.runId !== null && handleDrop(event, cell.runId)}
								on:click={() => cell.runId !== null && handleTapAssign(cell.runId)}
								>
									{#if cell.runId !== null}
										<div class="kennel-label">
											<span>{cell.label}</span>
										</div>
										{@const slotDogs = assignments[cell.runKey ?? ''] ?? []}
										{#if slotDogs.length > 0}
											<div class="kennel-dog-stack">
												{#each slotDogs as slotDog}
													<div
														class={`kennel-dog ${canEdit ? 'kennel-dog-draggable' : ''} ${
															selectedDogId === slotDog.id ? 'kennel-dog-selected' : ''
														}`}
														draggable={canEdit}
														on:dragstart={(event) => handleDragStart(event, slotDog)}
														on:dragend={handleDragEnd}
														on:click|stopPropagation={() => toggleSelect(slotDog)}
													>
														<span>{slotDog.name}</span>
													</div>
												{/each}
											</div>
										{:else}
											<span class="kennel-empty">Empty</span>
										{/if}
									{:else}
									<span class="kennel-special-label">{cell.label}</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<div class="rounded-3xl border border-ink-200 bg-white p-4 shadow-card">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-xs uppercase tracking-[0.2em] text-ink-500">Unassigned dogs</p>
						<span class="text-xs font-semibold text-ink-600">{unassigned.length}</span>
					</div>
					{#if loading}
						<p class="mt-3 text-sm text-ink-500">Loading dogs...</p>
					{:else if kennelEligibleDogs.length === 0}
						<p class="mt-3 text-sm text-ink-500">All active dogs are currently in foster.</p>
					{:else if unassigned.length === 0}
						<p class="mt-3 text-sm text-ink-500">All active dogs have a run assigned.</p>
					{:else}
						<div class="mt-4 kennel-unassigned-list">
							{#each unassigned as dog}
								<div
									class={`kennel-unassigned-row ${canEdit ? 'kennel-dog-draggable' : ''}`}
									draggable={canEdit}
									on:dragstart={(event) => handleDragStart(event, dog)}
									on:dragend={handleDragEnd}
								>
									<span>{dog.name}</span>
								</div>
							{/each}
						</div>
					{/if}
					<div
						class={`kennel-dropzone ${hoveredUnassigned ? 'kennel-dropzone-active' : ''}`}
						on:dragover|preventDefault={() => (hoveredUnassigned = true)}
						on:dragenter|preventDefault={() => (hoveredUnassigned = true)}
						on:dragleave={() => (hoveredUnassigned = false)}
						on:drop={(event) => handleDrop(event, null)}
						on:click={() => handleTapAssign(null)}
					>
						<span class="text-xs text-ink-500">Drop or tap here to unassign</span>
					</div>
				</div>

				<div class="rounded-3xl border border-ink-200 bg-white p-3 shadow-card md:hidden">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-xs uppercase tracking-[0.2em] text-ink-500">Dogs</p>
						<span class="text-xs font-semibold text-ink-600">{kennelEligibleDogs.length}</span>
					</div>
					{#if selectedDog}
						<div class="mt-2 rounded-2xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
							Selected: <span class="font-semibold">{selectedDog.name}</span> - tap a run to assign.
						</div>
					{/if}
					{#if loading}
						<p class="mt-2 text-sm text-ink-500">Loading dogs...</p>
					{:else if kennelEligibleDogs.length === 0}
						<p class="mt-2 text-sm text-ink-500">No in-shelter dogs available for assignment.</p>
					{:else}
						<div class="mt-2 kennel-mobile-list">
							{#each kennelEligibleDogs as dog}
								<div
									class={`kennel-mobile-row ${selectedDogId === dog.id ? 'kennel-mobile-row-selected' : ''}`}
									role="button"
									tabindex="0"
									on:click={() => toggleSelect(dog)}
									on:keydown={(event) => event.key === 'Enter' && toggleSelect(dog)}
								>
									<p class="kennel-mobile-name">{dog.name}</p>
									<div class="kennel-mobile-run-row">
										<span>Run</span>
										<select
											class="kennel-run-select"
											disabled={!canEdit}
											value={runIdToSelectValue(getDogRun(dog))}
											on:change={(event) => handleSelect(event, dog)}
										>
											<option value="">Unassigned</option>
											{#each runOptions as run}
												<option value={runIdToSelectValue(run)}>{runIdToLabel(run)}</option>
											{/each}
										</select>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.kennels-board {
		width: 100%;
	}

	.kennels-grid-board {
		border: 4px solid var(--marker-black);
		background: rgba(255, 255, 255, 0.9);
	}

	.kennel-hero {
		position: relative;
		display: grid;
		gap: 0.72rem;
		padding: 0.82rem 0.8rem;
		border-bottom: 4px solid var(--marker-black);
	}

	.kennel-title {
		margin: 0.3rem 0 0;
		font-family: var(--font-printed);
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		font-size: clamp(1.6rem, 7.6vw, 2.7rem);
		line-height: 0.98;
		white-space: nowrap;
		text-wrap: nowrap;
		color: var(--marker-black);
	}

	.kennel-sub {
		margin-top: 0.24rem;
		font-size: clamp(0.95rem, 4.2vw, 1.16rem);
		color: var(--ink-soft);
	}

	.kennels-board :global(.rounded-3xl) {
		border-radius: 0.35rem;
		border-width: 1.5px;
		border-color: #c4ccd7;
		background: var(--paper);
		box-shadow:
			0 2px 5px rgba(0, 0, 0, 0.05),
			0 8px 14px rgba(0, 0, 0, 0.08);
	}

	.kennels-board :global(.shadow-card) {
		box-shadow: none;
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

	.hero-chip-muted {
		background: #fff4f2;
		border-color: #e7c6c2;
		color: #8a4b46;
	}

	.map-sheet {
		border-radius: 0.9rem;
		background: #ffffff;
		box-shadow: 0 6px 10px rgba(40, 53, 67, 0.08);
	}

	.kennel-map {
		--kennel-row: clamp(2.8rem, 6vw, 4.5rem);
		--kennel-gap: clamp(0.8rem, 3vw, 1.5rem);
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
		background: #fbfdff;
		border-radius: 0.7rem;
	}

	.kennel-map :global(*) {
		scroll-margin: 0;
	}

	.kennel-cell {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		border: 1px solid #c5d2e1;
		background: rgba(255, 255, 255, 0.98);
		padding: 0.25rem 0.35rem;
		transition: border 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
		border-radius: 0.16rem;
	}

	.kennel-cell-active {
		border-color: #6e9fc8;
		box-shadow: 0 0 0 2px rgba(110, 159, 200, 0.24);
		transform: translateY(-1px);
	}

	.kennel-special {
		background: #f7faff;
		border-style: dashed;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	.kennel-special-label {
		font-size: clamp(0.82rem, 2.5vw, 0.95rem);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #547192;
	}

	.kennel-label {
		display: flex;
		justify-content: flex-end;
		font-size: clamp(0.55rem, 1.8vw, 0.7rem);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: #7086a3;
	}

	.kennel-dog {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.52rem;
		background: #e9f7ee;
		border: 1px solid #bddcc7;
		color: #2a6248;
		font-size: clamp(0.82rem, 2.5vw, 0.95rem);
		font-weight: 700;
		padding: 0.2rem 0.52rem;
		align-self: flex-start;
	}

	.kennel-dog-stack {
		display: grid;
		gap: 0.18rem;
	}

	.kennel-dog-selected {
		border-color: #6e9fc8;
		box-shadow: 0 0 0 1px rgba(110, 159, 200, 0.28);
	}

	.kennel-dog-list {
		justify-content: flex-start;
	}

	.kennel-mobile-list {
		display: grid;
		gap: 0;
	}

	.kennel-mobile-row {
		display: grid;
		gap: 0.2rem;
		padding: 0.24rem 0.14rem;
		border-bottom: 1.5px solid #d7e0eb;
	}

	.kennel-mobile-row:last-child {
		border-bottom: 0;
	}

	.kennel-mobile-row-selected {
		background: #f1f7ff;
	}

	.kennel-mobile-name {
		margin: 0;
		font-size: 0.84rem;
		font-weight: 700;
		color: #111c2c;
	}

	.kennel-mobile-run-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.42rem;
		font-size: 0.64rem;
		color: #4d5f77;
	}

	.kennel-run-select {
		min-height: 1.56rem;
		border-radius: 999px;
		border: 1px solid #c7d3e2;
		background: #ffffff;
		padding: 0.08rem 0.62rem;
		font-size: 0.66rem;
		font-weight: 700;
		color: #243852;
	}

	.kennel-unassigned-list {
		display: grid;
		gap: 0;
	}

	.kennel-unassigned-row {
		display: flex;
		align-items: center;
		min-height: 2.06rem;
		padding: 0.32rem 0.12rem;
		border-bottom: 1.5px solid #d7e0eb;
		font-size: 0.92rem;
		font-weight: 700;
		color: #2a6248;
	}

	.kennel-unassigned-row:last-child {
		border-bottom: 0;
	}

	.kennel-dog-draggable {
		cursor: grab;
	}

	.kennel-dog-draggable:active {
		cursor: grabbing;
	}

	.kennel-empty {
		font-size: clamp(0.5rem, 1.6vw, 0.65rem);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #7f96b2;
	}

	.kennel-dropzone {
		margin-top: 1rem;
		border-radius: 0.75rem;
		border: 1px dashed #b8cadd;
		background: #f7fbff;
		padding: 0.75rem;
		text-align: center;
		transition: border 0.2s ease, background 0.2s ease;
	}

	.kennel-dropzone-active {
		border-color: #6c9ec9;
		background: #eaf4ff;
	}

	@media (min-width: 768px) {
		.kennels-body {
			padding: 0.82rem 0.8rem;
		}

		.kennel-title {
			font-size: clamp(2.05rem, 6vw, 2.8rem);
		}

		.kennel-map {
			--kennel-row: 5rem;
			--kennel-gap: 2rem;
		}
	}

	@media (max-width: 640px) {
		.kennel-map {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			grid-template-rows: repeat(var(--mobile-rows), var(--kennel-row));
			row-gap: 0;
		}

		.kennel-cell {
			grid-column: var(--m-col) !important;
			grid-row: var(--m-row) / span var(--m-row-span, 1) !important;
		}

		.kennel-tag {
			display: none;
		}
	}
</style>
