<script lang="ts">
	import { format, startOfDay } from 'date-fns';
	import { addFeedingLog, endDayTrip, listAllDayTripLogs, listAllFeedingLogsForToday, listDogs, updateDog } from '$lib/data/dogs';
	import { listPlaygroupSessions } from '$lib/data/playgroups';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { daysSince, isSameCalendarDay, toDate } from '$lib/utils/dates';
	import { readJson, writeJson } from '$lib/utils/storage';
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import type { DayTripLog, Dog, FeedingLog, MealTime, PlaygroupSession } from '$lib/types';

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

	interface AttentionItem {
		dogId: string;
		dogName: string;
		type: 'bath' | 'daytrip' | 'playgroup';
		days: number;
	}

	const CLEANING_COMPLETIONS_KEY = 'shelter.cleaningCompletions.v1';
	const today = startOfDay(new Date());
	let weatherIcon = '';
	let weatherTemp = '';

	let loading = true;
	let errorMessage = '';
	const shift = writable<MealTime>(new Date().getHours() < 12 ? 'am' : 'pm');
	let cleaningShift: CleaningShift = 'morning';

	let activeDogs: Dog[] = [];
	let recentlyAdopted: Dog[] = [];
	let playgroupSessions: PlaygroupSession[] = [];
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

	onMount(() => {
		void fetchWeather();
	});

	async function fetchWeather() {
		// Cache Humane Society — 2370 W 200 N, Logan, UT
		try {
			const url = `https://api.open-meteo.com/v1/forecast?latitude=41.736656&longitude=-111.891390&current=temperature_2m,weather_code&temperature_unit=fahrenheit&forecast_days=1`;
			const res = await fetch(url);
			const data = await res.json();
			const temp = Math.round(data.current.temperature_2m);
			const code = data.current.weather_code as number;
			weatherIcon =
				code === 0 ? '☀️' :
				code <= 2 ? '🌤️' :
				code === 3 ? '☁️' :
				code <= 48 ? '🌫️' :
				code <= 67 ? '🌧️' :
				code <= 77 ? '🌨️' :
				code <= 82 ? '🌦️' :
				'⛈️';
			weatherTemp = `${temp}°`;
		} catch {
			weatherIcon = '';
			weatherTemp = '';
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
	$: cleaningShift = $shift === 'am' ? 'morning' : 'evening';
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
		feedingTargets.length > 0 && feedingTargets.every((dog) => hasFeedingLogForShift(dog.id, $shift));
	$: cleaningDone = hasAnyTask(
		$shift === 'am'
			? ['am-cleaner-clean-kennels', 'am-shared-scrub-kennels']
			: ['pm-cleaner-hose-sanitize', 'pm-shared-scrub-kennels']
	);
	$: movementDone =
		$shift === 'am'
			? hasAnyTask(['am-shared-take-dogs-out'])
			: dogsOut.length === 0 || hasAnyTask(['pm-cleaner-bring-dogs-in', 'pm-shared-bring-dogs-in']);
	$: slackDone = Array.from(completedTaskIds).some((taskId) => taskId.includes('slack'));
	$: todayItems =
		$shift === 'am'
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
	$: attentionItems = buildAttentionItems(playgroupSessions);

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
		if (id === 'movement') return $shift === 'am' ? '🚶' : '🚪';
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

	function buildAttentionItems(sessions: PlaygroupSession[]): AttentionItem[] {
		const items: AttentionItem[] = [];

		// Last playgroup date per dog
		const lastPgMs: Record<string, number> = {};
		for (const s of sessions) {
			const t = toDate(s.date)?.getTime();
			if (!t) continue;
			for (const id of s.dogIds) {
				if (!lastPgMs[id] || t > lastPgMs[id]) lastPgMs[id] = t;
			}
		}

		const shelterDogs = activeDogs.filter((d) => d.isolationStatus === 'none');

		// Bath overdue: >= 7 days since last bath (or intake if never bathed)
		for (const dog of shelterDogs) {
			const intakeDays = daysSince(dog.intakeDate, today) ?? 0;
			const bathDays = daysSince(dog.lastBathDate, today);
			const days = bathDays ?? (intakeDays >= 7 ? intakeDays : null);
			if (days !== null && days >= 7) {
				items.push({ dogId: dog.id, dogName: dog.name, type: 'bath', days });
			}
		}

		// Day trip overdue: eligible, not out, >= 14 days since last trip (or intake if never)
		for (const dog of activeDogs) {
			if (dog.isOutOnDayTrip || dog.dayTripStatus === 'ineligible' || dog.isolationStatus !== 'none') continue;
			const intakeDays = daysSince(dog.intakeDate, today) ?? 0;
			const tripDays = daysSince(dog.lastDayTripDate, today);
			const days = tripDays ?? (intakeDays >= 14 ? intakeDays : null);
			if (days !== null && days >= 14) {
				items.push({ dogId: dog.id, dogName: dog.name, type: 'daytrip', days });
			}
		}

		// Playgroup overdue: dog-friendly, not fostered/isolated, >= 10 days since last (or intake)
		for (const dog of shelterDogs) {
			if (dog.inFoster || dog.goodWithDogs === 'no') continue;
			const intakeDays = daysSince(dog.intakeDate, today) ?? 0;
			const lastMs = lastPgMs[dog.id] ?? null;
			const pgDays = lastMs !== null ? (daysSince(new Date(lastMs), today) ?? null) : null;
			const days = pgDays ?? (intakeDays >= 10 ? intakeDays : null);
			if (days !== null && days >= 10) {
				items.push({ dogId: dog.id, dogName: dog.name, type: 'playgroup', days });
			}
		}

		return items.sort((a, b) => b.days - a.days);
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
		return $shift === 'am' ? 'am-cleaner-clean-kennels' : 'pm-cleaner-hose-sanitize';
	}

	function primaryMovementTaskId() {
		return $shift === 'am' ? 'am-shared-take-dogs-out' : 'pm-cleaner-bring-dogs-in';
	}

	function primarySlackTaskId() {
		return $shift === 'am' ? 'am-cleaner-slack' : 'pm-cleaner-slack';
	}

	async function markFeedingComplete() {
		const targets = feedingTargets.filter((dog) => !hasFeedingLogForShift(dog.id, $shift));
		await Promise.all(
			targets.map((dog) =>
				addFeedingLog(
					dog.id,
					{
						date: today,
						mealTime: $shift,
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
				if ($shift === 'pm' && dogsOut.length > 0) {
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
			recentlyAdopted = dogs
				.filter((dog) => dog.status === 'adopted' && !dog.permanentFoster)
				.sort((a, b) => {
					const aTime = toDate(a.updatedAt)?.getTime() ?? 0;
					const bTime = toDate(b.updatedAt)?.getTime() ?? 0;
					return bTime - aTime;
				})
				.slice(0, 5);

			const [tripLogs, feedingByDog, pgSessions] = await Promise.all([
				listAllDayTripLogs(),
				listAllFeedingLogsForToday(),
				listPlaygroupSessions()
			]);

			activeDogs = active;
			dayTripLogs = tripLogs;
			feedingLogsByDog = feedingByDog;
			playgroupSessions = pgSessions;
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
			{#if weatherTemp}
				<span class="planner-weather">
					<span class="planner-weather-icon">{weatherIcon}</span>{weatherTemp}
				</span>
			{/if}
		</p>
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
		</section>

		<section class="planner-list planner-list-rose" class:planner-list-empty={!loading && dogsOut.length === 0}>
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

		<section class="planner-list planner-list-lilac" class:planner-list-empty={!loading && managerOnlyDogs.length === 0}>
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
		</section>

		<section class="planner-list planner-list-cyan" class:planner-list-empty={!loading && isolationDogs.length === 0}>
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

		<section class="planner-list planner-list-sky" class:planner-list-empty={!loading && fosterDogs.length === 0}>
			<div class="planner-list-head">
				<h2>In Foster</h2>
				<span class="planner-pill planner-pill-sky">{fosterDogs.length}</span>
			</div>
			<div class="planner-items">
				{#if loading}
					<p class="planner-empty-row">Loading...</p>
				{:else if fosterDogs.length === 0}
					<p class="planner-empty-row">No dogs in foster.</p>
				{:else}
					{#each fosterDogs as dog}
						<a class="planner-row planner-row-link" href="/dogs/{dog.id}">
							<span class="planner-row-main">
								{#if dog.photoUrl}
									<img class="adopted-thumb" src={dog.photoUrl} alt={dog.name} />
								{:else}
									<span class="planner-bullet">🏡</span>
								{/if}
								<span class="planner-row-text">{dog.name}</span>
							</span>
						</a>
					{/each}
				{/if}
			</div>
		</section>

		<section class="planner-list planner-list-amber" class:planner-list-empty={!loading && attentionItems.length === 0}>
			<div class="planner-list-head">
				<h2>Needs Attention</h2>
				<span class="planner-pill planner-pill-amber">{attentionItems.length}</span>
			</div>
			<div class="planner-items">
				{#if loading}
					<p class="planner-empty-row">Loading...</p>
				{:else if attentionItems.length === 0}
					<p class="planner-empty-row">All caught up!</p>
				{:else}
					{#each attentionItems as item}
						<a class="planner-row planner-row-link" href="/dogs/{item.dogId}">
							<span class="planner-row-main">
								<span class="planner-bullet">
									{#if item.type === 'bath'}🛁{:else if item.type === 'daytrip'}🚗{:else}🐶{/if}
								</span>
								<span class="planner-row-text">{item.dogName}</span>
							</span>
							<span class="attention-tag attention-tag-{item.type}">
								{item.type === 'bath' ? 'bath' : item.type === 'daytrip' ? 'trip' : 'playgroup'} · {dayGapLabel(item.days)}
							</span>
						</a>
					{/each}
				{/if}
			</div>
		</section>

		<section class="planner-list planner-list-sage" class:planner-list-empty={!loading && recentlyAdopted.length === 0}>
			<div class="planner-list-head">
				<h2>Recently Adopted</h2>
				<span class="planner-pill planner-pill-sage">{recentlyAdopted.length}</span>
			</div>
			<div class="planner-items">
				{#if loading}
					<p class="planner-empty-row">Loading...</p>
				{:else if recentlyAdopted.length === 0}
					<p class="planner-empty-row">No recent adoptions.</p>
				{:else}
					{#each recentlyAdopted as dog}
						<a class="planner-row planner-row-link" href="/dogs/{dog.id}">
							<span class="planner-row-main">
								{#if dog.photoUrl}
									<img class="adopted-thumb" src={dog.photoUrl} alt={dog.name} />
								{:else}
									<span class="planner-bullet">🏠</span>
								{/if}
								<span class="planner-row-text">{dog.name}</span>
							</span>
						</a>
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
		grid-template-columns: minmax(0, 1fr);
		gap: 0.62rem;
		padding: 0.66rem 0.66rem 0.84rem;
		border-radius: 1rem;
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
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-family: var(--font-ui);
		font-size: 1.3rem;
		font-weight: 600;
		color: #6c7581;
	}

	.planner-weather-icon {
		font-style: normal;
		color: initial;
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

	.planner-shift-toggle {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: 4.4rem;
		height: 1.72rem;
		padding: 0.18rem;
		border: 1px solid #c8d4e2;
		border-radius: 999px;
		background: #eef3f9;
		cursor: pointer;
		transition: background 180ms ease, border-color 180ms ease;
	}

	.planner-shift-am {
		background: #e8f3fd;
		border-color: #a8cce8;
	}

	.planner-shift-pm {
		background: #f0ecf8;
		border-color: #c0aee0;
	}

	.planner-shift-pip {
		position: absolute;
		left: 0.18rem;
		width: 1.9rem;
		height: 1.32rem;
		border-radius: 999px;
		background: #ffffff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
		transition: transform 180ms ease;
	}

	.planner-shift-pip-right {
		transform: translateX(2.12rem);
	}

	.planner-shift-label {
		position: relative;
		flex: 1;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		line-height: 1;
		pointer-events: none;
	}

	.planner-shift-am .planner-shift-label-am {
		color: #2378b5;
	}

	.planner-shift-am .planner-shift-label-pm {
		color: #8fa3b8;
	}

	.planner-shift-pm .planner-shift-label-am {
		color: #9b8db8;
	}

	.planner-shift-pm .planner-shift-label-pm {
		color: #6344a8;
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
		grid-template-columns: minmax(0, 1fr);
		gap: 0.58rem;
	}

	.planner-list {
		display: flex;
		flex-direction: column;
		gap: 0.42rem;
		padding: 0.58rem 0.5rem 0.52rem;
		border-radius: 0.92rem;
		min-height: 0;
	}

	.planner-list-empty {
		order: 10;
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

	.planner-list-sky {
		background: linear-gradient(180deg, #daeaf7 0%, #d4e4f2 100%);
	}

	.planner-pill-sky {
		background: #3a7eb8;
	}

	.planner-list-amber {
		background: linear-gradient(180deg, #faecd4 0%, #f5e6cb 100%);
	}

	.planner-list-sage {
		background: linear-gradient(180deg, #ddeedd 0%, #d7e9d7 100%);
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

	.planner-pill-amber {
		background: #b87828;
	}

	.planner-pill-sage {
		background: #5a9e68;
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

	.planner-row-link {
		text-decoration: none;
		cursor: pointer;
	}

	.planner-row-link:hover {
		background: rgba(255, 255, 255, 0.7);
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

	.adopted-thumb {
		width: 2rem;
		height: 2rem;
		border-radius: 0.25rem;
		object-fit: cover;
		flex-shrink: 0;
	}

	.attention-tag {
		flex-shrink: 0;
		padding: 0.14rem 0.38rem;
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.attention-tag-bath {
		background: rgba(80, 120, 180, 0.14);
		color: #3a6090;
	}

	.attention-tag-daytrip {
		background: rgba(180, 100, 60, 0.14);
		color: #8a4820;
	}

	.attention-tag-playgroup {
		background: rgba(90, 150, 90, 0.14);
		color: #3a6e3a;
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

	}
</style>
