<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { format, startOfDay } from 'date-fns';
	import { readJson, writeJson } from '$lib/utils/storage';

	type Shift = 'morning' | 'evening';

	interface Task {
		id: string;
		description: string;
	}

	interface Section {
		title: string;
		tasks: Task[];
		note?: string;
	}

	interface CompletionRecord {
		id: string;
		date: string;
		shift: Shift;
		completedTaskIds: string[];
		lastUpdated: string;
	}

	const COMPLETIONS_KEY = 'shelter.cleaningCompletions.v1';

	const sundayMorningShared: Section = {
		title: 'Sunday AM — Shared',
		note: 'Both staff members split these responsibilities evenly so no one is doing more or less than their share.',
		tasks: [
			{ id: 'am-shared-take-dogs-out', description: 'Take all dogs outside.' },
			{
				id: 'am-shared-feed-breakfast',
				description:
					'One person feeds all the dogs their morning breakfast per diet plans; note inappetance, abnormal poops, or anything clinic should be aware of.'
			},
			{
				id: 'am-shared-pickup-inside-runs',
				description: 'One person picks up all poop, bowls, buckets, bedding, toys, etc. from inside runs.'
			},
			{
				id: 'am-shared-prep-deep-clean',
				description: 'Both staff begin prep for deep cleaning inside kennels.'
			},
			{ id: 'am-shared-soak-harnesses', description: 'Remove all harnesses and soak in a bucket of Accell.' },
			{ id: 'am-shared-remove-pins', description: 'Remove pins and clips from middle dividers of all runs.' },
			{ id: 'am-shared-remove-drain-bottoms', description: 'Remove bottoms that cover drains in all runs.' },
			{
				id: 'am-shared-move-carts',
				description: 'Move treat cart, bucket cart, table, collar display, etc. into hallways/outside.'
			},
			{
				id: 'am-shared-fill-mop-buckets',
				description: 'Fill two mop buckets with Accell and get two scrubbers ready.'
			},
			{
				id: 'am-shared-rinse-before-scrub',
				description:
					'Rinse all kennels with water before scrubbing with Accell. Staff decide which side; no one does both.'
			},
			{
				id: 'am-shared-scrub-kennels',
				description:
					'Scrub all kennels top to bottom with Accell, including white kennels along wall. Scrub walkways and 3 bricks high on walls.'
			},
			{ id: 'am-shared-rinse-after-scrub', description: 'Rinse with water again after scrubbing all kennels.' },
			{
				id: 'am-shared-reassemble-kennels',
				description:
					'Squeegee as normal and put kennels back together with covers over drains and all pins reclipped. Towel dry all cots.'
			},
			{ id: 'am-shared-replace-accell-bin', description: 'Replace the Accell in the poop scooper bin.' },
			{ id: 'am-shared-hang-harnesses', description: 'Hang soaked harnesses up to dry.' },
			{
				id: 'am-shared-setup-inside',
				description: 'Set up inside kennels with new water buckets, blankets, and toys as needed.'
			},
			{ id: 'am-shared-bring-dogs-in', description: 'Bring dogs in.' },
			{ id: 'am-shared-pickup-breakfast', description: 'Pick up poop and bowls from breakfast.' },
			{ id: 'am-shared-trash', description: 'Throw trash away.' },
			{ id: 'am-shared-dishes', description: 'Do dishes.' },
			{ id: 'am-shared-laundry', description: 'Rotate laundry.' }
		]
	};

	const baseMorningSections: Section[] = [
		{
			title: 'AM Cleaner Checklist',
			tasks: [
				{
					id: 'am-cleaner-pickup-inside',
					description: 'Pick up all poop, soiled bedding, buckets, bowls, and toys from inside kennels.'
				},
				{
					id: 'am-cleaner-clean-kennels',
					description: 'Clean all inside kennels according to current protocol.'
				},
				{
					id: 'am-cleaner-drain-accell',
					description: 'Clear the drain and refill the Accell bucket.'
				},
				{
					id: 'am-cleaner-sanitize-gear',
					description: 'Sanitize and hang leashes, collars, and harnesses from the dirty leash bucket.'
				},
				{
					id: 'am-cleaner-wash-dishes',
					description: 'Wash all dishes collected from inside kennels.'
				},
				{ id: 'am-cleaner-slack', description: 'Make a Slack update.' },
				{ id: 'am-cleaner-playtimes', description: 'Begin playtimes and baths.' }
			]
		},
		{
			title: 'AM Feeder Checklist',
			tasks: [
				{ id: 'am-feeder-feed', description: 'Feed all dogs according to diet plans.' },
				{
					id: 'am-feeder-note-clinic',
					description: "Note dogs that didn't eat, vomited, or had diarrhea. Refer to clinic as needed."
				},
				{
					id: 'am-feeder-water-buckets',
					description: 'Fill and pass out water buckets to all dogs; clip buckets in outside kennels if possible.'
				},
				{
					id: 'am-feeder-pickup-poop',
					description: 'Pick up all poop unless clinic needs to assess it, and throw the trash away.'
				},
				{
					id: 'am-feeder-pickup-dishes',
					description: 'Pick up all dishes from breakfast and wash them.'
				},
				{ id: 'am-feeder-laundry', description: 'Turn over the laundry.' },
				{ id: 'am-feeder-slack', description: 'Make a Slack update.' },
				{ id: 'am-feeder-playtimes', description: 'Begin playtimes and baths.' }
			]
		}
	];

	const sundayEveningShared: Section = {
		title: 'Sunday PM — Shared',
		tasks: [
			{ id: 'pm-shared-take-dogs-out', description: 'Take all dogs outside.' },
			{
				id: 'pm-shared-spot-clean',
				description:
					'One person spot cleans inside, refilling/dumping water buckets and replacing bedding as needed. Also pick up any bowls from breakfast brought inside.'
			},
			{
				id: 'pm-shared-feed-dinner',
				description:
					'One person feeds all dogs dinner per diet plans; note inappetance, strange poop, or anything clinic should be aware of.'
			},
			{
				id: 'pm-shared-laundry-dishes',
				description: 'Laundry should be turned over and dishes done at this time; tasks can be split.'
			},
			{ id: 'pm-shared-bring-dogs-in', description: 'At ~4:30, bring dogs inside.' },
			{ id: 'pm-shared-prep-accell', description: 'One person preps an Accell bucket for scrubbing.' },
			{
				id: 'pm-shared-pickup-poop-outside',
				description: 'One person picks up poop outside; throw away trash and take poop wagon to dumpster.'
			},
			{
				id: 'pm-shared-rinse-kennels',
				description:
					'Kennels should be rinsed with water before scrubbing with Accell (skip if winter/too cold overnight).'
			},
			{
				id: 'pm-shared-scrub-kennels',
				description:
					'Both staff scrub floors of all kennels, or only those needed in winter to mitigate freezing.'
			},
			{
				id: 'pm-shared-pickup-outside',
				description:
					'Pick up everything from outside: buckets, bowls, toys, leashes, collars, blankets, towels, beds, etc.'
			},
			{
				id: 'pm-shared-scrub-cots',
				description:
					'Scrub all cots and hang to dry (also helps prevent snow buildup in winter).'
			},
			{
				id: 'pm-shared-yard-check',
				description: 'If time, check yards and pick up poop, toys, buckets, and tidy.'
			}
		]
	};

	const baseEveningSections: Section[] = [
		{
			title: 'PM Cleaner Checklist',
			tasks: [
				{
					id: 'pm-cleaner-setup-inside',
					description: 'Set up all inside runs with buckets, blankets, and toys.'
				},
				{
					id: 'pm-cleaner-put-away-gear',
					description: 'Put away collars, leashes, and harnesses hanging up to dry.'
				},
				{
					id: 'pm-cleaner-help-playtimes',
					description: 'Help with playtimes and baths if any are leftover from AM shift.'
				},
				{ id: 'pm-cleaner-bring-dogs-in', description: 'Help bring dogs in at 4:15.' },
				{
					id: 'pm-cleaner-pickup-outside',
					description:
						'Pick up poop in outside kennels; dump and pick up buckets; throw away trash.'
				},
				{ id: 'pm-cleaner-hose-sanitize', description: 'Hose off and sanitize outside kennels.' },
				{
					id: 'pm-cleaner-check-gates',
					description:
						'Double check all gates outside, lock doors, and make sure all dogs inside have water.'
				},
				{ id: 'pm-cleaner-music-lights', description: 'Turn on music and turn off all lights.' },
				{ id: 'pm-cleaner-board', description: 'Reset the dog walking board.' },
				{ id: 'pm-cleaner-slack', description: 'Make a Slack update.' }
			]
		},
		{
			title: 'PM Feeder Checklist',
			tasks: [
				{
					id: 'pm-feeder-playtimes',
					description: 'Continue playtimes and baths from AM if any are leftover.'
				},
				{ id: 'pm-feeder-meet-greets', description: 'Do meet n greets as needed.' },
				{
					id: 'pm-feeder-feed-dinner',
					description: 'Feed all dogs according to diet plans at 3:00.'
				},
				{
					id: 'pm-feeder-dishes',
					description: 'Pick up bowls from dinner and wash them; drain the dishwasher after.'
				},
				{ id: 'pm-feeder-laundry', description: 'Turn over the laundry.' },
				{ id: 'pm-feeder-freya', description: 'Feed Freya and clean her litter box.' },
				{ id: 'pm-feeder-slack', description: 'Make a Slack update.' }
			]
		}
	];

	const today = startOfDay(new Date());
	const dateKey = format(today, 'yyyy-MM-dd');
	const dayName = format(today, 'EEEE');
	const isSunday = dayName.toLowerCase() === 'sunday';
	const defaultShift: Shift = new Date().getHours() < 12 ? 'morning' : 'evening';

	let shift: Shift = defaultShift;
	let showSundayOverride = false;
	let completed = new Set<string>();
	let lastUpdated = '';

	onMount(() => {
		loadCompletion();
	});

	$: showSunday = isSunday || showSundayOverride;
	$: baseSections = shift === 'morning' ? baseMorningSections : baseEveningSections;
	$: sundayShared = shift === 'morning' ? sundayMorningShared : sundayEveningShared;
	$: sections = showSunday ? [sundayShared, ...baseSections] : baseSections;
	$: allTaskIds = sections.flatMap((section) => section.tasks.map((task) => task.id));
	$: completedCount = allTaskIds.filter((id) => completed.has(id)).length;

	function completionId(activeShift: Shift) {
		return `${dateKey}-${activeShift}`;
	}

	function loadCompletion() {
		if (!browser) return;
		const stored = readJson<Record<string, CompletionRecord>>(COMPLETIONS_KEY, {});
		const record = stored[completionId(shift)];
		if (record) {
			completed = new Set(record.completedTaskIds);
			lastUpdated = record.lastUpdated;
		} else {
			completed = new Set();
			lastUpdated = '';
		}
	}

	function saveCompletion() {
		if (!browser) return;
		const stored = readJson<Record<string, CompletionRecord>>(COMPLETIONS_KEY, {});
		const record: CompletionRecord = {
			id: completionId(shift),
			date: dateKey,
			shift,
			completedTaskIds: Array.from(completed),
			lastUpdated: new Date().toISOString()
		};
		stored[record.id] = record;
		writeJson(COMPLETIONS_KEY, stored);
		lastUpdated = record.lastUpdated;
	}

	function toggleTask(taskId: string) {
		if (completed.has(taskId)) {
			completed.delete(taskId);
		} else {
			completed.add(taskId);
		}
		completed = new Set(completed);
		saveCompletion();
	}

	function setShift(value: Shift) {
		shift = value;
		loadCompletion();
	}
</script>

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

		{#if !isSunday}
			<div class="sunday-toggle">
				<div class="sunday-toggle-inner">
					<p class="sunday-copy whiteboard-hand">
						Sunday shared checklist is hidden today. Toggle to preview it on other days.
					</p>
					<button
						class={`sunday-toggle-btn ${showSundayOverride ? 'sunday-toggle-btn-active' : ''}`}
						type="button"
						on:click={() => (showSundayOverride = !showSundayOverride)}
					>
						{showSundayOverride ? 'Hide Sunday Shared' : 'Show Sunday Shared'}
					</button>
				</div>
			</div>
		{/if}

		<div class="checklist-sections">
			{#each sections as section}
				<div class="checklist-sheet">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h3 class="section-title typewriter">{section.title}</h3>
							{#if section.note}
								<p class="section-note whiteboard-hand">{section.note}</p>
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
								<span class="task-copy">{task.description}</span>
							</label>
						{/each}
					</div>
				</div>
			{/each}
		</div>
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
