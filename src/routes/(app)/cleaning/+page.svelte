<script lang="ts">
	import { onMount } from 'svelte';
	import { format, startOfDay } from 'date-fns';
	import { subscribeCompletedTasks, toggleCleaningTask } from '$lib/data/cleaning';
	import type { CleaningShift, TaskCompletionMeta } from '$lib/data/cleaning';
	import { checklistFor } from '$lib/data/cleaningChecklist';
	import type { StaffRole } from '$lib/data/cleaningChecklist';
	import { authProfile } from '$lib/stores/auth';
	import { readJson, writeJson } from '$lib/utils/storage';

	type Shift = CleaningShift;
	type StaffFilter = 'all' | StaffRole;

	const STAFF_FILTER_KEY = 'shelter.cleaningStaffFilter.v1';
	const STAFF_FILTERS: StaffFilter[] = ['all', 'A', 'B'];

	const today = startOfDay(new Date());
	const dateKey = format(today, 'yyyy-MM-dd');
	const dayName = format(today, 'EEEE');
	const isSunday = dayName.toLowerCase() === 'sunday';
	const _n = new Date();
	const defaultShift: Shift =
		_n.getHours() > 13 || (_n.getHours() === 13 && _n.getMinutes() >= 30) ? 'evening' : 'morning';

	let shift: Shift = defaultShift;
	let showSundayOverride = false;
	let completed = new Set<string>();
	let taskMeta: Record<string, TaskCompletionMeta> = {};
	let lastUpdated = '';
	let staffFilter: StaffFilter = 'all';

	// Live subscription: checkmarks from other devices appear without a reload.
	let unsubscribeCompleted: (() => void) | null = null;
	function subscribeToShift() {
		unsubscribeCompleted?.();
		unsubscribeCompleted = subscribeCompletedTasks(dateKey, shift, (completions) => {
			completed = completions.ids;
			taskMeta = completions.meta;
		});
	}

	function taskByLine(taskId: string) {
		const meta = taskMeta[taskId];
		if (!meta?.by) return '';
		const at = new Date(meta.at);
		return Number.isNaN(at.getTime()) ? meta.by : `${meta.by} · ${format(at, 'h:mma').toLowerCase()}`;
	}

	onMount(() => {
		const saved = readJson<StaffFilter>(STAFF_FILTER_KEY, 'all');
		if (saved === 'A' || saved === 'B') staffFilter = saved;
		subscribeToShift();
		return () => unsubscribeCompleted?.();
	});

	$: sheet = checklistFor(today, shift, showSundayOverride);
	$: sections = sheet.sections.filter((section) => staffFilter === 'all' || section.staff === staffFilter);
	$: allTaskIds = sections.flatMap((section) => section.tasks.map((task) => task.id));
	$: completedCount = allTaskIds.filter((id) => completed.has(id)).length;

	function toggleTask(taskId: string) {
		const checked = !completed.has(taskId);
		const byName = $authProfile?.displayName ?? null;
		const next = new Set(completed);
		const nextMeta = { ...taskMeta };
		if (checked) {
			next.add(taskId);
			nextMeta[taskId] = { by: byName, at: new Date().toISOString() };
		} else {
			next.delete(taskId);
			delete nextMeta[taskId];
		}
		completed = next;
		taskMeta = nextMeta;
		lastUpdated = new Date().toISOString();
		void toggleCleaningTask(dateKey, shift, taskId, checked, byName);
	}

	function setStaffFilter(value: StaffFilter) {
		staffFilter = value;
		writeJson(STAFF_FILTER_KEY, value);
	}

	function setShift(value: Shift) {
		shift = value;
		lastUpdated = '';
		subscribeToShift();
	}
</script>

<svelte:head>
	<title>Cleaning | Cache Humane Society</title>
</svelte:head>

<section class="cleaning-board">
	<div class="cleaning-grid-board">
		<div class="cleaning-hero">
			<div>
				<p class="cleaning-meta whiteboard-hand erase-marker-blue">
					{completedCount}/{allTaskIds.length} tasks complete
					{#if lastUpdated}
						<span class="cleaning-updated typewriter">Last updated {new Date(lastUpdated).toLocaleTimeString()}</span>
					{/if}
				</p>
			</div>
			<div class="shift-picker">
				<button
					class={`shift-pill ${shift === 'morning' ? 'shift-pill-active' : ''}`}
					on:click={() => setShift('morning')}
					type="button"
				>
					AM
				</button>
				<button
					class={`shift-pill ${shift === 'evening' ? 'shift-pill-active' : ''}`}
					on:click={() => setShift('evening')}
					type="button"
				>
					PM
				</button>
			</div>
		</div>

		<div class="staff-filter" role="group" aria-label="Show staff">
			{#each STAFF_FILTERS as value}
				<button
					class={`shift-pill ${staffFilter === value ? 'shift-pill-active' : ''}`}
					on:click={() => setStaffFilter(value)}
					type="button"
				>
					{value === 'all' ? 'All' : `Staff ${value}`}
				</button>
			{/each}
		</div>

		{#if !isSunday}
			<div class="sunday-toggle">
				<div class="sunday-toggle-inner">
					<p class="sunday-copy whiteboard-hand">
						Sunday sheets replace the regular ones on Sundays. Toggle to preview them on other days.
					</p>
					<button
						class={`sunday-toggle-btn ${showSundayOverride ? 'sunday-toggle-btn-active' : ''}`}
						type="button"
						on:click={() => (showSundayOverride = !showSundayOverride)}
					>
						{showSundayOverride ? 'Hide Sunday Sheet' : 'Show Sunday Sheet'}
					</button>
				</div>
			</div>
		{/if}

		<div class="sheet-intro">
			<h2 class="sheet-title typewriter">{sheet.title}</h2>
			{#if sheet.note}
				<p class="section-note whiteboard-hand">{sheet.note}</p>
			{/if}
		</div>

		<div class="checklist-sections">
			{#each sections as section}
				<div class="checklist-sheet">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h3 class="section-title typewriter">Staff {section.staff}{section.side ? `: ${section.side}` : ''}</h3>
							{#if section.subtitle}
								<p class="section-note whiteboard-hand">{section.subtitle}</p>
							{/if}
						</div>
						<span class="section-progress">
							{section.tasks.filter((task) => completed.has(task.id)).length}/{section.tasks.length}
						</span>
					</div>
					<div class="task-list">
						{#each section.tasks as task}
							<label class={`task-row ${completed.has(task.id) ? 'task-row-done' : ''}`}>
								<input
									type="checkbox"
									class="task-check"
									checked={completed.has(task.id)}
									on:change={() => toggleTask(task.id)}
								/>
								<span class="task-copy">
									{task.description}
									{#if task.detail}
										<span class="task-detail">{task.detail}</span>
									{/if}
								</span>
								{#if completed.has(task.id) && taskByLine(task.id)}
									<span class="task-by">{taskByLine(task.id)}</span>
								{/if}
							</label>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		{#if sheet.footer}
			<p class="sheet-footer typewriter">{sheet.footer}</p>
		{/if}
	</div>
</section>

<style>
	.cleaning-board {
		width: 100%;
	}

	.cleaning-grid-board {
		border: 1px solid #d5e0ea;
		background: rgba(255, 255, 255, 0.9);
	}

	.cleaning-hero,
	.sunday-toggle {
		position: relative;
		background: transparent;
	}

	.cleaning-hero {
		padding: 0.82rem 0.78rem;
		display: grid;
		gap: 0.66rem;
		border-bottom: 1px solid #d5e0ea;
	}

	.cleaning-hero::after,
	.checklist-sheet::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: repeating-linear-gradient(
			0deg,
			transparent 0,
			transparent 24px,
			rgba(180, 198, 214, 0.07) 24px,
			rgba(180, 198, 214, 0.07) 25px
		);
		pointer-events: none;
	}

	.cleaning-title,
	.cleaning-meta,
	.checklist-sheet > * {
		position: relative;
		z-index: 1;
	}

	.cleaning-title {
		margin-top: 0.42rem;
		font-size: 1.34rem;
		line-height: 1.1;
		color: var(--marker-black);
	}

	.cleaning-meta {
		margin-top: 0.3rem;
		font-size: 0.9rem;
		line-height: 1.2;
	}

	.cleaning-updated {
		display: inline-block;
		margin-left: 0.42rem;
		font-size: 0.7rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.shift-picker {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.36rem;
	}

	.shift-pill {
		min-height: 2.75rem;
		border: 1px solid #d5e0ea;
		border-radius: 0.24rem;
		background: #ffffff;
		font-family: var(--font-typewriter);
		font-size: 0.88rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--marker-black);
	}

	.shift-pill-active {
		background: var(--sticky-blue);
		color: #103b5f;
	}

	.sunday-toggle {
		padding: 0.62rem;
		border-bottom: 1px solid #d5e0ea;
	}

	.sunday-toggle-inner {
		display: grid;
		gap: 0.46rem;
	}

	.sunday-copy {
		font-size: 0.82rem;
		line-height: 1.2;
		color: var(--ink-soft);
	}

	.sunday-toggle-btn {
		min-height: 2.75rem;
		border: 1px solid #d5e0ea;
		border-radius: 0.22rem;
		background: #ffffff;
		padding: 0.24rem 0.58rem;
		font-family: var(--font-typewriter);
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--marker-black);
	}

	.sunday-toggle-btn-active {
		background: var(--sticky-green);
		color: #155f3b;
	}

	.staff-filter {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.36rem;
		padding: 0.62rem;
		border-bottom: 1px solid #d5e0ea;
	}

	.sheet-intro {
		padding: 0.75rem 0.72rem 0.62rem;
	}

	.sheet-title {
		font-family: var(--font-ui);
		font-size: 1.1rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--marker-black);
	}

	.sheet-footer {
		padding: 0.75rem 0.72rem;
		border-top: 1px solid #d5e0ea;
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--marker-black);
	}

	.task-detail {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}

	.checklist-sections {
		display: grid;
		gap: 0;
	}

	.checklist-sheet {
		position: relative;
		border-top: 1px solid #d5e0ea;
		background: #ffffff;
		padding: 0.75rem 0.72rem;
		overflow: hidden;
	}

	.section-title {
		font-family: var(--font-ui);
		font-size: clamp(1.28rem, 5.8vw, 1.8rem);
		font-weight: 400;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--marker-black);
		line-height: 1.02;
	}

	.section-note {
		margin-top: 0.28rem;
		font-size: 0.77rem;
		color: var(--ink-soft);
	}

	.section-progress {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.5rem;
		border: 1px solid #d5e0ea;
		border-radius: 0.22rem;
		padding: 0.28rem 0.5rem;
		font-family: var(--font-typewriter);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.11em;
		color: var(--marker-black);
		background: rgba(255, 255, 255, 0.8);
	}

	.task-list {
		margin-top: 0.62rem;
		display: grid;
		gap: 0.38rem;
	}

	.task-row {
		display: flex;
		align-items: flex-start;
		gap: 0.54rem;
		border: 1.5px dashed #c5ceda;
		border-radius: 0.24rem;
		padding: 0.56rem 0.6rem;
		background: rgba(255, 255, 255, 0.86);
	}

	.task-row-done {
		border-style: solid;
		border-color: #b6d8c2;
		background: #eff9f2;
	}

	.task-check {
		width: 1.4rem;
		height: 1.4rem;
		margin-top: 0.06rem;
		border-radius: 0.2rem;
		border: 1.5px solid #acbbc9;
		accent-color: var(--marker-green);
		flex-shrink: 0;
	}

	.task-copy {
		font-size: 0.9rem;
		line-height: 1.28;
		color: var(--marker-black);
	}

	.task-by {
		margin-left: auto;
		font-size: 0.66rem;
		color: #7a8794;
		white-space: nowrap;
		align-self: center;
	}

	@media (min-width: 760px) {
		.cleaning-hero {
			grid-template-columns: minmax(0, 1fr) 12rem;
			align-items: center;
			padding: 0.95rem;
		}

		.cleaning-title {
			font-size: 1.58rem;
		}

		.shift-picker {
			grid-template-columns: 1fr 1fr;
			align-self: stretch;
		}

		.shift-pill,
		.sunday-toggle-btn {
			min-height: 2.2rem;
		}

		.sunday-toggle-inner {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: 0.8rem;
		}

		.checklist-sheet {
			padding: 0.92rem 0.9rem;
		}

		.task-copy {
			font-size: 0.9rem;
		}
	}
</style>
