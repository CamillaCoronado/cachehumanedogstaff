<script lang="ts">
	import { format, startOfDay } from 'date-fns';
	import { addFeedingLog, endDayTrip, listAllDayTripLogs, listDogs, listFeedingLogs, updateDog } from '$lib/data/dogs';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { daysSince, isSameCalendarDay, toDate } from '$lib/utils/dates';
	import { readJson, writeJson } from '$lib/utils/storage';
	import type { DayTripLog, Dog, FeedingLog, MealTime } from '$lib/types';

	type CleaningShift = 'morning' | 'evening';
	type TodayActionId = 'feeding' | 'cleaning' | 'movement' | 'slack';
	type ActionBusyMap = Record<TodayActionId, boolean>;

	interface CompletionRecord {
		id: string;
		date: string;
		shift: CleaningShift;
		completedTaskIds: string[];
		lastUpdated: string;
	}

	interface TodayAction {
		id: TodayActionId;
		label: string;
		done: boolean;
		checklistHref?: string;
	}

	const CLEANING_COMPLETIONS_KEY = 'shelter.cleaningCompletions.v1';
	const today = startOfDay(new Date());

	let loading = true;
	let errorMessage = '';
	let shift: MealTime = new Date().getHours() < 12 ? 'am' : 'pm';
	let cleaningShift: CleaningShift = shift === 'am' ? 'morning' : 'evening';

	let activeDogs: Dog[] = [];
	let dayTripLogs: DayTripLog[] = [];
	let feedingLogsByDog: Record<string, FeedingLog[]> = {};
	let cleaningCompletions: Record<string, CompletionRecord> = {};
	let todayItems: TodayAction[] = [];
	let returningDogIds = new Set<string>();
	let fosterUpdatingDogIds = new Set<string>();
	let boardLoaded = false;
	let actionBusy: ActionBusyMap = {
		feeding: false,
		cleaning: false,
		movement: false,
		slack: false
	};

	$: {
		const canLoad = !firebaseEnabled || ($authReady && Boolean($authUser));
		if (canLoad && !boardLoaded) {
			boardLoaded = true;
			void loadBoard();
		}
	}

	$: todayKey = format(today, 'yyyy-MM-dd');
	$: cleaningShift = shift === 'am' ? 'morning' : 'evening';
	$: completion = cleaningCompletions[`${todayKey}-${cleaningShift}`];
	$: completedTaskIds = new Set(completion?.completedTaskIds ?? []);
	$: openTripByDog = buildOpenTripMap(dayTripLogs);

	$: dogsOut = activeDogs
		.filter((dog) => dog.isOutOnDayTrip)
		.sort((a, b) => {
			const first = tripStartForDog(a)?.getTime() ?? 0;
			const second = tripStartForDog(b)?.getTime() ?? 0;
			return first - second;
		});

	$: managerOnlyDogs = activeDogs
		.filter(
			(dog) =>
				dog.dayTripManagerOnly === true &&
				dog.isolationStatus === 'none' &&
				dog.isOutOnDayTrip === false
		)
		.slice(0, 4);

	$: isolationDogs = activeDogs
		.filter((dog) => dog.isolationStatus !== 'none')
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 4);
	$: fosterDogs = activeDogs.filter((dog) => dog.inFoster).sort((a, b) => a.name.localeCompare(b.name));

	$: surgeryAlerts = activeDogs
		.filter((dog) => isSameCalendarDay(dog.surgeryDate, today))
		.sort((a, b) => a.name.localeCompare(b.name));

	$: feedingTargets = activeDogs.filter((dog) => !isSameCalendarDay(dog.surgeryDate, today));
	$: feedingDone =
		feedingTargets.length > 0 && feedingTargets.every((dog) => hasFeedingLogForShift(dog.id, shift));
	$: cleaningDone = hasAnyTask(
		shift === 'am'
			? ['am-cleaner-clean-kennels', 'am-shared-scrub-kennels']
			: ['pm-cleaner-hose-sanitize', 'pm-shared-scrub-kennels']
	);
	$: movementDone =
		shift === 'am'
			? hasAnyTask(['am-shared-take-dogs-out'])
			: dogsOut.length === 0 || hasAnyTask(['pm-cleaner-bring-dogs-in', 'pm-shared-bring-dogs-in']);
	$: slackDone = Array.from(completedTaskIds).some((taskId) => taskId.includes('slack'));
	$: todayItems =
		shift === 'am'
			? [
					{ id: 'feeding', label: 'feeding (am)', done: feedingDone },
					{ id: 'cleaning', label: 'cleaning (am)', done: cleaningDone, checklistHref: '/cleaning' },
					{ id: 'movement', label: 'dogs out', done: movementDone },
					{ id: 'slack', label: 'slack update (am)', done: slackDone }
				]
			: [
					{ id: 'feeding', label: 'feeding (pm)', done: feedingDone },
					{ id: 'cleaning', label: 'cleaning (pm)', done: cleaningDone, checklistHref: '/cleaning' },
					{ id: 'movement', label: 'bring dogs in @ 4:15', done: movementDone },
					{ id: 'slack', label: 'slack update (pm)', done: slackDone }
				];
	$: needsAttention = buildNeedsAttention().slice(0, 4);

	function buildOpenTripMap(logs: DayTripLog[]) {
		return logs.reduce<Record<string, DayTripLog>>((map, log) => {
			if (log.endedAt) return map;
			const existing = map[log.dogId];
			const started = toDate(log.startedAt)?.getTime() ?? 0;
			const existingStarted = toDate(existing?.startedAt)?.getTime() ?? 0;
			if (!existing || started > existingStarted) {
				map[log.dogId] = log;
			}
			return map;
		}, {});
	}

	function tripStartForDog(dog: Dog) {
		const openTrip = openTripByDog[dog.id];
		return toDate(openTrip?.startedAt) ?? toDate(dog.currentDayTripStartedAt);
	}

	function hasFeedingLogForShift(dogId: string, mealTime: MealTime) {
		const logs = feedingLogsByDog[dogId] ?? [];
		return logs.some((log) => log.mealTime === mealTime && isSameCalendarDay(log.date, today));
	}

	function hasAnyTask(taskIds: string[]) {
		return taskIds.some((taskId) => completedTaskIds.has(taskId));
	}

	function formatOutLine(dog: Dog) {
		const startedAt = tripStartForDog(dog);
		const dob = toDate(dog.dateOfBirth);
		const ageYears = dob
			? Math.max(0, Math.floor((today.getTime() - startOfDay(dob).getTime()) / 31_557_600_000))
			: null;
		const ageTag = ageYears !== null ? ` (${ageYears})` : '';
		const timeTag = startedAt ? format(startedAt, 'h:mma').toLowerCase() : 'unknown';
		return `${dog.name.toLowerCase()}${ageTag} - ${timeTag}`;
	}

	function isolationLabel(dog: Dog) {
		if (dog.isolationStatus === 'sick') return 'sick';
		if (dog.isolationStatus === 'bite_quarantine') return 'bite quarantine';
		return 'isolation';
	}

	function surgeryDateLabel(dog: Dog) {
		const date = toDate(dog.surgeryDate);
		return date ? format(date, 'M/d') : 'today';
	}

	function dayGapLabel(days: number) {
		if (days >= 14) {
			const weeks = Math.round(days / 7);
			return `${weeks} wk${weeks === 1 ? '' : 's'}`;
		}
		return `${days} day${days === 1 ? '' : 's'}`;
	}

	function buildNeedsAttention() {
		const lines: string[] = [];

		const bathDue = activeDogs
			.map((dog) => ({ dog, days: daysSince(dog.lastBathDate, today) }))
			.filter((entry) => entry.days !== null && entry.days >= 6)
			.sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

		for (const entry of bathDue.slice(0, 2)) {
			lines.push(`${entry.dog.name.toLowerCase()} - bath ${entry.days} days`);
		}

		const tripDue = activeDogs
			.filter((dog) => !dog.isOutOnDayTrip)
			.map((dog) => ({ dog, days: daysSince(dog.lastDayTripDate, today) }))
			.filter((entry) => entry.days !== null && entry.days >= 14)
			.sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

		for (const entry of tripDue.slice(0, 2)) {
			lines.push(`${entry.dog.name.toLowerCase()} - day trip ${dayGapLabel(entry.days ?? 0)}`);
		}

		return lines;
	}

	function actionPending(id: TodayActionId) {
		return actionBusy[id];
	}

	function setActionBusy(id: TodayActionId, isBusy: boolean) {
		actionBusy = { ...actionBusy, [id]: isBusy };
	}

	function setDogReturning(dogId: string, isReturning: boolean) {
		const next = new Set(returningDogIds);
		if (isReturning) next.add(dogId);
		else next.delete(dogId);
		returningDogIds = next;
	}

	function setFosterUpdating(dogId: string, isUpdating: boolean) {
		const next = new Set(fosterUpdatingDogIds);
		if (isUpdating) next.add(dogId);
		else next.delete(dogId);
		fosterUpdatingDogIds = next;
	}

	function completionRecordId() {
		return `${todayKey}-${cleaningShift}`;
	}

	function toggleCompletionTask(taskId: string, shouldComplete: boolean) {
		const key = completionRecordId();
		const current = cleaningCompletions[key] ?? {
			id: key,
			date: todayKey,
			shift: cleaningShift,
			completedTaskIds: [],
			lastUpdated: new Date().toISOString()
		};
		const set = new Set(current.completedTaskIds);
		if (shouldComplete) set.add(taskId);
		else set.delete(taskId);
		const nextRecord: CompletionRecord = {
			...current,
			completedTaskIds: Array.from(set),
			lastUpdated: new Date().toISOString()
		};
		const nextMap = { ...cleaningCompletions, [key]: nextRecord };
		cleaningCompletions = nextMap;
		writeJson(CLEANING_COMPLETIONS_KEY, nextMap);
	}

	function primaryCleaningTaskId() {
		return shift === 'am' ? 'am-cleaner-clean-kennels' : 'pm-cleaner-hose-sanitize';
	}

	function primaryMovementTaskId() {
		return shift === 'am' ? 'am-shared-take-dogs-out' : 'pm-cleaner-bring-dogs-in';
	}

	function primarySlackTaskId() {
		return shift === 'am' ? 'am-cleaner-slack' : 'pm-cleaner-slack';
	}

	async function markFeedingComplete() {
		const targets = feedingTargets.filter((dog) => !hasFeedingLogForShift(dog.id, shift));
		await Promise.all(
			targets.map((dog) =>
				addFeedingLog(
					dog.id,
					{
						date: today,
						mealTime: shift,
						amountEaten: 'all',
						notes: 'Logged from dashboard'
					},
					$authProfile
				)
			)
		);
	}

	async function markAllDogsBackIn() {
		const targets = [...dogsOut];
		await Promise.all(targets.map((dog) => endDayTrip(dog.id, $authProfile, 'Returned from dashboard')));
	}

	async function handleMarkBackIn(dog: Dog) {
		if (returningDogIds.has(dog.id)) return;
		setDogReturning(dog.id, true);
		errorMessage = '';
		try {
			await endDayTrip(dog.id, $authProfile, 'Returned from dashboard');
			await loadBoard();
		} catch (error) {
			console.error(error);
			errorMessage = 'Unable to mark dog back in.';
		} finally {
			setDogReturning(dog.id, false);
		}
	}

	async function handleMarkInShelterFromFoster(dog: Dog) {
		if (fosterUpdatingDogIds.has(dog.id)) return;
		setFosterUpdating(dog.id, true);
		errorMessage = '';
		try {
			await updateDog(dog.id, { inFoster: false });
			await loadBoard();
		} catch (error) {
			console.error(error);
			errorMessage = 'Unable to update foster status.';
		} finally {
			setFosterUpdating(dog.id, false);
		}
	}

	async function handleTodayAction(actionId: TodayActionId) {
		if (actionPending(actionId)) return;
		setActionBusy(actionId, true);
		errorMessage = '';
		try {
			if (actionId === 'feeding') {
				if (!feedingDone) {
					await markFeedingComplete();
					await loadBoard();
				}
				return;
			}

			if (actionId === 'cleaning') {
				toggleCompletionTask(primaryCleaningTaskId(), !cleaningDone);
				return;
			}

			if (actionId === 'movement') {
				if (shift === 'pm' && dogsOut.length > 0) {
					await markAllDogsBackIn();
					await loadBoard();
				} else {
					toggleCompletionTask(primaryMovementTaskId(), !movementDone);
				}
				return;
			}

			if (actionId === 'slack') {
				toggleCompletionTask(primarySlackTaskId(), !slackDone);
			}
		} catch (error) {
			console.error(error);
			errorMessage = 'Unable to complete that action.';
		} finally {
			setActionBusy(actionId, false);
		}
	}

	async function loadBoard() {
		loading = true;
		errorMessage = '';
		try {
			const dogs = await listDogs();
			const active = dogs
				.filter((dog) => dog.status === 'active')
				.sort((a, b) => a.name.localeCompare(b.name));

			const [tripLogs, feedingEntries] = await Promise.all([
				listAllDayTripLogs(),
				Promise.all(active.map(async (dog) => [dog.id, await listFeedingLogs(dog.id)] as const))
			]);

			activeDogs = active;
			dayTripLogs = tripLogs;
			feedingLogsByDog = Object.fromEntries(feedingEntries);
			cleaningCompletions = readJson<Record<string, CompletionRecord>>(CLEANING_COMPLETIONS_KEY, {});
		} catch (error) {
			console.error(error);
			const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
			errorMessage = code
				? `Unable to load live dashboard data (${code}).`
				: 'Unable to load live dashboard data.';
		} finally {
			loading = false;
		}
	}
</script>

<section class="marker-dashboard" aria-label="Dashboard board">
	<div class="board-grid">
		<header class="title-strip">
			<h1 class="board-title marker-black">DASHBOARD</h1>
			<div class="magnet-group" aria-label="Shift toggle">
				<button
					type="button"
					class="shift-magnet permanent-marker marker-black"
					aria-pressed={shift === 'am'}
					on:click={() => (shift = 'am')}
				>
					[AM]
				</button>
				<button
					type="button"
					class="shift-magnet permanent-marker marker-black"
					aria-pressed={shift === 'pm'}
					on:click={() => (shift = 'pm')}
				>
					[PM]
				</button>
			</div>
		</header>

		{#if errorMessage}
			<p class="status-line marker-line marker-red-line">{errorMessage}</p>
		{/if}

		<div class="grid-row">
			<section class="zone zone-today">
				<h2 class="section-heading marker-black">today</h2>
				<div class="today-action-list">
					{#each todayItems as item}
						<div class="today-action-row">
							<button
								type="button"
								class={`today-action ${item.done ? 'today-action-done' : ''}`}
								on:click={() => handleTodayAction(item.id)}
								disabled={actionPending(item.id)}
								aria-pressed={item.done}
							>
								<span class="today-check">{item.done ? '☑' : '☐'}</span>
								<span class="today-label">{item.label}</span>
								<span class="today-hint typewriter">
									{#if actionPending(item.id)}
										saving...
									{:else if item.done}
										done
									{:else}
										mark done
									{/if}
								</span>
							</button>
							{#if item.checklistHref}
								<a class="today-checklist-link typewriter" href={item.checklistHref}>see checklist</a>
							{/if}
						</div>
					{/each}
				</div>
			</section>
			<section class="zone zone-dogs-out">
				<h2 class="section-heading marker-black">day trips</h2>
				<div class="zone-list">
					{#if loading}
						<p class="marker-line marker-red-line marker-muted">loading...</p>
					{:else if dogsOut.length === 0}
						<p class="marker-line marker-red-line marker-muted">none out</p>
					{:else}
						{#each dogsOut as dog}
							<div class="trip-row">
								<p class="trip-label typewriter">{formatOutLine(dog)}</p>
								<button
									type="button"
									class="trip-back-btn typewriter"
									on:click={() => handleMarkBackIn(dog)}
									disabled={returningDogIds.has(dog.id)}
								>
									{returningDogIds.has(dog.id) ? 'saving...' : 'back in'}
								</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>
		</div>

		<div class="grid-row">
			<section class="zone zone-manager">
				<h2 class="section-heading marker-black">manager only</h2>
				<div class="zone-list">
					{#if loading}
						<p class="marker-line marker-purple-line marker-muted">loading...</p>
					{:else if managerOnlyDogs.length === 0}
						<p class="marker-line marker-purple-line marker-muted">none</p>
					{:else}
						{#each managerOnlyDogs as dog}
							<p class="marker-line marker-purple-line">{dog.name.toLowerCase()}</p>
						{/each}
					{/if}
				</div>
			</section>
			<section class="zone zone-iso">
				<h2 class="section-heading marker-black">iso</h2>
				<div class="zone-list">
					{#if loading}
						<p class="marker-line marker-blue-line marker-muted">loading...</p>
					{:else if isolationDogs.length === 0}
						<p class="marker-line marker-blue-line marker-muted">none</p>
					{:else}
						{#each isolationDogs as dog}
							<p class="marker-line marker-blue-line">{dog.name.toLowerCase()} ({isolationLabel(dog)})</p>
						{/each}
					{/if}
				</div>
			</section>
		</div>

		<section class="zone zone-wide zone-foster">
			<h2 class="section-heading marker-black">Foster</h2>
			<div class="zone-list">
				{#if loading}
					<p class="marker-line marker-muted">loading...</p>
				{:else if fosterDogs.length === 0}
					<p class="marker-line marker-muted">none in foster</p>
				{:else}
					{#each fosterDogs as dog}
						<div class="foster-row">
							<p class="foster-label typewriter">{dog.name.toLowerCase()}</p>
							<button
								type="button"
								class="foster-back-btn typewriter"
								on:click={() => handleMarkInShelterFromFoster(dog)}
								disabled={fosterUpdatingDogIds.has(dog.id)}
							>
								{fosterUpdatingDogIds.has(dog.id) ? 'saving...' : 'in shelter'}
							</button>
						</div>
					{/each}
				{/if}
			</div>
		</section>

		<section class="zone zone-wide zone-needs-attention zone-needs">
			<h2 class="section-heading marker-black">needs attention</h2>
			<div class="zone-list">
				{#if loading}
					<p class="marker-line marker-orange-line marker-muted">loading...</p>
				{:else if needsAttention.length === 0}
					<p class="marker-line marker-orange-line marker-muted">none right now</p>
				{:else}
					{#each needsAttention as line}
						<p class="marker-line marker-orange-line">{line}</p>
					{/each}
				{/if}
			</div>
		</section>

		{#if surgeryAlerts.length > 0}
			<aside class="sticky-note" aria-label="Do not feed">
				<p class="sticky-heading">🚫 DO NOT FEED</p>
				{#each surgeryAlerts as dog}
					<p class="sticky-line whiteboard-hand">{dog.name.toLowerCase()} - surgery {surgeryDateLabel(dog)}</p>
				{/each}
			</aside>
		{/if}
	</div>
</section>

<style>
	.marker-dashboard {
		position: relative;
		width: 100%;
		max-width: 100vw;
		min-width: 0;
		--ink-red-soft: #b8423c;
		--ink-purple-soft: #7656a8;
		--ink-blue-soft: #2f79b6;
		--ink-green-soft: #23845a;
		--ink-orange-soft: #b76e28;
		--ink-foster-soft: #7d6240;
		--zone-red-soft: rgba(184, 66, 60, 0.045);
		--zone-purple-soft: rgba(118, 86, 168, 0.05);
		--zone-blue-soft: rgba(47, 121, 182, 0.055);
		--zone-green-soft: rgba(35, 132, 90, 0.075);
		--zone-orange-soft: rgba(183, 110, 40, 0.06);
		--zone-foster-soft: rgba(125, 98, 64, 0.07);
		--marker-muted-ink: #667388;
	}

	.board-grid {
		position: relative;
		border: 4px solid var(--marker-black);
		background: rgba(255, 255, 255, 0.88);
		overflow: visible;
		width: 100%;
		max-width: 100%;
		min-width: 0;
	}

	.title-strip {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.9rem;
		padding: 0.85rem 0.8rem 0.8rem;
		border-bottom: 4px solid var(--marker-black);
		min-width: 0;
	}

	.board-title {
		margin: 0;
		font-family: var(--font-printed);
		font-weight: 400;
		text-transform: uppercase;
		font-size: clamp(2.15rem, 8.4vw, 3rem);
		line-height: 0.98;
		letter-spacing: 0.07em;
		text-shadow: none;
	}

	.magnet-group {
		display: inline-grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem;
		width: clamp(7.6rem, 39vw, 9.4rem);
		flex-shrink: 0;
	}

	.shift-magnet {
		min-height: 2.35rem;
		border: 2px solid #20242c;
		border-radius: 0.36rem;
		background: linear-gradient(170deg, #f6f7f9 0%, #d8dee8 100%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.8),
			0 1.5px 0 rgba(0, 0, 0, 0.38);
		font-size: 1.08rem;
		line-height: 1;
		padding-top: 0.1rem;
	}

	.shift-magnet[aria-pressed='true'] {
		background: linear-gradient(170deg, #e4f7e8 0%, #b5e5bf 100%);
	}

	.status-line {
		padding: 0.7rem 0.8rem;
	}

	.grid-row {
		display: grid;
		grid-template-columns: 1fr;
		border-top: 4px solid var(--marker-black);
	}

	.zone {
		display: grid;
		align-content: start;
		gap: 0.46rem;
		padding: 0.86rem 0.8rem 0.8rem;
	}

	.grid-row .zone + .zone {
		border-top: 4px solid var(--marker-black);
	}

	.zone-wide {
		border-top: 4px solid var(--marker-black);
	}

	.section-heading {
		margin: 0;
		font-family: var(--font-printed);
		font-weight: 400;
		text-transform: uppercase;
		font-size: clamp(1.35rem, 6.1vw, 1.95rem);
		line-height: 1.02;
		letter-spacing: 0.06em;
		text-shadow: none;
	}

	.section-heading::after {
		content: '';
		display: block;
		width: 2.4rem;
		height: 3px;
		margin-top: 0.26rem;
		background: var(--marker-black);
		border-radius: 999px;
	}

	.zone-list {
		margin-top: 0;
		display: grid;
		gap: 0.28rem;
	}

	.today-action-list {
		display: grid;
		gap: 0.36rem;
	}

	.today-action-row {
		display: grid;
		gap: 0.24rem;
	}

	.today-action {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.48rem;
		padding: 0.36rem 0.44rem;
		border: 2px solid rgba(35, 132, 90, 0.36);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.8);
		color: var(--ink-green-soft);
		text-align: left;
	}

	.today-action:disabled {
		opacity: 0.78;
	}

	.today-action-done {
		background: rgba(35, 132, 90, 0.16);
		border-color: rgba(35, 132, 90, 0.55);
	}

	.today-check {
		font-family: var(--font-marker);
		font-size: 1.38rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.today-label {
		font-family: var(--font-marker);
		font-size: clamp(1.06rem, 4.6vw, 1.35rem);
		font-weight: 700;
		line-height: 1.14;
	}

	.today-hint {
		margin-left: auto;
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(35, 87, 62, 0.86);
	}

	.today-checklist-link {
		justify-self: end;
		font-size: 0.55rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #355e8b;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.marker-line {
		margin: 0;
		font-family: var(--font-marker);
		font-size: clamp(1.18rem, 5.1vw, 1.6rem);
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: 0.01em;
		text-shadow:
			0.65px 0 currentColor,
			-0.55px 0 currentColor,
			0 0.52px currentColor;
	}

	.marker-muted {
		color: var(--marker-muted-ink) !important;
		opacity: 1;
		font-weight: 600;
		text-shadow: none;
	}

	.marker-red-line {
		color: var(--ink-red-soft);
	}

	.marker-purple-line {
		color: var(--ink-purple-soft);
	}

	.marker-blue-line {
		color: var(--ink-blue-soft);
	}

	.marker-green-line {
		color: var(--ink-green-soft);
	}

	.marker-orange-line {
		color: var(--ink-orange-soft);
	}

	.zone-dogs-out {
		background: linear-gradient(180deg, var(--zone-red-soft) 0%, rgba(255, 255, 255, 0) 74%);
	}

	.trip-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.44rem;
		align-items: center;
		padding: 0.34rem 0.42rem;
		border: 2px solid rgba(184, 66, 60, 0.34);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.83);
	}

	.trip-label {
		margin: 0;
		font-size: 0.86rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #853330;
		line-height: 1.2;
		font-weight: 700;
	}

	.trip-back-btn {
		min-height: 1.86rem;
		padding: 0.24rem 0.52rem;
		border: 2px solid rgba(133, 51, 48, 0.65);
		border-radius: 0.26rem;
		background: #fff3f2;
		color: #7a2a27;
		font-size: 0.56rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.zone-manager {
		background: linear-gradient(180deg, var(--zone-purple-soft) 0%, rgba(255, 255, 255, 0) 74%);
	}

	.zone-iso {
		background: linear-gradient(180deg, var(--zone-blue-soft) 0%, rgba(255, 255, 255, 0) 74%);
	}

	.zone-needs {
		background: linear-gradient(180deg, var(--zone-orange-soft) 0%, rgba(255, 255, 255, 0) 74%);
	}

	.zone-foster {
		background: linear-gradient(180deg, var(--zone-foster-soft) 0%, rgba(255, 255, 255, 0) 74%);
	}

	.zone-dogs-out .section-heading::after {
		background: var(--ink-red-soft);
	}

	.zone-manager .section-heading::after {
		background: var(--ink-purple-soft);
	}

	.zone-iso .section-heading::after {
		background: var(--ink-blue-soft);
	}

	.zone-needs .section-heading::after {
		background: var(--ink-orange-soft);
	}

	.zone-foster .section-heading::after {
		background: var(--ink-foster-soft);
	}

	.foster-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.44rem;
		align-items: center;
		padding: 0.34rem 0.42rem;
		border: 2px solid rgba(125, 98, 64, 0.34);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.83);
	}

	.foster-label {
		margin: 0;
		font-size: 0.86rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #6e5436;
		line-height: 1.2;
		font-weight: 700;
	}

	.foster-back-btn {
		min-height: 1.86rem;
		padding: 0.24rem 0.52rem;
		border: 2px solid rgba(110, 84, 54, 0.65);
		border-radius: 0.26rem;
		background: #fff8ef;
		color: #674727;
		font-size: 0.56rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.zone-today {
		background: linear-gradient(180deg, var(--zone-green-soft) 0%, rgba(255, 255, 255, 0) 78%);
	}

	.zone-today .section-heading::after {
		background: var(--ink-green-soft);
	}

	.sticky-note {
		position: relative;
		z-index: 3;
		width: min(16rem, calc(100% - 1.6rem));
		margin: -0.7rem 0.7rem 0.9rem auto;
		padding: 0.72rem 0.76rem 0.7rem;
		border: 2px solid rgba(52, 43, 8, 0.55);
		border-radius: 0.08rem;
		background: #ffe57b;
		box-shadow: 0 8px 13px rgba(0, 0, 0, 0.2);
		transform: rotate(-1.8deg);
	}

	.sticky-heading {
		margin: 0;
		font-family: var(--font-printed);
		text-transform: uppercase;
		font-size: clamp(1rem, 4.8vw, 1.4rem);
		font-weight: 700;
		line-height: 1.12;
		letter-spacing: 0.045em;
		color: #1f232b;
		text-shadow: none;
	}

	.sticky-line {
		margin: 0.24rem 0 0;
		font-size: clamp(0.96rem, 4.2vw, 1.2rem);
		font-weight: 700;
		line-height: 1.2;
		color: #1f232b;
	}

	@media (min-width: 840px) {
		.title-strip {
			padding: 0.95rem 0.95rem 0.88rem;
		}

		.grid-row {
			grid-template-columns: 1fr 1fr;
		}

		.grid-row .zone + .zone {
			border-top: none;
			border-left: 4px solid var(--marker-black);
		}

		.zone {
			padding: 0.95rem;
		}

		.zone-list {
			gap: 0.22rem;
		}

		.zone-needs-attention {
			padding-right: 17rem;
		}

		.sticky-note {
			position: absolute;
			top: 8.15rem;
			right: 0.85rem;
			width: 15rem;
			margin: 0;
		}
	}

	@media (max-width: 480px) {
		.title-strip {
			gap: 0.48rem;
			padding: 0.74rem 0.62rem 0.7rem;
		}

		.board-title {
			font-size: clamp(1.8rem, 8vw, 2.45rem);
			letter-spacing: 0.05em;
		}

		.magnet-group {
			width: clamp(6.6rem, 35vw, 8.2rem);
			gap: 0.24rem;
		}

		.shift-magnet {
			min-height: 2.15rem;
			font-size: 0.98rem;
		}
	}
</style>
