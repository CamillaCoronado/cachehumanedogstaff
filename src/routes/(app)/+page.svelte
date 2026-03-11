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
	const weatherLabel = '☁ 80°';

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
	$: dashboardTimestamp = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	}).format(new Date());
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
				(dog.dayTripManagerOnly === true || dog.handlingLevel === 'manager_only') &&
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
					{ id: 'feeding', label: 'Feeding (AM)', done: feedingDone },
					{ id: 'cleaning', label: 'Cleaning (AM)', done: cleaningDone, checklistHref: '/cleaning' },
					{ id: 'movement', label: 'Dogs Out', done: movementDone },
					{ id: 'slack', label: 'Slack Update (AM)', done: slackDone }
				]
			: [
					{ id: 'feeding', label: 'Feeding (PM)', done: feedingDone },
					{ id: 'cleaning', label: 'Cleaning (PM)', done: cleaningDone, checklistHref: '/cleaning' },
					{ id: 'movement', label: 'Bring Dogs In @ 4:15', done: movementDone },
					{ id: 'slack', label: 'Slack Update (PM)', done: slackDone }
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
		return `${dog.name}${ageTag} - ${timeTag}`;
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

	function todayItemBullet(id: TodayActionId) {
		if (id === 'feeding') return '🥣';
		if (id === 'cleaning') return '🧽';
		if (id === 'movement') return shift === 'am' ? '🚶' : '🚪';
		return '💬';
	}

	function isolationBullet(dog: Dog) {
		if (dog.isolationStatus === 'sick') return '🩺';
		if (dog.isolationStatus === 'bite_quarantine') return '⚠';
		return '•';
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
			lines.push(`${entry.dog.name} - bath ${entry.days} days`);
		}

		const tripDue = activeDogs
			.filter((dog) => !dog.isOutOnDayTrip)
			.map((dog) => ({ dog, days: daysSince(dog.lastDayTripDate, today) }))
			.filter((entry) => entry.days !== null && entry.days >= 14)
			.sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

		for (const entry of tripDue.slice(0, 2)) {
			lines.push(`${entry.dog.name} - day trip ${dayGapLabel(entry.days ?? 0)}`);
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

<section class="planner-dashboard" aria-label="Operations dashboard">
	<header class="planner-head">
		<p class="planner-datestamp">
			{dashboardTimestamp}
			<span class="planner-weather">{weatherLabel}</span>
		</p>
		<div class="planner-controls" aria-label="Dashboard controls">
			<button type="button" class="planner-control planner-control-label">Filter</button>
			<button
				type="button"
				class="planner-control planner-control-arrow"
				on:click={() => (shift = 'am')}
				aria-label="Show AM shift"
			>
				‹
			</button>
			<button
				type="button"
				class="planner-control planner-control-today"
				on:click={() => (shift = new Date().getHours() < 12 ? 'am' : 'pm')}
			>
				Today
			</button>
			<button
				type="button"
				class="planner-control planner-control-arrow"
				on:click={() => (shift = 'pm')}
				aria-label="Show PM shift"
			>
				›
			</button>
		</div>
	</header>

	{#if errorMessage}
		<p class="planner-error">{errorMessage}</p>
	{/if}

	<div class="planner-columns">
		<section class="planner-list planner-list-sand">
			<div class="planner-list-head">
				<h2>Today</h2>
				<span class="planner-pill planner-pill-sand">{todayItems.length}</span>
			</div>
			<div class="planner-items">
				{#each todayItems as item}
					<div class="planner-row-wrap">
						<button
							type="button"
							class={`planner-row planner-row-click ${item.done ? 'planner-row-done' : ''}`}
							on:click={() => handleTodayAction(item.id)}
							disabled={actionPending(item.id)}
							aria-pressed={item.done}
						>
							<span class="planner-row-main">
								<span class="planner-bullet">{todayItemBullet(item.id)}</span>
								<span class="planner-row-text">{item.label}</span>
							</span>
							<span class={`planner-checkbox ${item.done ? 'planner-checkbox-checked' : ''}`}>
								{#if actionPending(item.id)}
									…
								{:else if item.done}
									✓
								{/if}
							</span>
						</button>
						{#if item.checklistHref}
							<a class="planner-inline-link" href={item.checklistHref}>Open checklist</a>
						{/if}
					</div>
				{/each}
			</div>
			<button type="button" class="planner-add-row">
				<span>Add section</span>
				<span class="planner-add-icons" aria-hidden="true">
					<span class="planner-add-dot">+</span>
					<span class="planner-add-caret">⌃</span>
				</span>
			</button>
		</section>

		<section class="planner-list planner-list-rose">
			<div class="planner-list-head">
				<h2>Day Trips</h2>
				<span class="planner-pill planner-pill-rose">{dogsOut.length}</span>
			</div>
			<div class="planner-items">
				{#if loading}
					<p class="planner-empty-row">Loading trip board...</p>
				{:else if dogsOut.length === 0}
					<p class="planner-empty-row">No dogs are out right now.</p>
				{:else}
					{#each dogsOut as dog}
						<button
							type="button"
							class="planner-row planner-row-click"
							on:click={() => handleMarkBackIn(dog)}
							disabled={returningDogIds.has(dog.id)}
						>
							<span class="planner-row-main">
								<span class="planner-bullet">🐕</span>
								<span class="planner-row-text">{formatOutLine(dog)}</span>
							</span>
							<span class={`planner-checkbox ${returningDogIds.has(dog.id) ? 'planner-checkbox-busy' : ''}`}>
								{returningDogIds.has(dog.id) ? '…' : ''}
							</span>
						</button>
					{/each}
				{/if}
			</div>
		</section>

		<section class="planner-list planner-list-lilac">
			<div class="planner-list-head">
				<h2>Manager Only</h2>
				<span class="planner-pill planner-pill-lilac">{managerOnlyDogs.length}</span>
			</div>
			<div class="planner-items">
				{#if loading}
					<p class="planner-empty-row">Loading...</p>
				{:else if managerOnlyDogs.length === 0}
					<p class="planner-empty-row">No manager-only assignments.</p>
				{:else}
					{#each managerOnlyDogs as dog}
						<div class="planner-row planner-row-static">
							<span class="planner-row-main">
								<span class="planner-bullet">⭐</span>
								<span class="planner-row-text">{dog.name}</span>
							</span>
							<span class="planner-checkbox"></span>
						</div>
					{/each}
				{/if}
			</div>
			<button type="button" class="planner-add-row">
				<span>Add section</span>
				<span class="planner-add-icons" aria-hidden="true">
					<span class="planner-add-dot">+</span>
					<span class="planner-add-caret">⌃</span>
				</span>
			</button>
		</section>

		<section class="planner-list planner-list-cyan">
			<div class="planner-list-head">
				<h2>Isolation</h2>
				<span class="planner-pill planner-pill-cyan">{isolationDogs.length}</span>
			</div>
			<div class="planner-items">
				{#if loading}
					<p class="planner-empty-row">Loading...</p>
				{:else if isolationDogs.length === 0}
					<p class="planner-empty-row">No dogs in isolation.</p>
				{:else}
					{#each isolationDogs as dog}
						<div class="planner-row planner-row-static">
							<span class="planner-row-main">
								<span class="planner-bullet">{isolationBullet(dog)}</span>
								<span class="planner-row-text">{dog.name} ({isolationLabel(dog)})</span>
							</span>
							<span class="planner-checkbox"></span>
						</div>
					{/each}
				{/if}
			</div>
		</section>
	</div>

	<button type="button" class="planner-fab" aria-label="Add board item">+</button>
</section>

<style>
	.planner-dashboard {
		position: relative;
		display: grid;
		gap: 0.62rem;
		padding: 0.66rem 0.66rem 0.84rem;
		border-radius: 1rem;
		border: 1px solid #d3dbe6;
		background:
			radial-gradient(40rem 20rem at 100% -25%, rgba(57, 142, 193, 0.05) 0%, transparent 62%),
			linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%);
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset;
	}

	.planner-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0 0.1rem;
	}

	.planner-datestamp {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.54rem;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.16rem, 2.1vw, 1.94rem);
		font-weight: 500;
		line-height: 1.08;
		letter-spacing: 0.01em;
		color: #2f3946;
	}

	.planner-weather {
		font-family: var(--font-ui);
		font-size: 0.96rem;
		font-weight: 600;
		color: #6c7581;
	}

	.planner-controls {
		display: inline-flex;
		align-items: center;
		gap: 0.24rem;
	}

	.planner-control {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2rem;
		height: 1.88rem;
		padding: 0 0.52rem;
		border: 1px solid #d8e0ea;
		border-radius: 0.54rem;
		background: #f7f9fc;
		color: #646e7b;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		line-height: 1;
	}

	.planner-control-arrow {
		padding: 0;
		font-size: 1rem;
	}

	.planner-control-label,
	.planner-control-today {
		min-width: 3.25rem;
	}

	.planner-control-today {
		background: #f1f4f8;
	}

	.planner-error {
		margin: 0;
		padding: 0.56rem 0.62rem;
		border: 1px solid #efc7c7;
		border-radius: 0.62rem;
		background: #fff1f1;
		color: #a13b3b;
		font-size: 0.78rem;
		font-weight: 600;
	}

	.planner-columns {
		display: grid;
		gap: 0.58rem;
	}

	.planner-list {
		display: flex;
		flex-direction: column;
		gap: 0.42rem;
		padding: 0.58rem 0.5rem 0.52rem;
		border: 1px solid rgba(79, 96, 117, 0.16);
		border-radius: 0.92rem;
		min-height: 24.4rem;
	}

	.planner-list-sand {
		background: linear-gradient(180deg, #efe6d9 0%, #ece4d8 100%);
	}

	.planner-list-rose {
		background: linear-gradient(180deg, #f4dde4 0%, #f0d8df 100%);
	}

	.planner-list-lilac {
		background: linear-gradient(180deg, #ece8f3 0%, #e7e3ef 100%);
	}

	.planner-list-cyan {
		background: linear-gradient(180deg, #daeff0 0%, #d4ebed 100%);
	}

	.planner-list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.48rem;
	}

	.planner-list-head h2 {
		margin: 0;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.44rem, 1.95vw, 2.04rem);
		font-weight: 500;
		line-height: 1.02;
		color: #2e3845;
	}

	.planner-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.2rem;
		height: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 0.58rem;
		font-weight: 700;
		color: #ffffff;
	}

	.planner-pill-sand {
		background: #c1933c;
	}

	.planner-pill-rose {
		background: #dd7182;
	}

	.planner-pill-lilac {
		background: #a98dba;
	}

	.planner-pill-cyan {
		background: #46a8b5;
	}

	.planner-items {
		display: grid;
		gap: 0.36rem;
	}

	.planner-row-wrap {
		display: grid;
		gap: 0.16rem;
	}

	.planner-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		padding: 0.48rem 0.5rem;
		border: 1px solid rgba(96, 109, 123, 0.15);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.5);
	}

	.planner-row-click {
		text-align: left;
		cursor: pointer;
	}

	.planner-row-click:disabled {
		opacity: 0.7;
		cursor: default;
	}

	.planner-row-done {
		border-color: rgba(92, 128, 73, 0.4);
		background: rgba(255, 255, 255, 0.62);
	}

	.planner-row-main {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.planner-bullet {
		flex-shrink: 0;
		font-size: 0.78rem;
	}

	.planner-row-text {
		display: inline-block;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.24;
		color: #374150;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.planner-checkbox {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.15rem;
		height: 1.15rem;
		flex-shrink: 0;
		border: 2px solid #dde2e8;
		border-radius: 0.12rem;
		background: rgba(255, 255, 255, 0.9);
		font-size: 0.72rem;
		font-weight: 700;
		color: #50606f;
	}

	.planner-checkbox-checked {
		border-color: #739763;
		background: #f5fbf1;
		color: #577a48;
	}

	.planner-checkbox-busy {
		color: #667483;
	}

	.planner-inline-link {
		justify-self: end;
		font-size: 0.58rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: #55708a;
		text-decoration: underline;
		text-underline-offset: 0.12em;
	}

	.planner-empty-row {
		margin: 0;
		padding: 0.52rem 0.5rem;
		border: 1px solid rgba(96, 109, 123, 0.15);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.46);
		font-size: 0.84rem;
		font-weight: 600;
		line-height: 1.3;
		color: #5f6976;
	}

	.planner-add-row {
		margin-top: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.14rem 0;
		border: 0;
		background: transparent;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: 2rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: #666d76;
		text-align: left;
	}

	.planner-add-icons {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
	}

	.planner-add-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.24rem;
		height: 1.24rem;
		border: 1px solid rgba(105, 116, 128, 0.32);
		border-radius: 999px;
		font-size: 0.84rem;
	}

	.planner-add-caret {
		font-size: 0.9rem;
		opacity: 0.62;
	}

	.planner-fab {
		position: absolute;
		right: 0.7rem;
		bottom: 0.7rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid #2e84b7;
		border-radius: 999px;
		background: linear-gradient(180deg, #2f97d1 0%, #2b82b4 100%);
		box-shadow: 0 10px 18px rgba(40, 103, 140, 0.3);
		font-size: 1.5rem;
		line-height: 1;
		color: #ffffff;
	}

	@media (min-width: 760px) {
		.planner-columns {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1180px) {
		.planner-columns {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	@media (max-width: 560px) {
		.planner-dashboard {
			padding: 0.52rem 0.52rem 0.74rem;
		}

		.planner-head {
			flex-direction: column;
			align-items: flex-start;
		}

		.planner-datestamp {
			flex-wrap: wrap;
			gap: 0.3rem 0.56rem;
		}

		.planner-controls {
			width: 100%;
		}

		.planner-control-label,
		.planner-control-today {
			flex: 1 1 0;
		}
	}
</style>
