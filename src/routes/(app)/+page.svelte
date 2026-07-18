<script lang="ts">
	import toast from 'svelte-french-toast';
	import { format, startOfDay } from 'date-fns';
	import { addFeedingLog, setDogTripStatus, listAllDayTripLogs, listAllFeedingLogsForToday, updateDog } from '$lib/data/dogs';
	import { ensureDogsLoaded, refreshDogs } from '$lib/stores/dogs';
	import { listPlaygroupSessions } from '$lib/data/playgroups';
	import { canEditDogs } from '$lib/utils/permissions';
	import { retryablePhoto } from '$lib/utils/photoRetry';
	import { logPhotoRender } from '$lib/utils/photoLog';
	import { resolveDogPhotoUrl } from '$lib/utils/photoUrl';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { daysSince, isSameCalendarDay, toDate } from '$lib/utils/dates';
	import { getBathAttentionDogs, getCautionDogs, getOverdueEnrichmentDogs } from '$lib/utils/attention';
	import { getDailyMovements, type DailyMovements } from '$lib/utils/movements';
	import { subscribeCompletedTasks, toggleCleaningTask } from '$lib/data/cleaning';
	import { subscribeHandoff, saveHandoff, type ShiftHandoff } from '$lib/data/handoff';
	import type { CleaningShift } from '$lib/data/cleaning';
	import { onDestroy, onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import { syncVersion } from '$lib/stores/sync';
	import type { DayTripLog, Dog, FeedingLog, MealTime, PlaygroupSession } from '$lib/types';

	type TodayActionId = 'feeding' | 'cleaning' | 'movement' | 'slack';
	type ActionBusyMap = Record<TodayActionId, boolean>;

	interface TodayAction {
		id: TodayActionId;
		label: string;
		done: boolean;
		checklistHref?: string;
	}

	interface AttentionItem {
		dogId: string;
		dogName: string;
		type: 'bath' | 'enrichment' | 'dogstest';
		days: number;
		isNewIntake?: boolean;
	}

	interface AsmRecentAdoption {
		id: string;
		animalId: string;
		name: string;
		shelterCode: string;
		adoptedAt: string;
		photoUrl: string | null;
	}

	interface RecentlyAdoptedItem {
		id: string;
		name: string;
		photoUrl: string | null;
		href: string | null;
		adoptedAt: Date;
	}

	const today = startOfDay(new Date());
	let weatherIcon = '';
	let weatherTemp = '';

	let loading = true;
	let errorMessage = '';
	// PM shift starts at 1:30pm
	const _now = new Date();
	const _isAfternoon = _now.getHours() > 13 || (_now.getHours() === 13 && _now.getMinutes() >= 30);
	const shift = writable<MealTime>(_isAfternoon ? 'pm' : 'am');
	let cleaningShift: CleaningShift = _isAfternoon ? 'evening' : 'morning';

	let activeDogs: Dog[] = [];
	let allActiveDogs: Dog[] = [];
	let recentlyAdopted: RecentlyAdoptedItem[] = [];
	// Movements panel: derived from the full dog list (incl. archived) for
	// whichever day is picked; defaults to today.
	let movementDogs: Dog[] = [];
	const localDayStr = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	let movementsDayStr = localDayStr(new Date());
	function shiftMovementsDay(delta: number) {
		const [y, m, d] = movementsDayStr.split('-').map(Number);
		movementsDayStr = localDayStr(new Date(y, m - 1, d + delta));
	}
	$: movementsDay = (() => {
		const [y, m, d] = movementsDayStr.split('-').map(Number);
		return new Date(y, (m || 1) - 1, d || 1, 12);
	})();
	$: movementsIsToday = movementsDayStr === localDayStr(new Date());
	$: dailyMovements = getDailyMovements(movementDogs, movementsDay) satisfies DailyMovements;
	$: movementCount =
		dailyMovements.arrived.length +
		dailyMovements.returned.length +
		dailyMovements.toFoster.length +
		dailyMovements.departed.length;

	const departureDisplay = {
		adopted: { emoji: '🏠', label: 'adopted', tagClass: 'movement-tag-adopted' },
		transferred: { emoji: '🚌', label: 'transferred', tagClass: 'movement-tag-adopted' },
		euthanized: { emoji: '🌈', label: 'rainbow bridge', tagClass: 'movement-tag-rainbow' }
	} as const;
	let failedThumbs = new Set<string>();
	let playgroupSessions: PlaygroupSession[] = [];
	let dayTripLogs: DayTripLog[] = [];
	let feedingLogsByDog: Record<string, FeedingLog[]> = {};
	let completedTaskIds = new Set<string>();
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
	$: canPersistAsmAdoptionDates = !firebaseEnabled || canEditDogs($authProfile?.role);

	$: {
		const canLoad = !firebaseEnabled || ($authReady && Boolean($authUser));
		if (canLoad && !boardLoaded) {
			boardLoaded = true;
			void loadBoard(false);
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
	$: cleaningShift = ($shift === 'am' ? 'morning' : 'evening') as CleaningShift;

	// Live cleaning-completion subscription — re-subscribes when the shift toggle
	// flips, and picks up coworkers' checkmarks without a reload.
	let unsubscribeCompleted: (() => void) | null = null;
	$: {
		unsubscribeCompleted?.();
		unsubscribeCompleted = subscribeCompletedTasks(todayKey, cleaningShift, (completions) => {
			completedTaskIds = completions.ids;
		});
	}
	onDestroy(() => unsubscribeCompleted?.());

	// Shift handoff: read the previous shift's note (morning reads yesterday
	// evening's; evening reads this morning's) and edit our own shift's note.
	let prevHandoff: ShiftHandoff | null = null;
	let ownHandoff: ShiftHandoff | null = null;
	let handoffDraft = '';
	let handoffDirty = false;
	let savingHandoff = false;
	$: yesterdayKey = format(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1), 'yyyy-MM-dd');
	$: prevShiftLabel = cleaningShift === 'morning' ? 'last evening' : 'this morning';

	let unsubscribeHandoffs: (() => void) | null = null;
	$: {
		unsubscribeHandoffs?.();
		const [prevDate, prevShift] =
			cleaningShift === 'morning'
				? ([yesterdayKey, 'evening'] as const)
				: ([todayKey, 'morning'] as const);
		const unsubPrev = subscribeHandoff(prevDate, prevShift, (h) => (prevHandoff = h));
		const unsubOwn = subscribeHandoff(todayKey, cleaningShift, (h) => (ownHandoff = h));
		unsubscribeHandoffs = () => {
			unsubPrev();
			unsubOwn();
		};
	}
	onDestroy(() => unsubscribeHandoffs?.());

	// Keep the editor in sync with remote saves unless the user is mid-edit.
	$: if (!handoffDirty) handoffDraft = ownHandoff?.note ?? '';

	async function saveHandoffNote() {
		savingHandoff = true;
		try {
			await saveHandoff(todayKey, cleaningShift, handoffDraft, $authProfile?.displayName ?? null);
			handoffDirty = false;
		} catch {
			toast.error('Could not save the handoff note.');
		} finally {
			savingHandoff = false;
		}
	}

	function handoffMetaLine(h: ShiftHandoff) {
		const at = new Date(h.updatedAt);
		const time = Number.isNaN(at.getTime()) ? '' : ` · ${format(at, 'h:mma').toLowerCase()}`;
		return `${h.updatedBy ?? 'Unknown'}${time}`;
	}

	$: dogsOut = activeDogs
		.filter((dog) => dog.isOutOnDayTrip)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: managerOnlyDogs = activeDogs
		.filter(
			(dog) =>
				dog.handlingLevel === 'manager_only' &&
				dog.isolationStatus === 'none' &&
				dog.isOutOnDayTrip === false
		)
		.slice(0, 4);

	$: isolationDogs = activeDogs
		.filter((dog) => dog.isolationStatus !== 'none')
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 4);
	$: fosterDogs = allActiveDogs.filter((dog) => dog.inFoster && !dog.isIncoming).sort((a, b) => a.name.localeCompare(b.name));
	$: incomingDogs = allActiveDogs.filter((dog) => dog.isIncoming).sort((a, b) => a.name.localeCompare(b.name));
	$: shelterOnlyCount = activeDogs.filter((dog) => !dog.isIncoming).length;

	$: surgeryAlerts = activeDogs
		.filter((dog) => isSameCalendarDay(dog.surgeryDate, today))
		.sort((a, b) => a.name.localeCompare(b.name));

	$: feedingTargets = activeDogs.filter((dog) => !isSameCalendarDay(dog.surgeryDate, today));
	$: feedingDone =
		feedingTargets.length > 0 &&
		feedingTargets.every((dog) =>
			(feedingLogsByDog[dog.id] ?? []).some(
				(log) => log.mealTime === $shift && isSameCalendarDay(log.date, today)
			)
		);
	$: cleaningDone = (
		$shift === 'am'
			? ['am-cleaner-clean-kennels', 'am-shared-scrub-kennels']
			: ['pm-cleaner-hose-sanitize', 'pm-shared-scrub-kennels']
	).some((id) => completedTaskIds.has(id));
	$: movementDone =
		$shift === 'am'
			? ['am-shared-take-dogs-out'].some((id) => completedTaskIds.has(id))
			: ['pm-cleaner-bring-dogs-in', 'pm-shared-bring-dogs-in'].some((id) => completedTaskIds.has(id));
	$: slackDone = ['am-cleaner-slack', 'am-feeder-slack', 'pm-cleaner-slack', 'pm-feeder-slack'].some(
		(id) => completedTaskIds.has(id)
	);
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
	$: attentionItems = buildAttentionItems(playgroupSessions, dayTripLogs);


	function hasFeedingLogForShift(dogId: string, mealTime: MealTime) {
		const logs = feedingLogsByDog[dogId] ?? [];
		return logs.some((log) => log.mealTime === mealTime && isSameCalendarDay(log.date, today));
	}

	function hasAnyTask(taskIds: string[]) {
		return taskIds.some((taskId) => completedTaskIds.has(taskId));
	}

	function formatOutLine(dog: Dog) {
		const dob = toDate(dog.dateOfBirth);
		const ageYears = dob
			? Math.max(0, Math.floor((today.getTime() - startOfDay(dob).getTime()) / 31_557_600_000))
			: null;
		const ageTag = ageYears !== null ? ` (${ageYears})` : '';
		return `${dog.name}${ageTag}`;
	}

	function isolationLabel(dog: Dog) {
		if (dog.isolationReason === 'sick') return 'sick';
		if (dog.isolationReason === 'bite_quarantine') return 'bite quarantine';
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
		if (dog.isolationReason === 'sick') return '🩺';
		if (dog.isolationReason === 'bite_quarantine') return '⚠';
		return '•';
	}

	function dayGapLabel(days: number) {
		if (days >= 14) {
			const weeks = Math.round(days / 7);
			return `${weeks} wk${weeks === 1 ? '' : 's'}`;
		}
		return `${days} day${days === 1 ? '' : 's'}`;
	}

	async function fetchRecentAsmAdoptions() {
		try {
			const res = await fetch('/api/asm/recent-adoptions?days=30');
			if (!res.ok) {
				if (res.status === 502 || res.status === 503) return [];
				throw new Error(`ASM recent adoptions failed: ${res.status}`);
			}
			const data = await res.json();
			return Array.isArray(data) ? (data as AsmRecentAdoption[]) : [];
		} catch (error) {
			console.warn('Unable to load recent ASM adoptions', error);
			return [];
		}
	}

	function buildAsmDogLookup(dogs: Dog[]) {
		const byId = new Map<string, Dog>();

		for (const dog of dogs) {
			if (typeof dog.asmId === 'number') {
				byId.set(String(dog.asmId), dog);
				continue;
			}
			if (/^\d+$/.test(dog.id)) {
				byId.set(dog.id, dog);
			}
		}

		return byId;
	}

	async function reconcileAsmAdoptions(
		dogs: Dog[],
		adoptions: AsmRecentAdoption[]
	) {
		if (!canPersistAsmAdoptionDates || adoptions.length === 0) return;

		const dogLookup = buildAsmDogLookup(dogs);

		const targets = adoptions
			.map((adoption) => ({
				dog: dogLookup.get(adoption.animalId) ?? null,
				adoptedAt: toDate(adoption.adoptedAt)
			}))
			.filter((entry): entry is { dog: Dog; adoptedAt: Date } => Boolean(entry.dog && entry.adoptedAt))
			.filter(({ dog, adoptedAt }) => {
				if (dog.status !== 'adopted') return true;
				const localDate = toDate(dog.leftShelterDate);
				return !localDate || localDate.getTime() !== adoptedAt.getTime();
			});

		if (targets.length === 0) return;

		await Promise.allSettled(
			targets.map(({ dog, adoptedAt }) =>
				updateDog(dog.id, {
					status: 'adopted',
					leftShelterDate: adoptedAt
				})
			)
		);
	}

	function buildRecentlyAdoptedItems(
		dogs: Dog[],
		adoptions: AsmRecentAdoption[]
	): RecentlyAdoptedItem[] {
		const dogLookup = buildAsmDogLookup(dogs);
		return adoptions
			.map((adoption) => {
				const adoptedAt = toDate(adoption.adoptedAt);
				if (!adoptedAt) return null;

				const dog = dogLookup.get(adoption.animalId) ?? null;
				return {
					id: dog?.id ?? `asm-${adoption.id}`,
					name: dog?.name ?? adoption.name,
					photoUrl: dog?.photoUrl ?? adoption.photoUrl ?? null,
					href: dog ? `/dogs/${dog.id}` : null,
					adoptedAt
				};
			})
			.filter((item): item is RecentlyAdoptedItem => Boolean(item))
			.sort((a, b) => b.adoptedAt.getTime() - a.adoptedAt.getTime())
			.slice(0, 5);
	}

	function buildAttentionItems(sessions: PlaygroupSession[], _tripLogs: DayTripLog[]): AttentionItem[] {
		const shelterDogs = activeDogs.filter((d) => d.isolationStatus === 'none' && !d.isIncoming);
		const items: AttentionItem[] = [];

		for (const { dog, days, isNewIntake } of getBathAttentionDogs(shelterDogs, today)) {
			items.push({ dogId: dog.id, dogName: dog.name, type: 'bath', days, isNewIntake });
		}
		for (const { dog, days } of getOverdueEnrichmentDogs(shelterDogs, sessions, today)) {
			items.push({ dogId: dog.id, dogName: dog.name, type: 'enrichment', days });
		}
		for (const dog of getCautionDogs(shelterDogs, sessions)) {
			const days = daysSince(dog.shelterSince ?? dog.intakeDate, today) ?? 0;
			items.push({ dogId: dog.id, dogName: dog.name, type: 'dogstest', days });
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

	function toggleCompletionTask(taskId: string, shouldComplete: boolean) {
		// Optimistic local update for instant UI response
		const next = new Set(completedTaskIds);
		if (shouldComplete) next.add(taskId);
		else next.delete(taskId);
		completedTaskIds = next;
		// Persist to Firestore in background
		void toggleCleaningTask(todayKey, cleaningShift, taskId, shouldComplete, $authProfile?.displayName ?? null);
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
		await Promise.all(targets.map((dog) => setDogTripStatus(dog.id, false)));
	}

	async function handleMarkBackIn(dog: Dog) {
		if (returningDogIds.has(dog.id)) return;
		setDogReturning(dog.id, true);
		errorMessage = '';
		try {
			await setDogTripStatus(dog.id, false);
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
			await updateDog(dog.id, { inFoster: false, shelterSince: new Date() });
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

	$: if ($syncVersion > 0) void loadBoard();

	async function loadBoard(forceDogs = true) {
		loading = true;
		errorMessage = '';
		failedThumbs = new Set();
		try {
			// Dogs flow through the shared store: the initial load reuses its cache,
			// sync- and mutation-triggered reloads force-fetch (as before).
			const [dogs, tripLogs, feedingByDog, pgSessions, recentAsmAdoptions] = await Promise.all([
				forceDogs ? refreshDogs() : ensureDogsLoaded(),
				listAllDayTripLogs(),
				listAllFeedingLogsForToday(),
				listPlaygroupSessions(),
				fetchRecentAsmAdoptions()
			]);
			const recentAsmDogLookup = buildAsmDogLookup(dogs);
			const recentAsmMatchedDogIds = new Set(
				recentAsmAdoptions
					.map((adoption) => recentAsmDogLookup.get(adoption.animalId)?.id)
					.filter((dogId): dogId is string => Boolean(dogId))
			);
			const allActive = dogs
				.filter(
					(dog) =>
						dog.status === 'active' &&
						!dog.permanentFoster &&
						!recentAsmMatchedDogIds.has(dog.id)
				)
				.sort((a, b) => a.name.localeCompare(b.name));
			const active = allActive.filter((dog) => !dog.inFoster);
			recentlyAdopted = buildRecentlyAdoptedItems(dogs, recentAsmAdoptions);
			// Temporary diagnostic: log each recently-adopted card's photo state.
			for (const item of recentlyAdopted) {
				logPhotoRender('dashboard-recently-adopted', item.id, item.name, item.photoUrl);
			}
			void reconcileAsmAdoptions(dogs, recentAsmAdoptions);

			allActiveDogs = allActive;
			activeDogs = active;
			// Movements need the FULL list (including archived dogs).
			movementDogs = dogs;
			dayTripLogs = tripLogs;
			feedingLogsByDog = feedingByDog;
			playgroupSessions = pgSessions;
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

<svelte:head>
	<title>Dashboard | Cache Humane Society</title>
</svelte:head>

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
		{#if !loading}
			<div class="planner-count-chips typewriter">
				<span class="planner-count-chip chip-shelter">In shelter: {shelterOnlyCount}</span>
				<span class="planner-count-chip chip-foster">In foster: {fosterDogs.length}</span>
				{#if incomingDogs.length > 0}
					<span class="planner-count-chip chip-incoming">Incoming: {incomingDogs.length}</span>
				{/if}
			</div>
		{/if}
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

		<section class="planner-list planner-list-sand planner-handoff">
			<div class="planner-list-head">
				<h2>Shift Handoff</h2>
				<span class="planner-pill planner-pill-sand">{cleaningShift === 'morning' ? 'AM' : 'PM'}</span>
			</div>
			<div class="planner-items">
				<div class="handoff-block">
					<p class="handoff-label typewriter">from {prevShiftLabel}</p>
					{#if prevHandoff}
						<p class="handoff-note">{prevHandoff.note}</p>
						<p class="handoff-meta">{handoffMetaLine(prevHandoff)}</p>
					{:else}
						<p class="handoff-empty">No notes left.</p>
					{/if}
				</div>
				<div class="handoff-block">
					<p class="handoff-label typewriter">notes for the next shift</p>
					<textarea
						class="handoff-input"
						rows="3"
						placeholder="Blockers, unfinished tasks, FYIs…"
						bind:value={handoffDraft}
						on:input={() => (handoffDirty = true)}
					></textarea>
					<div class="handoff-actions">
						<button class="handoff-save" on:click={saveHandoffNote} disabled={savingHandoff || !handoffDirty}>
							{savingHandoff ? 'Saving…' : 'Save'}
						</button>
						{#if ownHandoff}
							<span class="handoff-meta">{handoffMetaLine(ownHandoff)}</span>
						{/if}
					</div>
				</div>
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
						<a class="planner-row planner-row-link" href="/dogs/{dog.id}">
							<span class="planner-row-main">
								<span class="planner-bullet">⭐</span>
								<span class="planner-row-text">{dog.name}</span>
							</span>
						</a>
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
						<a class="planner-row planner-row-link" href="/dogs/{dog.id}">
							<span class="planner-row-main">
								<span class="planner-bullet">{isolationBullet(dog)}</span>
								<span class="planner-row-text">{dog.name} ({isolationLabel(dog)})</span>
							</span>
						</a>
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
								{#if dog.photoUrl && !failedThumbs.has(dog.id)}
									<img
										class="adopted-thumb"
										src={resolveDogPhotoUrl(dog.photoUrl)}
										alt={dog.name}
										use:retryablePhoto={{ src: resolveDogPhotoUrl(dog.photoUrl), context: 'dashboard', dogId: dog.id, onFail: () => { failedThumbs = new Set([...failedThumbs, dog.id]); } }}
									/>
								{:else if dog.photoUrl}
									<span class="adopted-thumb adopted-thumb-fallback" aria-hidden="true">{dog.name.slice(0, 1).toUpperCase() || '?'}</span>
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

		<section class="planner-list planner-list-steel" class:planner-list-empty={!loading && incomingDogs.length === 0}>
		<div class="planner-list-head">
			<h2>Incoming</h2>
			<span class="planner-pill planner-pill-steel">{incomingDogs.length}</span>
		</div>
		<div class="planner-items">
			{#if loading}
				<p class="planner-empty-row">Loading...</p>
			{:else if incomingDogs.length === 0}
				<p class="planner-empty-row">No incoming transfers.</p>
			{:else}
				{#each incomingDogs as dog}
					<a class="planner-row planner-row-link" href="/dogs/{dog.id}">
						<span class="planner-row-main">
							{#if dog.photoUrl && !failedThumbs.has(dog.id)}
								<img
									class="adopted-thumb"
									src={resolveDogPhotoUrl(dog.photoUrl)}
									alt={dog.name}
									use:retryablePhoto={{ src: resolveDogPhotoUrl(dog.photoUrl), context: 'dashboard', dogId: dog.id, onFail: () => { failedThumbs = new Set([...failedThumbs, dog.id]); } }}
								/>
							{:else if dog.photoUrl}
								<span class="adopted-thumb adopted-thumb-fallback" aria-hidden="true">{dog.name.slice(0, 1).toUpperCase() || '?'}</span>
							{:else}
								<span class="planner-bullet">🚛</span>
							{/if}
							<span class="planner-row-text">{dog.name}</span>
						</span>
					</a>
				{/each}
			{/if}
		</div>
	</section>

	<section class="planner-list planner-list-amber planner-list-attention" class:planner-list-empty={!loading && attentionItems.length === 0}>
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
									{#if item.type === 'bath'}🛁{:else if item.type === 'enrichment'}🐾{:else}🔍{/if}
								</span>
								<span class="planner-row-text">{item.dogName}</span>
							</span>
							<span class="attention-tag attention-tag-{item.type}">
								{#if item.type === 'bath'}
									{item.isNewIntake ? `bath · new intake · ${item.days}d` : `bath · ${item.days}d overdue`}
								{:else if item.type === 'enrichment'}
									no enrichment · {dayGapLabel(item.days)}
								{:else}
									test compatibility · {dayGapLabel(item.days)}
								{/if}
							</span>
						</a>
					{/each}
				{/if}
			</div>
		</section>

		<section class="planner-list planner-list-sand" class:planner-list-empty={!loading && movementCount === 0}>
			<div class="planner-list-head">
				<h2>{movementsIsToday ? "Today's Movements" : 'Movements'}</h2>
				<span class="planner-pill planner-pill-amber">{movementCount}</span>
				<div class="movement-day-controls">
					<button type="button" class="movement-day-btn" aria-label="Previous day" on:click={() => shiftMovementsDay(-1)}>‹</button>
					<input type="date" class="movement-day-input" bind:value={movementsDayStr} max={localDayStr(new Date())} />
					<button type="button" class="movement-day-btn" aria-label="Next day" disabled={movementsIsToday} on:click={() => shiftMovementsDay(1)}>›</button>
				</div>
			</div>
			<div class="planner-items">
				{#if loading}
					<p class="planner-empty-row">Loading...</p>
				{:else if movementCount === 0}
					<p class="planner-empty-row">No arrivals, returns, fosters, or adoptions {movementsIsToday ? 'logged today' : 'on this day'}.</p>
				{:else}
					{#each dailyMovements.arrived as dog (dog.id)}
						<a class="planner-row planner-row-link" href="/dogs/{dog.id}">
							<span class="planner-row-main">
								<span class="planner-bullet">🐕</span>
								<span class="planner-row-text">{dog.name}</span>
							</span>
							<span class="movement-tag movement-tag-arrived">arrived</span>
						</a>
					{/each}
					{#each dailyMovements.returned as dog (dog.id)}
						<a class="planner-row planner-row-link" href="/dogs/{dog.id}">
							<span class="planner-row-main">
								<span class="planner-bullet">↩️</span>
								<span class="planner-row-text">{dog.name}</span>
							</span>
							<span class="movement-tag movement-tag-returned">returned</span>
						</a>
					{/each}
					{#each dailyMovements.toFoster as dog (dog.id)}
						<a class="planner-row planner-row-link" href="/dogs/{dog.id}">
							<span class="planner-row-main">
								<span class="planner-bullet">🏡</span>
								<span class="planner-row-text">{dog.name}</span>
							</span>
							<span class="movement-tag movement-tag-foster">to foster</span>
						</a>
					{/each}
					{#each dailyMovements.departed as item (item.dog.id)}
						<a class="planner-row planner-row-link" href="/dogs/{item.dog.id}">
							<span class="planner-row-main">
								<span class="planner-bullet">{departureDisplay[item.outcome].emoji}</span>
								<span class="planner-row-text">{item.dog.name}</span>
							</span>
							<span class={`movement-tag ${departureDisplay[item.outcome].tagClass}`}>{departureDisplay[item.outcome].label}</span>
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
					{#each recentlyAdopted as item}
						{#if item.href}
							<a class="planner-row planner-row-link" href={item.href}>
								<span class="planner-row-main">
									{#if item.photoUrl && !failedThumbs.has(item.id)}
										<img
											class="adopted-thumb"
											src={resolveDogPhotoUrl(item.photoUrl)}
											alt={item.name}
											use:retryablePhoto={{ src: resolveDogPhotoUrl(item.photoUrl), context: 'dashboard', dogId: item.id, onFail: () => { failedThumbs = new Set([...failedThumbs, item.id]); } }}
										/>
									{:else if item.photoUrl}
										<span class="adopted-thumb adopted-thumb-fallback" aria-hidden="true">{item.name.slice(0, 1).toUpperCase() || '?'}</span>
									{:else}
										<span class="planner-bullet">🏠</span>
									{/if}
									<span class="planner-row-text">{item.name}</span>
								</span>
							</a>
						{:else}
							<div class="planner-row planner-row-static">
								<span class="planner-row-main">
									{#if item.photoUrl && !failedThumbs.has(item.id)}
										<img
											class="adopted-thumb"
											src={resolveDogPhotoUrl(item.photoUrl)}
											alt={item.name}
											use:retryablePhoto={{ src: resolveDogPhotoUrl(item.photoUrl), context: 'dashboard', dogId: item.id, onFail: () => { failedThumbs = new Set([...failedThumbs, item.id]); } }}
										/>
									{:else if item.photoUrl}
										<span class="adopted-thumb adopted-thumb-fallback" aria-hidden="true">{item.name.slice(0, 1).toUpperCase() || '?'}</span>
									{:else}
										<span class="planner-bullet">🏠</span>
									{/if}
									<span class="planner-row-text">{item.name}</span>
								</span>
							</div>
						{/if}
					{/each}
				{/if}
			</div>
		</section>
	</div>

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

	.planner-count-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.4rem;
	}

	.planner-count-chip {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.18rem 0.6rem;
		font-size: 0.58rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 700;
		border: 1.5px solid;
	}

	.chip-shelter {
		background: #e8f4fc;
		color: #016aa5;
		border-color: #7ec2e8;
	}

	.chip-foster {
		background: #f0ebf7;
		color: #6b2e80;
		border-color: #c4a3d8;
	}

	.chip-incoming {
		background: #fff8e5;
		color: #7a6200;
		border-color: #e3cf80;
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

	/* ── Shift handoff card ── */
	.handoff-block {
		display: grid;
		gap: 0.26rem;
	}

	.handoff-label {
		margin: 0;
		font-size: 0.6rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #75664a;
	}

	.handoff-note {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.35;
		color: #35322a;
		white-space: pre-wrap;
	}

	.handoff-empty {
		margin: 0;
		font-size: 0.78rem;
		color: #9a8d70;
	}

	.handoff-meta {
		margin: 0;
		font-size: 0.66rem;
		color: #9a8d70;
	}

	.handoff-input {
		width: 100%;
		border: 1px solid #d9cdb2;
		border-radius: 0.5rem;
		padding: 0.45rem 0.5rem;
		font: inherit;
		font-size: 0.85rem;
		background: rgba(255, 255, 255, 0.75);
		color: #35322a;
		resize: vertical;
	}

	.handoff-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.handoff-save {
		padding: 0.3rem 0.85rem;
		border: 1px solid #c9b98f;
		border-radius: 0.5rem;
		background: #fff;
		font-size: 0.76rem;
		font-weight: 600;
		color: #6b5a33;
		cursor: pointer;
	}

	.handoff-save:hover:not(:disabled) { background: #faf5e8; }

	.handoff-save:disabled {
		opacity: 0.5;
		cursor: default;
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

	.planner-list-attention:not(.planner-list-empty) {
		order: 9;
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

	.planner-list-steel {
		background: linear-gradient(180deg, #dde6f0 0%, #d4dfe9 100%);
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

	.planner-pill-steel {
		background: #4a7a9e;
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
		flex: 1 1 0;
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

	.adopted-thumb-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-muted, #e6ecf1);
		color: var(--ink-muted, #4a5b68);
		font-family: var(--font-ui);
		font-weight: 600;
		font-size: 0.85rem;
		text-transform: uppercase;
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

	.attention-tag-enrichment {
		background: rgba(90, 150, 90, 0.14);
		color: #3a6e3a;
	}

	.movement-day-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
	}

	.movement-day-btn {
		border: 1px solid #d8cdb4;
		background: #fffdf6;
		border-radius: 0.4rem;
		width: 1.6rem;
		height: 1.6rem;
		line-height: 1;
		font-size: 0.95rem;
		font-weight: 700;
		color: #6d5b2e;
	}

	.movement-day-btn:disabled {
		opacity: 0.4;
	}

	.movement-day-input {
		border: 1px solid #d8cdb4;
		background: #fffdf6;
		border-radius: 0.4rem;
		padding: 0.14rem 0.3rem;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: #4d4128;
	}

	.movement-tag {
		flex-shrink: 0;
		padding: 0.14rem 0.38rem;
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.movement-tag-arrived {
		background: rgba(1, 107, 165, 0.1);
		color: #016aa5;
	}

	.movement-tag-returned {
		background: rgba(180, 120, 40, 0.14);
		color: #7a5010;
	}

	.movement-tag-foster {
		background: rgba(147, 57, 128, 0.12);
		color: #6b2060;
	}

	.movement-tag-adopted {
		background: rgba(59, 175, 43, 0.12);
		color: #2c8e1d;
	}

	.movement-tag-rainbow {
		background: linear-gradient(90deg, rgba(207, 75, 75, 0.14), rgba(224, 168, 42, 0.14), rgba(59, 175, 43, 0.14), rgba(1, 107, 165, 0.14), rgba(147, 57, 128, 0.14));
		color: #4a4a58;
	}

	.attention-tag-dogstest {
		background: rgba(147, 57, 128, 0.12);
		color: #6b2060;
	}




	@media (min-width: 760px) {
		.planner-columns {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			align-items: start;
		}
	}

	@media (min-width: 1180px) {
		.planner-columns {
			grid-template-columns: repeat(3, minmax(0, 1fr));
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
