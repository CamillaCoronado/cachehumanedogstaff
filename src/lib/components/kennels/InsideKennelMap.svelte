<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import toast from 'svelte-french-toast';
	import type { Dog } from '$lib/types';
	import { updateDog } from '$lib/data/dogs';
	import { patchDogInStore, refreshDogs } from '$lib/stores/dogs';
	import {
		addKennelPlaceholder,
		deleteKennelPlaceholder,
		isPlaceholderId,
		listKennelPlaceholders,
		setKennelPlaceholderInsideRun,
		type KennelPlaceholder
	} from '$lib/data/kennelPlaceholders';
	import { authProfile } from '$lib/stores/auth';
	import {
		insideKennelCells,
		insideCellByKey,
		getDogInsideKennel,
		getInsideAssignments,
		insideKeyToAssignment,
		checkInsidePlacement,
		compareByInsidePosition,
		getFleaBufferKeys,
		INSIDE_GRID_COLUMNS,
		INSIDE_MOBILE_ROWS
	} from '$lib/utils/insideKennelLayout';

	export let dogs: Dog[] = [];
	export let canEdit = false;

	let selectedId: string | null = null;
	let draggingId: string | null = null;
	let hoveredKey: string | null = null;

	// Inside kennels can hold in-building dogs AND foster dogs brought back inside (e.g.
	// during an outbreak). Only permanent-foster and iso-room dogs are excluded.
	$: eligible = dogs.filter(
		(dog) =>
			dog.status === 'active' &&
			!dog.permanentFoster &&
			dog.isolationStatus === 'none'
	);
	$: assignments = getInsideAssignments(eligible);
	$: unassigned = eligible
		.filter((dog) => !getDogInsideKennel(dog))
		.sort((a, b) => a.name.localeCompare(b.name));
	$: sickCount = eligible.filter((dog) => dog.sickHold).length;
	$: fosterCount = eligible.filter((dog) => dog.inFoster).length;

	// Flea buffers follow dogs marked with fleas: the kennels on either side are kept empty.
	$: fleaBufferKeys = getFleaBufferKeys(eligible);
	// Flag a flea-buffer kennel that has a dog in it (should be empty).
	$: flaggedKeys = new Set(
		[...fleaBufferKeys].filter((key) => (assignments[key] ?? []).length > 0)
	);

	// Expected-dog placeholders — the same ones as the outdoor board, carried over here
	// with their own inside-kennel assignment (KennelPlaceholder.insideRun).
	let placeholders: KennelPlaceholder[] = [];
	let newPlaceholderName = '';
	let addingPlaceholder = false;

	function placeholderInsideKey(p: KennelPlaceholder): string | null {
		return getDogInsideKennel({ insideKennelAssignment: p.insideRun ?? '' } as Dog);
	}
	$: placeholdersByKennel = placeholders.reduce<Record<string, KennelPlaceholder[]>>((map, p) => {
		const key = placeholderInsideKey(p);
		if (key) (map[key] ??= []).push(p);
		return map;
	}, {});
	$: unassignedPlaceholders = placeholders
		.filter((p) => placeholderInsideKey(p) === null)
		.sort((a, b) => a.name.localeCompare(b.name));

	function selectItem(id: string) {
		if (!canEdit) return;
		selectedId = selectedId === id ? null : id;
	}

	function warnForCell(key: string | null): boolean {
		const cell = key ? insideCellByKey.get(key) ?? null : null;
		if (!cell) return true;
		const { blocked, warning } = checkInsidePlacement(cell, fleaBufferKeys);
		if (blocked) {
			toast.error(warning ?? 'That kennel is unavailable.');
			return false;
		}
		if (warning) toast(warning, { icon: '⚠️' });
		return true;
	}

	async function assign(dog: Dog, key: string | null) {
		if (!canEdit || !warnForCell(key)) return;
		const next = insideKeyToAssignment(key);
		if (next === (dog.insideKennelAssignment ?? '')) return;
		patchDogInStore(dog.id, { insideKennelAssignment: next });
		selectedId = null;
		try {
			await updateDog(dog.id, { insideKennelAssignment: next });
			toast.success(key ? `${dog.name} → Kennel ${key}` : `${dog.name} unassigned`);
		} catch {
			toast.error(`Could not move ${dog.name}.`);
			await refreshDogs();
		}
	}

	async function assignPlaceholder(ph: KennelPlaceholder, key: string | null) {
		if (!canEdit || !warnForCell(key)) return;
		const next = insideKeyToAssignment(key);
		if (next === (ph.insideRun ?? '')) return;
		const prev = placeholders;
		placeholders = placeholders.map((p) => (p.id === ph.id ? { ...p, insideRun: next } : p));
		selectedId = null;
		try {
			await setKennelPlaceholderInsideRun(ph.id, next);
			toast.success(key ? `${ph.name} (expected) → Kennel ${key}` : `${ph.name} (expected) unassigned`);
		} catch {
			placeholders = prev;
			toast.error(`Could not move ${ph.name}.`);
		}
	}

	function moveItem(id: string, key: string | null) {
		if (isPlaceholderId(id)) {
			const ph = placeholders.find((p) => p.id === id);
			if (ph) void assignPlaceholder(ph, key);
		} else {
			const dog = dogs.find((d) => d.id === id);
			if (dog) void assign(dog, key);
		}
	}

	function handleDragStart(event: DragEvent, item: { id: string; name: string }) {
		if (!canEdit) return;
		draggingId = item.id;
		event.dataTransfer?.setData('text/plain', item.id);
	}

	function handleDrop(key: string | null) {
		hoveredKey = null;
		if (draggingId) moveItem(draggingId, key);
		draggingId = null;
	}

	function handleCellTap(key: string) {
		if (selectedId) moveItem(selectedId, key);
	}

	function unassignSelected() {
		if (selectedId) moveItem(selectedId, null);
	}

	async function handleAddPlaceholder() {
		const name = newPlaceholderName.trim();
		if (!name || addingPlaceholder) return;
		addingPlaceholder = true;
		try {
			const entry = await addKennelPlaceholder(name, $authProfile?.displayName ?? 'Staff');
			placeholders = [...placeholders, entry];
			newPlaceholderName = '';
		} catch {
			toast.error('Could not add expected dog.');
		} finally {
			addingPlaceholder = false;
		}
	}

	async function removePlaceholder(ph: KennelPlaceholder) {
		const prev = placeholders;
		placeholders = placeholders.filter((p) => p.id !== ph.id);
		try {
			await deleteKennelPlaceholder(ph.id);
		} catch {
			placeholders = prev;
			toast.error(`Could not remove ${ph.name}.`);
		}
	}

	// --- Movement protocol ---
	// Direction: taking dogs OUT (AM) vs bringing them IN (PM). Sick dogs never cross paths
	// with healthy ones — out last, in first — so the panel lists the two groups in the
	// correct order for the chosen direction.
	let moveDirection: 'out' | 'in' = new Date().getHours() < 12 ? 'out' : 'in';
	$: healthyOrdered = eligible.filter((dog) => !dog.sickHold).sort(compareByInsidePosition);
	$: sickOrdered = eligible.filter((dog) => dog.sickHold).sort(compareByInsidePosition);
	$: passGroups =
		moveDirection === 'out'
			? [
					{ label: 'Healthy — move first', tone: 'healthy', dogs: healthyOrdered },
					{ label: 'Sick — move LAST', tone: 'sick', dogs: sickOrdered }
				]
			: [
					{ label: 'Sick — move FIRST', tone: 'sick', dogs: sickOrdered },
					{ label: 'Healthy — move last', tone: 'healthy', dogs: healthyOrdered }
				];

	// Manual spray timer: staff tap to start a 10-minute countdown after spraying the
	// walkway with accel; display-only (no gating). Persisted to localStorage so it
	// survives a reload on this device.
	const SPRAY_MS = 10 * 60 * 1000;
	const SPRAY_KEY = 'insideSprayedAt';
	let sprayedAt: number | null = null;
	let nowTs = Date.now();
	let sprayTimer: ReturnType<typeof setInterval> | null = null;
	$: sprayRemaining = sprayedAt ? Math.max(0, SPRAY_MS - (nowTs - sprayedAt)) : 0;

	function fmtRemaining(ms: number): string {
		const total = Math.ceil(ms / 1000);
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function startSpray() {
		sprayedAt = Date.now();
		nowTs = Date.now();
		try {
			localStorage.setItem(SPRAY_KEY, String(sprayedAt));
		} catch {
			/* ignore storage failures */
		}
	}

	function clearSpray() {
		sprayedAt = null;
		try {
			localStorage.removeItem(SPRAY_KEY);
		} catch {
			/* ignore */
		}
	}

	onMount(() => {
		void listKennelPlaceholders().then((list) => (placeholders = list));
		try {
			const stored = Number(localStorage.getItem(SPRAY_KEY));
			if (stored && Date.now() - stored < SPRAY_MS) sprayedAt = stored;
			else if (stored) localStorage.removeItem(SPRAY_KEY);
		} catch {
			/* ignore */
		}
		sprayTimer = setInterval(() => (nowTs = Date.now()), 1000);
	});

	onDestroy(() => {
		if (sprayTimer) clearInterval(sprayTimer);
	});
</script>

<div class="inside-map">
	<div class="inside-legend">
		<span class="inside-legend-item"><span class="inside-dot inside-dot-healthy"></span> Healthy dog</span>
		<span class="inside-legend-item"><span class="inside-dot inside-dot-sick"></span> Sick dog</span>
		<span class="inside-legend-count">{eligible.length} dogs · {sickCount} sick{#if fosterCount > 0} · {fosterCount} foster{/if}</span>
	</div>

	{#if selectedId && canEdit}
		<p class="inside-selected-hint">
			Selected <strong>{dogs.find((d) => d.id === selectedId)?.name}</strong> — tap a kennel to move, or tap the name again to cancel.
		</p>
	{/if}

	<div class="inside-map-scroll">
		<div class="inside-grid" style={`--cols: ${INSIDE_GRID_COLUMNS}; --mobile-rows: ${INSIDE_MOBILE_ROWS};`}>
			{#each insideKennelCells as cell (cell.id)}
				{@const slotDogs = assignments[cell.key] ?? []}
				{@const blocked = cell.kind === 'blocked'}
				{@const isBuffer = fleaBufferKeys.has(cell.key)}
				{@const slotPh = placeholdersByKennel[cell.key] ?? []}
				<div
					class={`inside-cell inside-cell-kind-${cell.kind} ${
						isBuffer ? 'inside-cell-buffer' : ''
					} ${hoveredKey === cell.key ? 'inside-cell-hover' : ''} ${
						flaggedKeys.has(cell.key) ? 'inside-cell-flagged' : ''
					}`}
					style={`grid-column: ${cell.col}; grid-row: ${cell.row}; --m-col: ${cell.mobileCol}; --m-row: ${cell.mobileRow};`}
					role={blocked ? undefined : 'button'}
					tabindex={blocked || !canEdit ? undefined : 0}
					aria-label={`Kennel ${cell.label}${cell.note ? ` — ${cell.note}` : isBuffer ? ' — flea buffer, keep empty' : ''}`}
					on:dragover|preventDefault={() => !blocked && (hoveredKey = cell.key)}
					on:dragenter|preventDefault={() => !blocked && (hoveredKey = cell.key)}
					on:dragleave={() => (hoveredKey = null)}
					on:drop|preventDefault={() => !blocked && handleDrop(cell.key)}
					on:click={() => !blocked && handleCellTap(cell.key)}
					on:keydown={(e) => !blocked && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), handleCellTap(cell.key))}
				>
					<span class="inside-cell-label">{cell.label}</span>
					{#if cell.note}
						<span class="inside-cell-note">{cell.note}</span>
					{:else if isBuffer && slotDogs.length === 0 && slotPh.length === 0}
						<span class="inside-cell-note">Flea buffer</span>
					{/if}
					{#if slotDogs.length > 0 || slotPh.length > 0}
						<div class="inside-cell-dogs">
							{#each slotDogs as dog (dog.id)}
								<span
									class={`inside-chip ${dog.sickHold ? 'inside-chip-sick' : ''} ${
										selectedId === dog.id ? 'inside-chip-selected' : ''
									}`}
									role="button"
									tabindex={canEdit ? 0 : undefined}
									draggable={canEdit}
									on:dragstart={(e) => handleDragStart(e, dog)}
									on:dragend={() => (draggingId = null)}
									on:click|stopPropagation={() => selectItem(dog.id)}
									on:keydown|stopPropagation={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), selectItem(dog.id))}
								>
									{dog.name}{#if dog.inFoster}<span class="inside-chip-tag inside-chip-tag-foster">FOSTER</span>{/if}{#if dog.sickHold}<span class="inside-chip-tag">SICK</span>{/if}{#if dog.sickMonitor}<span class="inside-chip-tag inside-chip-tag-monitor">MON</span>{/if}{#if dog.hasFleas}<span class="inside-chip-tag inside-chip-tag-flea">FLEAS</span>{/if}
								</span>
							{/each}
							{#each slotPh as ph (ph.id)}
								<span
									class={`inside-chip inside-chip-expected ${selectedId === ph.id ? 'inside-chip-selected' : ''}`}
									role="button"
									tabindex={canEdit ? 0 : undefined}
									draggable={canEdit}
									on:dragstart={(e) => handleDragStart(e, ph)}
									on:dragend={() => (draggingId = null)}
									on:click|stopPropagation={() => selectItem(ph.id)}
									on:keydown|stopPropagation={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), selectItem(ph.id))}
								>
									{ph.name}<span class="inside-chip-tag inside-chip-tag-expected">EXP</span>
								</span>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<div class="inside-unassigned">
		<div class="inside-unassigned-head">
			<p class="inside-unassigned-title">Unassigned</p>
			<span class="inside-unassigned-count">{unassigned.length + unassignedPlaceholders.length}</span>
		</div>
		{#if unassigned.length === 0 && unassignedPlaceholders.length === 0}
			<p class="inside-unassigned-empty">Every in-building dog has an inside kennel.</p>
		{:else}
			<div class="inside-unassigned-list">
				{#each unassigned as dog (dog.id)}
					<span
						class={`inside-chip ${dog.sickHold ? 'inside-chip-sick' : ''} ${
							selectedId === dog.id ? 'inside-chip-selected' : ''
						}`}
						role="button"
						tabindex={canEdit ? 0 : undefined}
						draggable={canEdit}
						on:dragstart={(e) => handleDragStart(e, dog)}
						on:dragend={() => (draggingId = null)}
						on:click={() => selectItem(dog.id)}
						on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), selectItem(dog.id))}
					>
						{dog.name}{#if dog.inFoster}<span class="inside-chip-tag inside-chip-tag-foster">FOSTER</span>{/if}{#if dog.sickHold}<span class="inside-chip-tag">SICK</span>{/if}{#if dog.sickMonitor}<span class="inside-chip-tag inside-chip-tag-monitor">MON</span>{/if}{#if dog.hasFleas}<span class="inside-chip-tag inside-chip-tag-flea">FLEAS</span>{/if}
					</span>
				{/each}
				{#each unassignedPlaceholders as ph (ph.id)}
					<span
						class={`inside-chip inside-chip-expected ${selectedId === ph.id ? 'inside-chip-selected' : ''}`}
						role="button"
						tabindex={canEdit ? 0 : undefined}
						draggable={canEdit}
						on:dragstart={(e) => handleDragStart(e, ph)}
						on:dragend={() => (draggingId = null)}
						on:click={() => selectItem(ph.id)}
						on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), selectItem(ph.id))}
					>
						{ph.name}<span class="inside-chip-tag inside-chip-tag-expected">EXP</span>
						{#if canEdit}
							<button type="button" class="inside-chip-remove" title="Remove expected dog" on:click|stopPropagation={() => removePlaceholder(ph)}>✕</button>
						{/if}
					</span>
				{/each}
			</div>
		{/if}
		{#if canEdit}
			<form class="inside-expected-form" on:submit|preventDefault={handleAddPlaceholder}>
				<input
					class="inside-expected-input"
					type="text"
					placeholder="Expecting a dog? Add their name…"
					bind:value={newPlaceholderName}
					disabled={addingPlaceholder}
				/>
				<button type="submit" class="inside-expected-add" disabled={addingPlaceholder || !newPlaceholderName.trim()}>
					{addingPlaceholder ? 'Adding…' : 'Add expected'}
				</button>
			</form>
			<div
				class="inside-dropzone"
				role="button"
				tabindex="0"
				on:dragover|preventDefault={() => {}}
				on:drop|preventDefault={() => handleDrop(null)}
				on:click={unassignSelected}
				on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), unassignSelected())}
			>
				Drop or tap here to unassign
			</div>
		{/if}
	</div>

	<div class="inside-movement">
		<div class="inside-movement-head">
			<p class="inside-movement-title">Movement</p>
			<div class="inside-dir-toggle" role="tablist" aria-label="Movement direction">
				<button
					type="button"
					role="tab"
					aria-selected={moveDirection === 'out'}
					class={`inside-dir-btn ${moveDirection === 'out' ? 'inside-dir-btn-active' : ''}`}
					on:click={() => (moveDirection = 'out')}
				>
					Taking out
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={moveDirection === 'in'}
					class={`inside-dir-btn ${moveDirection === 'in' ? 'inside-dir-btn-active' : ''}`}
					on:click={() => (moveDirection = 'in')}
				>
					Bringing in
				</button>
			</div>
		</div>

		<p class="inside-movement-rule">
			{moveDirection === 'out'
				? 'Take healthy dogs out first; sick dogs go out LAST so they never pass healthy dogs.'
				: 'Bring sick dogs in FIRST; healthy dogs come in last so they never pass sick dogs.'}
		</p>

		<div class="inside-spray">
			{#if sprayRemaining > 0}
				<span class="inside-spray-count">Wait {fmtRemaining(sprayRemaining)} after spraying before bringing sick dogs in.</span>
				<button type="button" class="inside-spray-reset" on:click={clearSpray}>Reset</button>
			{:else}
				<button type="button" class="inside-spray-start" on:click={startSpray}>Sprayed walkway — start 10-min timer</button>
			{/if}
		</div>

		{#each passGroups as group (group.label)}
			<div class={`inside-move-group inside-move-group-${group.tone}`}>
				<p class="inside-move-group-label">{group.label} <span class="inside-move-group-count">({group.dogs.length})</span></p>
				{#if group.dogs.length === 0}
					<p class="inside-move-empty">None.</p>
				{:else}
					<ol class="inside-move-list">
						{#each group.dogs as dog (dog.id)}
							<li>{dog.name}<span class="inside-move-kennel">{getDogInsideKennel(dog) ? `Kennel ${getDogInsideKennel(dog)}` : 'unassigned'}</span></li>
						{/each}
					</ol>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.inside-map {
		display: grid;
		gap: 0.9rem;
	}

	.inside-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.9rem;
		font-size: 0.78rem;
		color: #43566d;
	}

	.inside-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.36rem;
		font-weight: 600;
	}

	.inside-dot {
		width: 0.72rem;
		height: 0.72rem;
		border-radius: 0.2rem;
		border: 1px solid rgba(0, 0, 0, 0.15);
	}
	.inside-dot-healthy { background: #e9f7ee; border-color: #bddcc7; }
	.inside-dot-sick { background: #fdeeee; border-color: #e0a9a9; }

	.inside-legend-count {
		margin-left: auto;
		font-weight: 600;
		color: #6a7c93;
	}

	.inside-selected-hint {
		margin: 0;
		font-size: 0.8rem;
		color: #016aa5;
		background: #eaf4fb;
		border: 1px solid #bfddef;
		border-radius: 0.6rem;
		padding: 0.4rem 0.6rem;
	}

	.inside-map-scroll {
		overflow-x: auto;
		background: #ffffff;
		border-radius: 0.9rem;
		box-shadow: 0 6px 10px rgba(40, 53, 67, 0.08);
		padding: 0.3rem;
	}

	.inside-grid {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(70px, 1fr));
		gap: 0;
		min-width: 760px;
		padding: 0.25rem;
		background: #fbfdff;
		border-radius: 0.7rem;
	}

	.inside-cell {
		position: relative;
		min-height: 66px;
		border: 1px solid #c5d2e1;
		background: #ffffff;
		border-radius: 0.16rem;
		padding: 0.25rem 0.35rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 0.16rem;
		cursor: pointer;
		transition: border 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
	}

	.inside-cell-kind-blocked {
		background: #f7faff;
		border-style: dashed;
		align-items: center;
		justify-content: center;
		text-align: center;
		cursor: not-allowed;
	}
	.inside-cell-buffer {
		background: #fffdf5;
		border-style: dashed;
		border-color: #d8b968;
	}

	.inside-cell-hover {
		border-color: #6e9fc8;
		box-shadow: 0 0 0 2px rgba(110, 159, 200, 0.24);
		transform: translateY(-1px);
	}
	.inside-cell-flagged {
		border-color: #cf4b4b;
		box-shadow: 0 0 0 2px rgba(207, 75, 75, 0.28);
		background: rgba(207, 75, 75, 0.07);
	}

	.inside-cell-label {
		display: flex;
		justify-content: flex-end;
		font-size: clamp(0.55rem, 1.8vw, 0.7rem);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: #7086a3;
		line-height: 1;
	}
	.inside-cell-note {
		font-size: 0.56rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #547192;
		line-height: 1.1;
	}

	.inside-cell-dogs {
		display: grid;
		gap: 0.18rem;
		margin-top: auto;
	}

	.inside-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		align-self: flex-start;
		background: #e9f7ee;
		border: 1px solid #bddcc7;
		border-radius: 0.52rem;
		padding: 0.16rem 0.5rem;
		font-size: clamp(0.78rem, 2.3vw, 0.9rem);
		font-weight: 700;
		color: #2a6248;
		cursor: grab;
		white-space: nowrap;
	}
	.inside-chip-sick {
		background: #fdeeee;
		border-color: #e0a9a9;
		color: #a5302f;
	}
	.inside-chip-selected {
		border-color: #6e9fc8;
		box-shadow: 0 0 0 2px rgba(110, 159, 200, 0.35);
	}
	.inside-chip-tag {
		font-size: 0.54rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		color: #cf4b4b;
	}
	.inside-chip-tag-flea {
		color: #a1670f;
	}
	.inside-chip-tag-monitor {
		color: #2e6c30;
	}
	.inside-chip-tag-foster {
		color: #933980;
	}
	.inside-chip-expected {
		background: #fdf6e3;
		border: 1.5px dashed #d8b968;
		color: #7a5c10;
	}
	.inside-chip-tag-expected {
		color: #9c7c2c;
	}
	.inside-chip-remove {
		border: 0;
		background: none;
		color: #9c7c2c;
		font-size: 0.72rem;
		line-height: 1;
		padding: 0 0 0 0.1rem;
		cursor: pointer;
	}
	.inside-chip-remove:hover {
		color: #7a1f1f;
	}

	.inside-expected-form {
		margin-top: 0.7rem;
		display: flex;
		gap: 0.4rem;
	}
	.inside-expected-input {
		flex: 1;
		min-width: 0;
		border: 1px solid #d7e0eb;
		border-radius: 0.5rem;
		padding: 0.4rem 0.6rem;
		font-size: 0.82rem;
	}
	.inside-expected-add {
		flex-shrink: 0;
		border: 1px solid #d8b968;
		background: #fdf6e3;
		border-radius: 0.5rem;
		padding: 0.4rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: #7a5c1a;
		cursor: pointer;
	}
	.inside-expected-add:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.inside-unassigned {
		border: 1px solid #d7e0eb;
		border-radius: 0.9rem;
		background: #fff;
		padding: 0.7rem 0.8rem;
	}
	.inside-unassigned-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.inside-unassigned-title {
		margin: 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: #6a7c93;
	}
	.inside-unassigned-count {
		font-size: 0.78rem;
		font-weight: 700;
		color: #43566d;
	}
	.inside-unassigned-empty {
		margin: 0.5rem 0 0;
		font-size: 0.82rem;
		color: #6a7c93;
	}
	.inside-unassigned-list {
		margin-top: 0.6rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.inside-dropzone {
		margin-top: 0.7rem;
		border: 1px dashed #b8cadd;
		background: #f7fbff;
		border-radius: 0.6rem;
		padding: 0.6rem;
		text-align: center;
		font-size: 0.78rem;
		color: #6a7c93;
		cursor: pointer;
	}

	.inside-movement {
		border: 1px solid #d7e0eb;
		border-radius: 0.9rem;
		background: #fff;
		padding: 0.7rem 0.8rem;
		display: grid;
		gap: 0.6rem;
	}
	.inside-movement-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.inside-movement-title {
		margin: 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: #6a7c93;
	}
	.inside-dir-toggle {
		display: inline-flex;
		gap: 0.2rem;
		background: #eef3f9;
		border: 1px solid #d7e0eb;
		border-radius: 999px;
		padding: 0.16rem;
	}
	.inside-dir-btn {
		border: 0;
		background: transparent;
		border-radius: 999px;
		padding: 0.26rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: #4d5f77;
		cursor: pointer;
	}
	.inside-dir-btn-active {
		background: #016aa5;
		color: #fff;
	}
	.inside-movement-rule {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
		color: #33414f;
	}

	.inside-spray {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		background: #fcf3f3;
		border: 1px solid #e0b6b6;
		border-radius: 0.6rem;
		padding: 0.44rem 0.6rem;
	}
	.inside-spray-start {
		border: 0;
		background: #cf4b4b;
		color: #fff;
		border-radius: 0.5rem;
		padding: 0.4rem 0.8rem;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}
	.inside-spray-count {
		font-size: 0.82rem;
		font-weight: 700;
		color: #b23c3c;
		margin-right: auto;
	}
	.inside-spray-reset {
		border: 1px solid #cbb3b3;
		background: #fff;
		color: #8a5b5b;
		border-radius: 0.5rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.74rem;
		font-weight: 700;
		cursor: pointer;
	}

	.inside-move-group {
		border-radius: 0.6rem;
		border: 1px solid #e2e8f0;
		padding: 0.4rem 0.6rem;
	}
	.inside-move-group-sick {
		border-color: #e0b6b6;
		background: #fdf5f5;
	}
	.inside-move-group-healthy {
		border-color: #cfe6c6;
		background: #f5fbf2;
	}
	.inside-move-group-label {
		margin: 0 0 0.3rem;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: #33414f;
	}
	.inside-move-group-count {
		font-weight: 600;
		color: #6a7c93;
	}
	.inside-move-empty {
		margin: 0;
		font-size: 0.78rem;
		color: #6a7c93;
	}
	.inside-move-list {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.12rem;
	}
	.inside-move-list li {
		font-size: 0.82rem;
		font-weight: 600;
		color: #2a3746;
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.inside-move-kennel {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #8a97a6;
	}

	/* Mobile: transpose the grid 90° (rows → columns) like the outdoor map, so it fits a
	   portrait screen without horizontal scrolling. */
	@media (max-width: 640px) {
		.inside-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			grid-template-rows: repeat(var(--mobile-rows), minmax(3.4rem, auto));
			min-width: 0;
		}
		.inside-cell {
			grid-column: var(--m-col) !important;
			grid-row: var(--m-row) !important;
		}
		.inside-chip {
			touch-action: none;
			user-select: none;
			-webkit-user-select: none;
		}
	}
</style>
