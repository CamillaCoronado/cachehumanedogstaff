<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { resolveRole, canEditDogs } from '$lib/utils/permissions';
	import { updateDog } from '$lib/data/dogs';
	import type { Dog, UserRole } from '$lib/types';
	import { dogs as dogsStore, dogsLoaded, ensureDogsLoaded, refreshDogs } from '$lib/stores/dogs';
	import { dogAgeWeeks } from '$lib/utils/attention';
	import {
		addKennelPlaceholder,
		deleteKennelPlaceholder,
		isPlaceholderId,
		listKennelPlaceholders,
		setKennelPlaceholderRun,
		type KennelPlaceholder
	} from '$lib/data/kennelPlaceholders';

	import {
		kennelCells,
		mobileRows,
		runOptions,
		getDogRun,
		runIdToLabel,
		runIdToAssignment,
		runIdToKey,
		runIdToSelectValue,
		getAssignments
	} from '$lib/utils/kennelLayout';
	import type { RunId } from '$lib/utils/kennelLayout';
	import InsideKennelMap from '$lib/components/kennels/InsideKennelMap.svelte';

	$: dogs = $dogsStore;
	$: loading = !$dogsLoaded;
	// Expected dogs — placeholders for arrivals not yet in ASM.
	let placeholders: KennelPlaceholder[] = [];
	let newPlaceholderName = '';
	let addingPlaceholder = false;
	let activeMap: 'outdoor' | 'inside' = 'outdoor';
	let draggingId: string | null = null;
	let hoveredRun: RunId | null = null;
	let hoveredUnassigned = false;
	let selectedDogId: string | null = null;
	let touchPointerId: number | null = null;
	let touchDraggingId: string | null = null;
	let touchDragName = '';
	let touchDragX = 0;
	let touchDragY = 0;

	onMount(() => {
		void ensureDogsLoaded();
		void listKennelPlaceholders().then((list) => (placeholders = list));

		const handlePointerMove = (event: PointerEvent) => {
			handleTouchPointerMove(event);
		};
		const handlePointerUp = (event: PointerEvent) => {
			void handleTouchPointerUp(event);
		};
		const handlePointerCancel = (event: PointerEvent) => {
			handleTouchPointerCancel(event);
		};

		window.addEventListener('pointermove', handlePointerMove, { passive: false });
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', handlePointerCancel);

		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('pointercancel', handlePointerCancel);
		};
	});

	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canEdit = canEditDogs(role);
	$: activeDogs = dogs.filter((dog) => dog.status === 'active' && !dog.permanentFoster && !dog.inFoster);
	$: fosterDogs = activeDogs.filter((dog) => dog.inFoster);
	// Dogs in isolation can't share the outdoor kennel map — they're shown as
	// unassignable and kept out of every run/assignment calculation.
	$: isoDogs = activeDogs.filter((dog) => !dog.inFoster && dog.isolationStatus !== 'none');
	$: kennelEligibleDogs = activeDogs.filter(
		(dog) => !dog.inFoster && dog.isolationStatus === 'none'
	);
	$: assignments = getAssignments(kennelEligibleDogs);
	$: unassigned = kennelEligibleDogs.filter((dog) => !getDogRun(dog));
	// Run keys where an intact dog shares the kennel with an intact dog of the
	// opposite sex (puppies under 6 months exempt) — these cells are flagged red.
	$: conflictRunKeys = new Set(
		Object.entries(assignments)
			.filter(([, slotDogs]) => kennelHasIntactConflict(slotDogs))
			.map(([key]) => key)
	);
	$: selectedDog = selectedDogId
		? kennelEligibleDogs.find((dog) => dog.id === selectedDogId) ?? null
		: null;
	$: selectedPlaceholder = selectedDogId
		? placeholders.find((p) => p.id === selectedDogId) ?? null
		: null;

	// Placeholder run parsing reuses the dog logic — `run` uses the same format
	// as outdoorKennelAssignment, and getDogRun only reads that one field.
	function placeholderRun(p: KennelPlaceholder): RunId | null {
		return getDogRun({ outdoorKennelAssignment: p.run } as Dog);
	}

	$: placeholdersByRun = placeholders.reduce<Record<string, KennelPlaceholder[]>>((map, p) => {
		const key = runIdToKey(placeholderRun(p));
		if (!key) return map;
		(map[key] ??= []).push(p);
		return map;
	}, {});
	$: unassignedPlaceholders = placeholders.filter((p) => placeholderRun(p) === null);

	// Dog data, the ASM-sync re-fetch, and post-mutation refreshes all flow through
	// the shared dog store ($lib/stores/dogs); `refreshDogs` is its force-refresh.

	function handleDragStart(event: DragEvent, item: { id: string; name: string }) {
		if (!canEdit) return;
		draggingId = item.id;
		event.dataTransfer?.setData('text/plain', item.id);
		event.dataTransfer?.setDragImage?.(event.currentTarget as Element, 20, 20);
	}

	function handleDragEnd() {
		draggingId = null;
		hoveredRun = null;
		hoveredUnassigned = false;
	}

	function parseRunId(raw: string | undefined): RunId | null {
		if (!raw) return null;
		if (raw === 'puppy' || raw === 'rock') return raw;
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function resolveTouchDropTarget(clientX: number, clientY: number): RunId | null | undefined {
		const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
		if (!element) return undefined;
		const unassignedTarget = element.closest<HTMLElement>('[data-drop-unassigned="true"]');
		if (unassignedTarget) return null;
		const runTarget = element.closest<HTMLElement>('[data-drop-run]');
		const runId = parseRunId(runTarget?.dataset.dropRun);
		return runId ?? undefined;
	}

	function updateTouchHover(clientX: number, clientY: number) {
		const target = resolveTouchDropTarget(clientX, clientY);
		hoveredRun = target === null || target === undefined ? null : target;
		hoveredUnassigned = target === null;
		return target;
	}

	function ghostPortal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	function resetTouchDragState() {
		touchPointerId = null;
		touchDraggingId = null;
		touchDragName = '';
		hoveredRun = null;
		hoveredUnassigned = false;
	}

	function handleTouchDragStart(event: PointerEvent, item: { id: string; name: string }) {
		if (!canEdit || event.pointerType !== 'touch') return;
		touchPointerId = event.pointerId;
		touchDraggingId = item.id;
		touchDragName = item.name;
		touchDragX = event.clientX;
		touchDragY = event.clientY;
		updateTouchHover(event.clientX, event.clientY);
		event.preventDefault();
	}

	function handleTouchPointerMove(event: PointerEvent) {
		if (touchPointerId === null || event.pointerId !== touchPointerId) return;
		touchDragX = event.clientX;
		touchDragY = event.clientY;
		updateTouchHover(event.clientX, event.clientY);
		event.preventDefault();
	}

	async function handleTouchPointerUp(event: PointerEvent) {
		if (touchPointerId === null || event.pointerId !== touchPointerId) return;
		const target = updateTouchHover(event.clientX, event.clientY);
		const draggedId = touchDraggingId;
		resetTouchDragState();
		if (!draggedId || target === undefined) return;
		if (isPlaceholderId(draggedId)) {
			const placeholder = placeholders.find((p) => p.id === draggedId);
			if (placeholder) await assignPlaceholder(placeholder, target);
			return;
		}
		const dog = dogs.find((item) => item.id === draggedId);
		if (dog) await assignDog(dog, target);
	}

	function handleTouchPointerCancel(event: PointerEvent) {
		if (touchPointerId === null || event.pointerId !== touchPointerId) return;
		resetTouchDragState();
	}

	function toggleSelect(item: { id: string }) {
		if (!canEdit) return;
		selectedDogId = selectedDogId === item.id ? null : item.id;
	}

	const PUPPY_MAX_WEEKS = 26; // under ~6 months — the intact-sex kennel rule doesn't apply to puppies
	function isIntact(d: Dog) { return !d.isFixed; }
	function isPuppy(d: Dog) {
		const weeks = dogAgeWeeks(d, new Date());
		return weeks !== null && weeks < PUPPY_MAX_WEEKS;
	}
	function kennelHasIntactConflict(slotDogs: Dog[]): boolean {
		const mature = slotDogs.filter((d) => isIntact(d) && !isPuppy(d) && d.sex !== 'unknown');
		return mature.some((a) => mature.some((b) => b.sex !== a.sex));
	}

	async function assignDog(dog: Dog, runId: RunId | null) {
		if (!canEdit) return;
		if (dog.inFoster && runId !== null) {
			toast.error('Dogs in foster cannot be assigned to a kennel.');
			return;
		}
		const currentRun = getDogRun(dog);
		if (currentRun === runId) return;

		if (runId !== null && isIntact(dog) && !isPuppy(dog)) {
			const key = runIdToKey(runId);
			const roommates = (assignments[key] ?? []).filter((d) => d.id !== dog.id);
			const conflict = roommates.some(
				(r) => isIntact(r) && !isPuppy(r) && r.sex !== dog.sex && r.sex !== 'unknown' && dog.sex !== 'unknown'
			);
			if (conflict) {
				// Warn but allow — staff may have a reason to place them together.
				toast(`Heads up: ${dog.name} is sharing a kennel with an intact dog of the opposite sex.`, {
					icon: '⚠️',
					duration: 6000
				});
			}
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

	async function assignPlaceholder(placeholder: KennelPlaceholder, runId: RunId | null) {
		if (!canEdit) return;
		if (placeholderRun(placeholder) === runId) return;
		const run = runIdToAssignment(runId);
		placeholders = placeholders.map((p) => (p.id === placeholder.id ? { ...p, run } : p));
		try {
			await setKennelPlaceholderRun(placeholder.id, run);
			toast.success(runId ? `${placeholder.name} (expected) assigned to ${runIdToLabel(runId)}.` : `${placeholder.name} (expected) unassigned.`);
		} catch (error) {
			console.error(error);
			toast.error('Unable to move placeholder.');
			placeholders = await listKennelPlaceholders();
		}
	}

	async function handleAddPlaceholder() {
		const name = newPlaceholderName.trim();
		if (!name || addingPlaceholder) return;
		addingPlaceholder = true;
		try {
			const entry = await addKennelPlaceholder(name, $authProfile?.displayName ?? 'Staff');
			placeholders = [...placeholders, entry].sort((a, b) => a.name.localeCompare(b.name));
			newPlaceholderName = '';
			toast.success(`${entry.name} added as expected dog — drag them onto a run.`);
		} catch (error) {
			console.error(error);
			toast.error('Unable to add expected dog.');
		} finally {
			addingPlaceholder = false;
		}
	}

	async function removePlaceholder(placeholder: KennelPlaceholder) {
		if (!canEdit) return;
		try {
			await deleteKennelPlaceholder(placeholder.id);
			placeholders = placeholders.filter((p) => p.id !== placeholder.id);
			toast.success(`${placeholder.name} (expected) removed.`);
		} catch (error) {
			console.error(error);
			toast.error('Unable to remove placeholder.');
		}
	}

	async function handleDrop(event: DragEvent, runId: RunId | null) {
		event.preventDefault();
		if (!canEdit) return;
		const id = draggingId ?? event.dataTransfer?.getData('text/plain');
		if (!id) return;
		if (isPlaceholderId(id)) {
			const placeholder = placeholders.find((p) => p.id === id);
			if (placeholder) await assignPlaceholder(placeholder, runId);
			return;
		}
		const dog = dogs.find((item) => item.id === id);
		if (!dog) return;
		await assignDog(dog, runId);
	}

	function selectValueToRunId(value: string): RunId | null {
		if (!value) return null;
		if (value === 'puppy' || value === 'rock') return value;
		const runNumber = Number(value);
		return Number.isFinite(runNumber) ? runNumber : null;
	}

	async function handleSelect(event: Event, dog: Dog) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		await assignDog(dog, selectValueToRunId(value));
	}

	async function handlePlaceholderSelect(event: Event, placeholder: KennelPlaceholder) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		await assignPlaceholder(placeholder, selectValueToRunId(value));
	}

	async function handleTapAssign(runId: RunId | null) {
		if (!canEdit) return;
		if (selectedPlaceholder) {
			await assignPlaceholder(selectedPlaceholder, runId);
			selectedDogId = null;
			return;
		}
		if (!selectedDog) return;
		await assignDog(selectedDog, runId);
		selectedDogId = null;
	}
</script>

<svelte:head>
	<title>Kennels | Cache Humane Society</title>
</svelte:head>

<section class="kennels-board">
	<div class="kennels-grid-board">
		<div class="kennel-hero">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="flex flex-wrap gap-2">
					<span class="hero-chip">{kennelEligibleDogs.length} in shelter</span>
					<span class="hero-chip">{unassigned.length} unassigned</span>
					{#if placeholders.length > 0}
						<span class="hero-chip hero-chip-expected">{placeholders.length} expected</span>
					{/if}
					{#if fosterDogs.length > 0}
						<span class="hero-chip hero-chip-muted">{fosterDogs.length} in foster</span>
					{/if}
					{#if !canEdit}
						<span class="hero-chip hero-chip-muted">Read only</span>
					{/if}
				</div>
				<div class="kennel-map-tabs" role="tablist" aria-label="Kennel map">
					<button
						type="button"
						role="tab"
						aria-selected={activeMap === 'outdoor'}
						class={`kennel-map-tab ${activeMap === 'outdoor' ? 'kennel-map-tab-active' : ''}`}
						on:click={() => (activeMap = 'outdoor')}
					>
						Outdoor
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeMap === 'inside'}
						class={`kennel-map-tab ${activeMap === 'inside' ? 'kennel-map-tab-active' : ''}`}
						on:click={() => (activeMap = 'inside')}
					>
						Inside
					</button>
				</div>
			</div>
		</div>
		{#if activeMap === 'inside'}
			<div class="kennels-body">
				<InsideKennelMap {dogs} {canEdit} />
			</div>
		{:else}
		<div class="kennels-body space-y-4">
			<div class="space-y-4">
				<div class="map-sheet">
					<div class="kennel-map" style={`--mobile-rows: ${mobileRows};`}>
						{#each kennelCells as cell}
							<div
								class={`kennel-cell ${cell.isSpecial ? 'kennel-special' : ''} ${
									hoveredRun === cell.runId ? 'kennel-cell-active' : ''
								} ${cell.runKey && conflictRunKeys.has(cell.runKey) ? 'kennel-cell-conflict' : ''}`}
								data-drop-run={cell.runId !== null ? runIdToKey(cell.runId) : undefined}
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
										{#if cell.runKey && conflictRunKeys.has(cell.runKey)}
											<span class="kennel-conflict-note">Intact male + female</span>
										{/if}
										{@const slotDogs = assignments[cell.runKey ?? ''] ?? []}
										{@const slotPlaceholders = placeholdersByRun[cell.runKey ?? ''] ?? []}
										{#if slotDogs.length > 0 || slotPlaceholders.length > 0}
											<div class="kennel-dog-stack">
												{#each slotDogs as slotDog}
													<div
														class={`kennel-dog ${canEdit ? 'kennel-dog-draggable' : ''} ${
															selectedDogId === slotDog.id ? 'kennel-dog-selected' : ''
														}`}
														draggable={canEdit}
														on:dragstart={(event) => handleDragStart(event, slotDog)}
														on:dragend={handleDragEnd}
														on:pointerdown={(event) => handleTouchDragStart(event, slotDog)}
														on:click|stopPropagation={() => toggleSelect(slotDog)}
													>
														<span>{slotDog.name}</span>
													</div>
												{/each}
												{#each slotPlaceholders as ph (ph.id)}
													<div
														class={`kennel-dog kennel-dog-placeholder ${canEdit ? 'kennel-dog-draggable' : ''} ${
															selectedDogId === ph.id ? 'kennel-dog-selected' : ''
														}`}
														draggable={canEdit}
														on:dragstart={(event) => handleDragStart(event, ph)}
														on:dragend={handleDragEnd}
														on:pointerdown={(event) => handleTouchDragStart(event, ph)}
														on:click|stopPropagation={() => toggleSelect(ph)}
													>
														<span>{ph.name}</span>
														<span class="kennel-placeholder-tag">expected</span>
														{#if canEdit}
															<button
																type="button"
																class="kennel-placeholder-remove"
																title="Remove expected dog"
																on:click|stopPropagation={() => removePlaceholder(ph)}
															>✕</button>
														{/if}
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
					{:else if kennelEligibleDogs.length === 0 && unassignedPlaceholders.length === 0}
						<p class="mt-3 text-sm text-ink-500">All active dogs are currently in foster.</p>
					{:else if unassigned.length === 0 && unassignedPlaceholders.length === 0}
						<p class="mt-3 text-sm text-ink-500">All active dogs have a run assigned.</p>
					{:else}
						<div class="mt-4 kennel-unassigned-list">
							{#each unassigned as dog}
								<div
									class={`kennel-unassigned-row ${canEdit ? 'kennel-dog-draggable' : ''}`}
									draggable={canEdit}
									on:dragstart={(event) => handleDragStart(event, dog)}
									on:dragend={handleDragEnd}
									on:pointerdown={(event) => handleTouchDragStart(event, dog)}
								>
									<span>{dog.name}</span>
								</div>
							{/each}
							{#each unassignedPlaceholders as ph (ph.id)}
								<div
									class={`kennel-unassigned-row kennel-unassigned-placeholder ${canEdit ? 'kennel-dog-draggable' : ''}`}
									draggable={canEdit}
									on:dragstart={(event) => handleDragStart(event, ph)}
									on:dragend={handleDragEnd}
									on:pointerdown={(event) => handleTouchDragStart(event, ph)}
								>
									<span>{ph.name} <span class="kennel-placeholder-tag">expected</span></span>
									{#if canEdit}
										<button
											type="button"
											class="kennel-placeholder-remove"
											title="Remove expected dog"
											on:click|stopPropagation={() => removePlaceholder(ph)}
										>✕</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					{#if isoDogs.length > 0}
						<div class="kennel-iso-section">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<p class="text-xs uppercase tracking-[0.2em] text-ink-500">In isolation</p>
								<span class="text-xs font-semibold text-ink-600">{isoDogs.length}</span>
							</div>
							<p class="mt-1 text-xs text-ink-500">Not assignable to an outdoor run.</p>
							<div class="mt-3 kennel-unassigned-list">
								{#each isoDogs as dog}
									<div class="kennel-unassigned-row kennel-unassigned-iso">
										<span>{dog.name}</span>
										<span class="kennel-iso-tag">ISO</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					{#if canEdit}
						<form class="kennel-expected-form" on:submit|preventDefault={handleAddPlaceholder}>
							<input
								type="text"
								class="kennel-expected-input"
								placeholder="Expecting a dog? Add their name…"
								bind:value={newPlaceholderName}
								disabled={addingPlaceholder}
							/>
							<button type="submit" class="kennel-expected-add" disabled={addingPlaceholder || !newPlaceholderName.trim()}>
								{addingPlaceholder ? 'Adding…' : 'Add expected'}
							</button>
						</form>
					{/if}
					<div
						class={`kennel-dropzone ${hoveredUnassigned ? 'kennel-dropzone-active' : ''}`}
						data-drop-unassigned="true"
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
					{#if selectedDog || selectedPlaceholder}
						<div class="mt-2 rounded-2xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
							Selected: <span class="font-semibold">{selectedDog?.name ?? selectedPlaceholder?.name}</span> - tap a run to assign.
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
							{#each placeholders as ph (ph.id)}
								<div
									class={`kennel-mobile-row kennel-mobile-row-placeholder ${selectedDogId === ph.id ? 'kennel-mobile-row-selected' : ''}`}
									role="button"
									tabindex="0"
									on:click={() => toggleSelect(ph)}
									on:keydown={(event) => event.key === 'Enter' && toggleSelect(ph)}
								>
									<p class="kennel-mobile-name">{ph.name} <span class="kennel-placeholder-tag">expected</span></p>
									<div class="kennel-mobile-run-row">
										<span>Run</span>
										<select
											class="kennel-run-select"
											disabled={!canEdit}
											value={runIdToSelectValue(placeholderRun(ph))}
											on:change={(event) => handlePlaceholderSelect(event, ph)}
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
		{/if}
	</div>
</section>

{#if touchDraggingId}
	<div
		use:ghostPortal
		aria-hidden="true"
		style={`position:fixed;z-index:9999;pointer-events:none;left:${touchDragX}px;top:${touchDragY - 48}px;transform:translateX(-50%);padding:0.24rem 0.56rem;border-radius:0.52rem;background:#e9f7ee;border:1px solid #bddcc7;color:#2a6248;font-size:0.92rem;font-weight:700;box-shadow:0 10px 18px rgba(18,36,57,.2);white-space:nowrap;`}
	>
		{touchDragName}
	</div>
{/if}

<style>
	.kennels-board {
		width: 100%;
	}

	.kennels-grid-board {
		border: 1px solid #d5e0ea;
		background: rgba(255, 255, 255, 0.9);
	}

	.kennel-hero {
		position: relative;
		display: grid;
		gap: 0.72rem;
		padding: 0.82rem 0.8rem;
		border-bottom: 1px solid #d5e0ea;
	}

	.kennel-title {
		margin: 0.3rem 0 0;
		font-family: var(--font-ui);
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

	.kennel-map-tabs {
		display: inline-flex;
		gap: 0.25rem;
		background: #eef3f9;
		border: 1px solid #d7e0eb;
		border-radius: 999px;
		padding: 0.2rem;
	}

	.kennel-map-tab {
		border: 0;
		background: transparent;
		border-radius: 999px;
		padding: 0.3rem 0.9rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #4d5f77;
		cursor: pointer;
	}

	.kennel-map-tab-active {
		background: #016aa5;
		color: #fff;
		box-shadow: 0 1px 3px rgba(1, 106, 165, 0.35);
	}

	.hero-chip-muted {
		background: #fff4f2;
		border-color: #e7c6c2;
		color: #8a4b46;
	}

	.hero-chip-expected {
		background: #fdf6e3;
		border-color: #e0c88a;
		color: #7a5c10;
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
			minmax(var(--kennel-row), auto)
			minmax(var(--kennel-row), auto)
			var(--kennel-gap)
			minmax(var(--kennel-row), auto)
			var(--kennel-gap)
			minmax(var(--kennel-row), auto);
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

	.kennel-cell-conflict {
		border-color: #cf4b4b;
		box-shadow: 0 0 0 2px rgba(207, 75, 75, 0.28);
		background: rgba(207, 75, 75, 0.07);
	}

	.kennel-conflict-note {
		display: inline-block;
		align-self: flex-start;
		margin-top: 0.14rem;
		padding: 0.08rem 0.34rem;
		border-radius: 0.22rem;
		background: #cf4b4b;
		color: #ffffff;
		font-size: 0.54rem;
		font-weight: 800;
		line-height: 1.15;
		letter-spacing: 0.04em;
		text-transform: uppercase;
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

	.kennel-dog-placeholder {
		background: #fdf6e3;
		border: 1.5px dashed #d8b968;
		color: #7a5c10;
		gap: 0.3rem;
	}

	.kennel-placeholder-tag {
		font-size: 0.56rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-radius: 999px;
		border: 1px solid #d8b968;
		background: #fff;
		color: #7a5c10;
		padding: 0.02rem 0.32rem;
	}

	.kennel-placeholder-remove {
		border: none;
		background: none;
		color: #9c7c2c;
		font-size: 0.72rem;
		line-height: 1;
		padding: 0.1rem 0.2rem;
		cursor: pointer;
	}

	.kennel-placeholder-remove:hover {
		color: #7a1f1f;
	}

	.kennel-unassigned-placeholder {
		background: #fdf6e3;
		border: 1.5px dashed #d8b968;
		border-radius: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.kennel-expected-form {
		margin-top: 0.7rem;
		display: flex;
		gap: 0.4rem;
	}

	.kennel-expected-input {
		flex: 1;
		min-width: 0;
		border: 1px solid #d7e0eb;
		border-radius: 0.5rem;
		padding: 0.4rem 0.6rem;
		font-size: 0.82rem;
	}

	.kennel-expected-add {
		flex-shrink: 0;
		border: 1px solid #d8b968;
		border-radius: 0.5rem;
		background: #fdf6e3;
		color: #7a5c10;
		font-size: 0.74rem;
		font-weight: 700;
		padding: 0.4rem 0.7rem;
	}

	.kennel-expected-add:disabled {
		opacity: 0.55;
	}

	.kennel-mobile-row-placeholder {
		background: #fdfaf0;
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

	.kennel-iso-section {
		margin-top: 1rem;
		padding-top: 0.85rem;
		border-top: 1.5px solid #ead0d0;
	}

	.kennel-unassigned-iso {
		justify-content: space-between;
		gap: 0.4rem;
		color: #8a5b5b;
		cursor: not-allowed;
	}

	.kennel-iso-tag {
		flex-shrink: 0;
		border-radius: 999px;
		background: #f7e3e3;
		border: 1px solid #e0b6b6;
		color: #cf4b4b;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		padding: 0.1rem 0.44rem;
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
			grid-template-rows: repeat(var(--mobile-rows), minmax(var(--kennel-row), auto));
			row-gap: 0;
		}

		.kennel-dog-draggable {
			touch-action: none;
			user-select: none;
			-webkit-user-select: none;
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
