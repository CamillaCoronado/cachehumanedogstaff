<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { addFeedingLog, updateFeedingLog, deleteFeedingLog, updateDog, addStoolLog, listFeedingLogs, listStoolLogs } from '$lib/data/dogs';
	import { dogs as dogsStore, ensureDogsLoaded, refreshDogs, patchDogInStore } from '$lib/stores/dogs';
	import { formatDate, isSameCalendarDay, isSurgeryToday, toDate } from '$lib/utils/dates';
	import type { Dog, FeedingLog, StoolLog, MealTime, AmountEaten } from '$lib/types';
	import Modal from '$lib/components/ui/Modal.svelte';
	import {
		foodTypeTone,
		foodTypeInstruction,
		foodTypeLabel,
		foodAmountLabel,
		secondMealAmountLabel,
		feedingFlags,
		specialFeedingReasons,
		isSpecialFeeding,
		isFastingMeal,
		fastingLabel,
		appetiteRiskLabel,
		foodSummary,
		getFedMap,
		getFeedingHistoryEntries,
		getAbnormalCount
	} from '$lib/utils/feeding';
	import { syncVersion } from '$lib/stores/sync';
	import {
		MAX_DOGS_PER_RUN,
		routeOptions,
		kennelCells,
		mobileRows,
		getDogRun,
		getRunLabel,
		runIdToKey,
		compareByWalkPath,
		getAssignments
	} from '$lib/utils/kennelLayout';
	import type { WalkPathId } from '$lib/utils/kennelLayout';

	const amounts: AmountEaten[] = ['all', 'most', 'half', 'little', 'none'];
	const HISTORY_LIMIT = 200;
	const LESS_THAN_MOST = new Set<AmountEaten>(['half', 'little', 'none']);
	const MEAL_LABEL: Record<MealTime, string> = { am: 'AM', pm: 'PM', second: '2nd' };

	$: dogs = $dogsStore;
	let feedingLogs: Record<string, FeedingLog[]> = {};
	let stoolLogs: Record<string, StoolLog[]> = {};
	let loading = true;
	let editingFeedId: string | null = null;
	let feedDraft: { foodType: string; foodAmount: string; dietaryNotes: string; hasOwnFood: boolean; transitionToHills: boolean | null; satinBalls: boolean; hasSupplements: boolean; hasSecondMeal: boolean; secondMealAmount: string; fasting: boolean; fastUntilDate: string; fastUntilMeal: MealTime; fastReason: string } = { foodType: 'Normal', foodAmount: '', dietaryNotes: '', hasOwnFood: false, transitionToHills: null, satinBalls: false, hasSupplements: false, hasSecondMeal: false, secondMealAmount: '', fasting: false, fastUntilDate: '', fastUntilMeal: 'am', fastReason: '' };
	let savingFeed = false;
	const _now = new Date();
	const _day = _now.getDay(); // 0=Sun, 5=Fri, 6=Sat
	const _closingHour = (_day === 5 || _day === 6) ? 16 : 17; // Fri/Sat close at 5, feed ~4pm
	let mealTime: MealTime = _now.getHours() < 12 ? 'am' : (_now.getHours() < _closingHour ? 'pm' : 'second');
	const selectedDay = new Date();
	let markingAll = false;
	let unmarkingAll = false;
	let notesByDog: Record<string, string> = {};
	let stoolDog: Dog | null = null;
	let stoolType = 4;
	let stoolNotes = '';
	let savingStool = false;
	let showHistory = false;
	let walkPath: WalkPathId = 'snake_route';
	let editLog: { dogId: string; logId: string; amountEaten: AmountEaten; notes: string } | null = null;
	let savingEdit = false;
	let showDidntEatPanel = false;
	let didntEatIds: string[] = [];
	let savingDidntEat = false;

	onMount(async () => {
		const rows = await ensureDogsLoaded();
		await refreshLogs(rows);
		loading = false;
	});

	// Exclude foster, permanent foster, and incoming dogs not expected today
	$: activeDogs = dogs.filter((dog) => {
		if (dog.status !== 'active') return false;
		if (dog.permanentFoster || dog.inFoster) return false;
		if (dog.isIncoming) return isSameCalendarDay(dog.intakeDate, selectedDay);
		return true;
	}).sort((a, b) => a.name.localeCompare(b.name));
	$: fosterDogs = dogs.filter((dog) => dog.status === 'active' && dog.inFoster && !dog.permanentFoster);
	$: shelterDogs = activeDogs;
	$: kennelAssignments = getAssignments(shelterDogs);
	$: unassignedDogs = shelterDogs.filter((dog) => !getDogRun(dog));
	$: assignedCount = shelterDogs.length - unassignedDogs.length;
	$: fedMap = getFedMap(mealTime === 'second' ? secondMealDogs : shelterDogs, feedingLogs, selectedDay, mealTime);
	$: fedCount = Object.values(fedMap).filter(Boolean).length;
	$: abnormalCount = getAbnormalCount(shelterDogs, stoolLogs, selectedDay);
	$: secondMealDogs = shelterDogs.filter((d) => d.hasSecondMeal);
	$: displayDogs = mealTime === 'second'
		? [...secondMealDogs].sort((a, b) => compareByWalkPath(a, b, walkPath))
		: [...shelterDogs].sort((a, b) => compareByWalkPath(a, b, walkPath));
	$: specialFeedDogs = displayDogs.filter((dog) => isSpecialFeeding(dog));
	// Today's exceptions, pinned above the special list: surgery-day dogs and
	// dogs whose most recent meal was refused or barely touched.
	$: exceptionDogs = displayDogs
		.map((dog) => ({
			dog,
			surgery: isSurgeryDay(dog),
			fasting: isFastingMeal(dog, selectedDay, mealTime) ? fastingLabel(dog) : null,
			appetite: appetiteRiskLabel(feedingLogs[dog.id] ?? [], { day: selectedDay, mealTime })
		}))
		.filter((entry) => entry.surgery || entry.fasting || entry.appetite);
	$: feedingHistoryEntries = getFeedingHistoryEntries(shelterDogs, feedingLogs).slice(0, HISTORY_LIMIT);
	// Dogs logged for the current meal that ate less than "most" (half/little/none),
	// surfaced as a copyable block so a shift lead can paste it into a report.
	$: lowAppetiteEntries = displayDogs
		.map((dog) => ({ dog, log: fedMap[dog.id] }))
		.filter((entry): entry is { dog: Dog; log: FeedingLog } => !!entry.log && LESS_THAN_MOST.has(entry.log.amountEaten));
	$: lowAppetiteCopyText = buildLowAppetiteCopyText(lowAppetiteEntries, mealTime, selectedDay);

	function buildLowAppetiteCopyText(
		entries: { dog: Dog; log: FeedingLog }[],
		meal: MealTime,
		day: Date
	): string {
		if (entries.length === 0) return '';
		const lines = [`Ate less than most — ${MEAL_LABEL[meal]}, ${formatDate(day)}`];
		for (const amount of ['half', 'little', 'none'] as const) {
			const group = entries.filter((entry) => entry.log.amountEaten === amount);
			if (group.length === 0) continue;
			lines.push('', amount.charAt(0).toUpperCase() + amount.slice(1));
			for (const { dog, log } of group) {
				const notes = log.notes?.trim();
				lines.push(`• ${dog.name}${notes ? ` — ${notes}` : ''}`);
			}
		}
		return lines.join('\n');
	}

	async function copyToClipboard(text: string) {
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			toast.success('Copied!');
		} catch {
			toast.error('Copy failed — select and copy manually.');
		}
	}

	function activeFoodAmountLabel(dog: Dog) {
		return mealTime === 'second' ? secondMealAmountLabel(dog) : foodAmountLabel(dog);
	}

	function startEditFeed(dog: Dog) {
		editingFeedId = dog.id;
		feedDraft = {
			foodType: dog.foodType || 'Normal',
			foodAmount: dog.foodAmount ?? '',
			dietaryNotes: dog.dietaryNotes ?? '',
			hasOwnFood: dog.hasOwnFood ?? false,
			transitionToHills: dog.transitionToHills ?? null,
			satinBalls: dog.satinBalls ?? false,
			hasSupplements: dog.hasSupplements ?? false,
			hasSecondMeal: dog.hasSecondMeal ?? false,
			secondMealAmount: dog.secondMealAmount ?? '',
			fasting: !!toDate(dog.fastUntilDate ?? null),
			fastUntilDate: toInputDate(dog.fastUntilDate),
			fastUntilMeal: dog.fastUntilMeal ?? 'am',
			fastReason: dog.fastReason ?? ''
		};
	}

	function toInputDate(value: Dog['fastUntilDate']) {
		const d = toDate(value ?? null);
		if (!d) return '';
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	function parseInputDate(value: string) {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (!match) return new Date();
		const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
		return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
	}

	async function saveFeed(dog: Dog) {
		savingFeed = true;
		const fastActive = feedDraft.fasting && feedDraft.fastUntilDate;
		const updates = {
			foodType: feedDraft.foodType,
			foodAmount: feedDraft.foodAmount.trim(),
			dietaryNotes: feedDraft.dietaryNotes.trim(),
			hasOwnFood: feedDraft.hasOwnFood,
			transitionToHills: feedDraft.transitionToHills,
			satinBalls: feedDraft.satinBalls,
			hasSupplements: feedDraft.hasSupplements,
			hasSecondMeal: feedDraft.hasSecondMeal,
			secondMealAmount: feedDraft.secondMealAmount.trim(),
			fastUntilDate: fastActive ? parseInputDate(feedDraft.fastUntilDate) : null,
			fastUntilMeal: fastActive ? feedDraft.fastUntilMeal : null,
			fastReason: fastActive ? feedDraft.fastReason.trim() || null : null
		};
		try {
			await updateDog(dog.id, updates);
			patchDogInStore(dog.id, updates);
			editingFeedId = null;
		} catch {
			toast.error(`Could not update ${dog.name}'s feeding info.`);
		} finally {
			savingFeed = false;
		}
	}

	// Dogs come from the shared store; logs are per-dog subcollections the page
	// still owns, so an ASM sync re-fetches both here (the store dedupes the
	// concurrent dog fetch its own syncVersion subscription triggers).
	$: if ($syncVersion > 0) void refreshAll();

	async function refreshAll() {
		loading = true;
		const rows = await refreshDogs();
		await refreshLogs(rows);
		loading = false;
	}

	async function refreshLogs(list: Dog[] = dogs) {
		const feedingEntries = await Promise.all(
			list.map(async (dog) => [dog.id, await listFeedingLogs(dog.id)] as const)
		);
		const stoolEntries = await Promise.all(
			list.map(async (dog) => [dog.id, await listStoolLogs(dog.id)] as const)
		);
		feedingLogs = Object.fromEntries(feedingEntries);
		stoolLogs = Object.fromEntries(stoolEntries);
	}

	function isSurgeryBlocked(dog: Dog) {
		return isSurgeryToday(dog.surgeryDate, selectedDay) && mealTime === 'am';
	}

	function isSurgeryDay(dog: Dog) {
		return isSurgeryToday(dog.surgeryDate, selectedDay);
	}

	function isFastBlocked(dog: Dog) {
		return isFastingMeal(dog, selectedDay, mealTime);
	}

	// Any vet-ordered feeding block for the meal being worked: surgery-day AM
	// or an active fast.
	function isDoNotFeed(dog: Dog) {
		return isSurgeryBlocked(dog) || isFastBlocked(dog);
	}

	async function logFeeding(dog: Dog, amount: AmountEaten) {
		if (dog.inFoster) {
			toast.error('Dogs in foster are not on the feeding schedule.');
			return;
		}
		if (fedMap[dog.id]) return;
		if (isSurgeryBlocked(dog)) {
			toast.error('Surgery today — do not feed.');
			return;
		}
		if (isFastBlocked(dog)) {
			toast.error(`${fastingLabel(dog)} — do not feed.`);
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

	function openEdit(dog: Dog, log: FeedingLog) {
		editLog = { dogId: dog.id, logId: log.id, amountEaten: log.amountEaten, notes: log.notes ?? '' };
	}

	async function saveEdit() {
		if (!editLog) return;
		savingEdit = true;
		try {
			await updateFeedingLog(editLog.dogId, editLog.logId, {
				amountEaten: editLog.amountEaten,
				notes: editLog.notes.trim() || null
			});
			await refreshLogs();
			toast.success('Updated.');
			editLog = null;
		} catch (error) {
			console.error(error);
			toast.error('Unable to update feeding log.');
		} finally {
			savingEdit = false;
		}
	}

	// Undo a mistaken "fed" entry: removes the log so the dog goes back to unfed.
	async function removeFeeding() {
		if (!editLog || savingEdit) return;
		savingEdit = true;
		try {
			await deleteFeedingLog(editLog.dogId, editLog.logId);
			await refreshLogs();
			toast.success('Feeding log removed.');
			editLog = null;
		} catch (error) {
			console.error(error);
			toast.error('Unable to remove feeding log.');
		} finally {
			savingEdit = false;
		}
	}

	async function markAllFed() {
		if (markingAll) return;
		markingAll = true;
		try {
			const targets = (mealTime === 'second' ? secondMealDogs : shelterDogs).filter((dog) => !fedMap[dog.id]);
			await Promise.all(
				targets.map((dog) =>
					addFeedingLog(
						dog.id,
						{
							date: selectedDay,
							mealTime,
							amountEaten: isDoNotFeed(dog) ? 'none' : 'all',
							notes: isSurgeryBlocked(dog)
								? 'Surgery — do not feed'
								: isFastBlocked(dog)
									? fastingLabel(dog)
									: null
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

	// Bulk undo for "Mark all as fed": removes every log for this meal + day.
	async function unmarkAllFed() {
		if (unmarkingAll) return;
		const targets = Object.entries(fedMap).filter(([, log]) => log) as [string, FeedingLog][];
		if (targets.length === 0) return;
		if (!confirm(`Remove all ${targets.length} feeding log${targets.length === 1 ? '' : 's'} for this meal?`)) return;
		unmarkingAll = true;
		try {
			await Promise.all(targets.map(([dogId, log]) => deleteFeedingLog(dogId, log.id)));
			await refreshLogs();
			toast.success('Feeding logs removed for this meal.');
		} catch (error) {
			console.error(error);
			toast.error('Unable to remove feeding logs.');
		} finally {
			unmarkingAll = false;
		}
	}

	function openDidntEatPanel() {
		didntEatIds = [];
		showDidntEatPanel = true;
	}

	async function saveDidntEat() {
		if (savingDidntEat) return;
		savingDidntEat = true;
		const targets = displayDogs.filter((dog) => didntEatIds.includes(dog.id));
		try {
			await Promise.all(
				targets.map((dog) => {
					const existing = fedMap[dog.id];
					if (existing) {
						return updateFeedingLog(dog.id, existing.id, { amountEaten: 'none', notes: existing.notes });
					}
					return addFeedingLog(dog.id, { date: selectedDay, mealTime, amountEaten: 'none', notes: null }, $authProfile);
				})
			);
			await refreshLogs();
			showDidntEatPanel = false;
			didntEatIds = [];
			toast.success(`Logged ${targets.length} dog${targets.length === 1 ? '' : 's'} as didn't eat.`);
		} catch (error) {
			console.error(error);
			toast.error('Unable to save.');
		} finally {
			savingDidntEat = false;
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

<svelte:head>
	<title>Feeding | Cache Humane Society</title>
</svelte:head>

<section class="feeding-board">
		<div class="feeding-grid-board">
			<div class="feeding-header">
			<div class="feeding-title">
				<p class="feeding-summary whiteboard-hand erase-marker-blue">
					{fedCount}/{mealTime === 'second' ? secondMealDogs.length : shelterDogs.length} dogs fed • {abnormalCount} abnormal stools logged
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
					<button
						class={`meal-switch-btn ${mealTime === 'second' ? 'meal-switch-btn-active' : ''}`}
						type="button"
						on:click={() => (mealTime = 'second')}
					>
						2nd
					</button>
				</div>
				<button
					class="didnt-eat-btn"
					on:click={openDidntEatPanel}
				>
					Didn't eat
				</button>
				<button
					class="mark-all-btn"
					on:click={markAllFed}
					disabled={markingAll}
				>
					{markingAll ? 'Saving...' : 'Mark all as fed'}
				</button>
				{#if fedCount > 0}
					<button
						class="unmark-all-btn"
						on:click={unmarkAllFed}
						disabled={unmarkingAll}
					>
						{unmarkingAll ? 'Removing...' : 'Unmark all'}
					</button>
				{/if}
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
				{#if lowAppetiteEntries.length > 0}
					<div class="feeding-low-appetite-block">
						<div class="feeding-low-appetite-head">
							<p class="feeding-low-appetite-title typewriter">ate less than most — copy for report</p>
							<button type="button" class="feeding-copy-btn" on:click={() => copyToClipboard(lowAppetiteCopyText)}>
								Copy
							</button>
						</div>
						<pre class="feeding-low-appetite-pre">{lowAppetiteCopyText}</pre>
					</div>
				{/if}
				{#if exceptionDogs.length > 0}
					<div class="feeding-special-summary feeding-exceptions">
						<p class="feeding-special-title typewriter">today's exceptions</p>
						<div class="feeding-special-list">
							{#each exceptionDogs as entry (entry.dog.id)}
								<div class="feeding-special-row">
									<a class="feeding-special-name dog-name-link" href="/dogs/{entry.dog.id}">{entry.dog.name}</a>
									{#if entry.surgery}
										<span class="feeding-exception-tag feeding-exception-surgery">
											{mealTime === 'am' ? 'Surgery today — do not feed' : 'Surgery today'}
										</span>
									{/if}
									{#if entry.fasting}
										<span class="feeding-exception-tag feeding-exception-surgery">{entry.fasting}</span>
									{/if}
									{#if entry.appetite}
										<span class="feeding-exception-tag">{entry.appetite}</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if specialFeedDogs.length > 0}
					<div class="feeding-special-summary">
						<p class="feeding-special-title typewriter">special feeding list</p>
						<div class="feeding-special-list">
							{#each specialFeedDogs as dog}
								<div class="feeding-special-row">
									<a class="feeding-special-name dog-name-link" href="/dogs/{dog.id}">{dog.name}</a>
									<span class="feeding-special-amount">{activeFoodAmountLabel(dog)}</span>
									<span class="feeding-special-reasons">{specialFeedingReasons(dog, mealTime).join(' • ')}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if loading}
					<p class="feeding-status whiteboard-hand">Loading dogs...</p>
				{:else if displayDogs.length === 0}
					<p class="feeding-status whiteboard-hand">
						{fosterDogs.length > 0 ? 'No in-shelter dogs to feed right now.' : 'No dogs to show.'}
					</p>
				{:else}
					<div class="feeding-dog-list">
						{#each displayDogs as dog, index}
							{@const flags = feedingFlags(dog)}
							{@const notes = dog.dietaryNotes?.trim() ?? ''}
							{@const specialReasons = specialFeedingReasons(dog, mealTime)}
							{@const fedLog = fedMap[dog.id]}
							<article
								class={`feeding-feed-row ${fedLog ? `feeding-feed-row-fed feeding-feed-row-fed-${fedLog.amountEaten}` : ''} ${
									isDoNotFeed(dog) ? 'feeding-feed-row-blocked' : isSurgeryDay(dog) ? 'feeding-feed-row-alert' : ''
								}`}
							>
								<div class="feeding-feed-order">{index + 1}</div>
								<div class="feeding-feed-main">
									<p class="feeding-feed-name"><a class="dog-name-link" href="/dogs/{dog.id}">{dog.name}</a></p>
									<p class="feeding-feed-run typewriter">{getRunLabel(dog)}</p>
									{#if specialReasons.length > 0}
										<p class="feeding-feed-special typewriter">* {specialReasons.join(' • ')}</p>
									{/if}
								</div>
								<div class="feeding-feed-plan">
									{#if isSurgeryBlocked(dog)}
										<!-- no food info shown for do-not-feed dogs -->
									{:else if isFastBlocked(dog) && editingFeedId !== dog.id}
										<p class="feeding-feed-fasting">
											<button class="feed-notes-edit-btn" on:click={() => startEditFeed(dog)}>
												{fastingLabel(dog)}
											</button>
										</p>
									{:else if editingFeedId === dog.id}
										<div class="feed-edit-panel">
											<div class="feed-edit-row">
												<label class="feed-edit-label typewriter" for="feed-type-{dog.id}">Type</label>
												<select id="feed-type-{dog.id}" class="feed-edit-input" bind:value={feedDraft.foodType}>
													<option value="Normal">Normal</option>
													<option value="Puppy">Puppy</option>
													<option value="No Fish">No Fish</option>
													<option value="No Chicken">No Chicken</option>
												</select>
											</div>
											<div class="feed-edit-row">
												<label class="feed-edit-label typewriter" for="feed-amount-{dog.id}">Amount</label>
												<input id="feed-amount-{dog.id}" class="feed-edit-input" type="text" bind:value={feedDraft.foodAmount} placeholder="e.g. 2 cups" />
											</div>
											<div class="feed-edit-row">
												<label class="feed-edit-label typewriter" for="feed-notes-{dog.id}">Notes</label>
												<input id="feed-notes-{dog.id}" class="feed-edit-input" type="text" bind:value={feedDraft.dietaryNotes} placeholder="Dietary notes" />
											</div>
											<div class="feed-edit-checks">
												<label class="feed-edit-check">
													<input type="checkbox" bind:checked={feedDraft.hasOwnFood} />
													Own food
												</label>
												{#if feedDraft.hasOwnFood}
													<label class="feed-edit-check">
														<input type="checkbox"
															checked={feedDraft.transitionToHills === true}
															on:change={(e) => { feedDraft.transitionToHills = e.currentTarget.checked ? true : null; }}
														/>
														Transition to Hills
													</label>
													<label class="feed-edit-check">
														<input type="checkbox"
															checked={feedDraft.transitionToHills === false}
															on:change={(e) => { feedDraft.transitionToHills = e.currentTarget.checked ? false : null; }}
														/>
														No Hills transition
													</label>
												{/if}
												<label class="feed-edit-check">
													<input type="checkbox" bind:checked={feedDraft.satinBalls} />
													Satin balls
												</label>
												<label class="feed-edit-check">
													<input type="checkbox" bind:checked={feedDraft.hasSupplements} />
													Supplements
												</label>
												<label class="feed-edit-check feed-edit-check-fast">
													<input type="checkbox" bind:checked={feedDraft.fasting} />
													Fasting (do not feed)
												</label>
												{#if feedDraft.fasting}
													<div class="feed-edit-row" style="padding-left: 1.2rem; margin-top: 0.2rem;">
														<label class="feed-edit-label typewriter" for="feed-fast-until-{dog.id}">Until</label>
														<input id="feed-fast-until-{dog.id}" class="feed-edit-input" type="date" bind:value={feedDraft.fastUntilDate} />
														<select class="feed-edit-input" aria-label="Last meal to skip" bind:value={feedDraft.fastUntilMeal}>
															<option value="am">through AM</option>
															<option value="pm">through PM</option>
															<option value="second">through 2nd</option>
														</select>
													</div>
													<div class="feed-edit-row" style="padding-left: 1.2rem;">
														<label class="feed-edit-label typewriter" for="feed-fast-reason-{dog.id}">Why</label>
														<input id="feed-fast-reason-{dog.id}" class="feed-edit-input" type="text" bind:value={feedDraft.fastReason} placeholder="e.g. treatment starts tomorrow evening" />
													</div>
												{/if}
												<label class="feed-edit-check">
													<input type="checkbox" bind:checked={feedDraft.hasSecondMeal} />
													Gets closing meal
												</label>
												{#if feedDraft.hasSecondMeal}
													<div class="feed-edit-row" style="padding-left: 1.2rem; margin-top: 0.2rem;">
														<label class="feed-edit-label typewriter" for="feed-second-{dog.id}">2nd amount</label>
														<input id="feed-second-{dog.id}" class="feed-edit-input" type="text" bind:value={feedDraft.secondMealAmount} placeholder="Same as regular" />
													</div>
												{/if}
											</div>
											<div class="feed-edit-actions">
												<button class="feed-edit-save" on:click={() => saveFeed(dog)} disabled={savingFeed}>
													{savingFeed ? '…' : 'Save'}
												</button>
												<button class="feed-edit-cancel" on:click={() => { editingFeedId = null; }}>Cancel</button>
											</div>
										</div>
									{:else}
										<p class="feeding-feed-amount">
											<span class="feeding-feed-amount-label">Feed</span>
											<button class="feeding-amount-btn" on:click={() => startEditFeed(dog)}>
												{activeFoodAmountLabel(dog)}
											</button>
										</p>
										<p class={`feeding-feed-type feeding-feed-type-${foodTypeTone(dog)}`}>
											<button class="feed-type-edit-btn" on:click={() => startEditFeed(dog)}>
												{foodTypeInstruction(dog)}
											</button>
										</p>
										{#if flags.length > 0}
											<div class="feeding-feed-tags">
												{#each flags as flag}
													<span class={`feeding-feed-tag ${flag === 'Allergy' ? 'feeding-feed-tag-allergy' : ''}`}>{flag}</span>
												{/each}
											</div>
										{/if}
										{#if notes}
											<p class="feeding-feed-notes">
												<button class="feed-notes-edit-btn" on:click={() => startEditFeed(dog)}>
													<span>Notes:</span> {notes}
												</button>
											</p>
										{/if}
									{/if}
								</div>
								<div class="feeding-feed-actions">
									<div class="feeding-feed-badges">
										{#if fedLog}
											<span class="fed-badge">Logged</span>
										{/if}
										{#if isSurgeryBlocked(dog)}
											<span class="surgery-pill">Do not feed</span>
										{:else if isFastBlocked(dog)}
											<span class="surgery-pill">Fasting — do not feed</span>
										{:else if isSurgeryDay(dog)}
											<span class="surgery-day-pill">Surgery day</span>
										{/if}
									</div>
									{#if fedLog}
										{#if editLog?.dogId === dog.id}
											<select class="feeding-field" bind:value={editLog.amountEaten}>
												{#each amounts as amount}
													<option value={amount}>{amount}</option>
												{/each}
											</select>
											<input class="feeding-field" placeholder="Notes" bind:value={editLog.notes} />
											<div class="feeding-inline-edit-actions">
												<button class="feeding-edit-save-btn" on:click={saveEdit} disabled={savingEdit}>
													{savingEdit ? '…' : 'Save'}
												</button>
												<button class="feeding-edit-cancel-btn" on:click={() => (editLog = null)}>Cancel</button>
												<button class="feeding-edit-remove-btn" on:click={removeFeeding} disabled={savingEdit}>
													Remove
												</button>
											</div>
										{:else}
											<div class={`feeding-fed-summary feeding-fed-summary-${fedLog.amountEaten}`}>
												<span class="feeding-fed-amount">{fedLog.amountEaten}</span>
												{#if fedLog.notes}
													<span class="feeding-fed-notes">{fedLog.notes}</span>
												{/if}
												<span class="feeding-fed-by">by {fedLog.loggedByName}</span>
											</div>
											<button class="feeding-edit-btn" on:click={() => openEdit(dog, fedLog)}>Edit</button>
										{/if}
									{:else}
										<select
											class="feeding-field"
											disabled={isDoNotFeed(dog)}
											on:change={(event) => handleAmountChange(dog, event)}
										>
											<option value="">Amount eaten</option>
											{#each amounts as amount}
												<option value={amount}>{amount}</option>
											{/each}
										</select>
										<input
											class="feeding-field"
											placeholder="Feeding notes"
											bind:value={notesByDog[dog.id]}
										/>
									{/if}
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
						{#if fosterDogs.length > 0}
							<span class="hero-chip">{fosterDogs.length} in foster</span>
						{/if}
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
									<span class="feeding-unassigned-chip"><a class="dog-name-link" href="/dogs/{dog.id}">{dog.name}</a>: {foodSummary(dog)}</span>
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

<Modal open={showDidntEatPanel} title="Who didn't eat?" onClose={() => (showDidntEatPanel = false)}>
	<p class="didnt-eat-hint typewriter">Select dogs that didn't eat. Already-logged dogs can be updated.</p>
	<div class="didnt-eat-list">
		{#each displayDogs.filter((d) => !isDoNotFeed(d)) as dog}
			{@const existingLog = fedMap[dog.id]}
			<label class="didnt-eat-item {existingLog && existingLog.amountEaten === 'none' ? 'didnt-eat-item-already-none' : ''}">
				<input
					type="checkbox"
					checked={didntEatIds.includes(dog.id)}
					on:change={(e) => {
						if (e.currentTarget.checked) {
							didntEatIds = [...didntEatIds, dog.id];
						} else {
							didntEatIds = didntEatIds.filter((id) => id !== dog.id);
						}
					}}
				/>
				<span class="didnt-eat-name">{dog.name}</span>
				{#if existingLog}
					<span class="didnt-eat-fed-note typewriter">{existingLog.amountEaten === 'none' ? 'already none' : `logged: ${existingLog.amountEaten}`}</span>
				{/if}
			</label>
		{/each}
	</div>
	<svelte:fragment slot="footer">
		<button
			class="didnt-eat-save"
			type="button"
			disabled={savingDidntEat || didntEatIds.length === 0}
			on:click={saveDidntEat}
		>
			{savingDidntEat ? 'Saving…' : `Log ${didntEatIds.length} dog${didntEatIds.length === 1 ? '' : 's'} as didn't eat`}
		</button>
	</svelte:fragment>
</Modal>

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
		border: 1px solid #d5e0ea;
		background: rgba(255, 255, 255, 0.9);
	}

	.feeding-header {
		display: grid;
		gap: 0.64rem;
		padding: 0.82rem 0.8rem;
		border-bottom: 1px solid #d5e0ea;
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
		border: 1px solid #d5e0ea;
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
		border: 1px solid #d5e0ea;
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

	.unmark-all-btn {
		min-height: 2.75rem;
		border-radius: 0.24rem;
		border: 1px solid #d5c6a0;
		background: #fdf8ef;
		padding: 0.28rem 0.62rem;
		font-size: 0.88rem;
		font-family: var(--font-typewriter);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #8a5a1c;
		white-space: normal;
		cursor: pointer;
	}

	.unmark-all-btn:disabled {
		opacity: 0.6;
	}

	.didnt-eat-btn {
		min-height: 2.75rem;
		border-radius: 0.24rem;
		border: 1px solid #f5c6c6;
		background: #fff5f5;
		padding: 0.28rem 0.62rem;
		font-size: 0.88rem;
		font-family: var(--font-typewriter);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #7a1f1f;
		white-space: normal;
		cursor: pointer;
	}

	.didnt-eat-hint {
		margin: 0;
		font-size: 0.62rem;
		color: #6a7a8a;
	}

	.didnt-eat-list {
		display: grid;
		gap: 0.1rem;
		margin-top: 0.6rem;
	}

	.didnt-eat-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.32rem 0.4rem;
		border-radius: 0.3rem;
		cursor: pointer;
		font-size: 0.88rem;
	}

	.didnt-eat-item:hover {
		background: #fef5f5;
	}

	.didnt-eat-item-already-none {
		opacity: 0.55;
	}

	.didnt-eat-name {
		flex: 1;
		font-weight: 600;
	}

	.didnt-eat-fed-note {
		font-size: 0.6rem;
		color: #8a9aaa;
		letter-spacing: 0.05em;
	}

	.didnt-eat-save {
		width: 100%;
		padding: 0.6rem;
		border: none;
		border-radius: 0.34rem;
		background: #cf4b4b;
		color: #fff;
		font-family: var(--font-typewriter);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
	}

	.didnt-eat-save:disabled {
		opacity: 0.5;
		cursor: default;
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
		border: 1px solid #d5e0ea;
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
		font-family: var(--font-ui);
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
		border: 1px solid #d5e0ea;
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
		gap: 0.04rem;
		border: 1px solid #c5d2e1;
		background: rgba(255, 255, 255, 0.98);
		padding: 0.18rem 0.22rem;
		border-radius: 0.16rem;
		overflow: hidden;
	}

	.feeding-kennel-special {
		background: #f7faff;
		border-style: dashed;
	}

	.feeding-run-label {
		font-size: clamp(0.54rem, 1.4vw, 0.64rem);
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #7086a3;
		line-height: 1;
	}

	.feeding-run-entry {
		margin: 0;
		font-size: clamp(0.6rem, 1.6vw, 0.7rem);
		line-height: 1.15;
		color: #1f3248;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.feeding-run-name {
		font-weight: 700;
	}

	.feeding-run-amount {
		font-family: var(--font-ui);
		font-weight: 700;
		color: #2f79b6;
	}

	.feeding-run-kind {
		font-family: var(--font-typewriter);
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #4a6079;
	}

	.feeding-run-divider {
		padding-inline: 0.05rem;
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

	.feeding-low-appetite-block {
		margin-top: 0.48rem;
		display: grid;
		gap: 0.34rem;
		border: 1.5px dashed #d9a05b;
		background: #fdf8ef;
		padding: 0.44rem 0.46rem;
	}

	.feeding-low-appetite-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.feeding-low-appetite-title {
		margin: 0;
		font-size: 0.56rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #8a5a1c;
	}

	.feeding-copy-btn {
		min-height: 1.9rem;
		border: 1px solid #d9a05b;
		border-radius: 0.22rem;
		background: #ffffff;
		padding: 0.12rem 0.56rem;
		font-family: var(--font-typewriter);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #8a5a1c;
		cursor: pointer;
		white-space: nowrap;
	}

	.feeding-copy-btn:hover {
		background: #fdf3e2;
	}

	.feeding-low-appetite-pre {
		margin: 0;
		padding: 0.5rem 0.6rem;
		background: #ffffff;
		border: 1px solid #ecd9bc;
		border-radius: 0.3rem;
		font-family: var(--font-typewriter);
		font-size: 0.72rem;
		line-height: 1.5;
		white-space: pre-wrap;
		color: #3f2f14;
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
		font-family: var(--font-ui);
		font-size: 0.92rem;
		line-height: 1.06;
		color: #1f3248;
	}

	.feeding-special-amount {
		font-family: var(--font-ui);
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

	/* "Today's exceptions" — same summary shell, warm alert palette */
	.feeding-exceptions {
		border-color: #d9a05b;
		background: #fdf8ef;
	}

	.feeding-exceptions .feeding-special-title { color: #8a5a1c; }

	.feeding-exception-tag {
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #8a5a1c;
		white-space: nowrap;
	}

	.feeding-exception-surgery { color: #c5221f; font-weight: 700; }

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

	/* Fed rows grade from green (ate all) toward red (ate none) so appetite
	   problems jump out on the board. */
	.feeding-feed-row-fed {
		background: #f1fbf4;
		box-shadow: inset 0 0 0 1px #b6d9c2;
	}

	.feeding-feed-row-fed-most {
		background: #f6fae9;
		box-shadow: inset 0 0 0 1px #ccd9a2;
	}

	.feeding-feed-row-fed-half {
		background: #fdf8e6;
		box-shadow: inset 0 0 0 1px #e2cc8b;
	}

	.feeding-feed-row-fed-little {
		background: #fdf0e2;
		box-shadow: inset 0 0 0 1px #e5b58c;
	}

	.feeding-feed-row-fed-none {
		background: #fdeaea;
		box-shadow: inset 0 0 0 1px #dfa3a3;
	}

	.feeding-feed-row-blocked {
		background: #fde0e0;
		box-shadow: inset 0 0 0 1px #c97070;
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
		font-family: var(--font-ui);
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

	.feeding-feed-fasting {
		margin: 0;
		font-size: 0.74rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8b2020;
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
		font-family: var(--font-ui);
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

	.feeding-amount-btn {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-decoration: underline;
		text-decoration-style: dotted;
		text-decoration-color: #9ab8d4;
	}

	.feeding-amount-btn:hover {
		text-decoration-color: #2f79b6;
	}

	.feed-type-edit-btn,
	.feed-notes-edit-btn {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: left;
		text-decoration: underline;
		text-decoration-style: dotted;
		text-decoration-color: rgba(0,0,0,0.2);
	}

	.feed-type-edit-btn:hover,
	.feed-notes-edit-btn:hover {
		text-decoration-color: currentColor;
	}

	.feed-edit-panel {
		display: grid;
		gap: 0.4rem;
	}

	.feed-edit-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.feed-edit-label {
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7a8fa0;
		flex-shrink: 0;
		width: 3.2rem;
	}

	.feed-edit-input {
		flex: 1;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.36rem;
		padding: 0.22rem 0.42rem;
		background: #f8fbff;
		color: #133149;
		min-width: 0;
	}

	.feed-edit-checks {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.9rem;
		padding-left: 3.7rem;
	}

	.feed-edit-check {
		display: flex;
		align-items: center;
		gap: 0.28rem;
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: #3f5568;
		cursor: pointer;
	}

	.feed-edit-check-fast {
		color: #8b2020;
		font-weight: 700;
	}

	.feed-edit-actions {
		display: flex;
		gap: 0.4rem;
		padding-left: 3.7rem;
		margin-top: 0.1rem;
	}

	.feed-edit-save {
		font-family: var(--font-typewriter);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.24rem 0.7rem;
		border: none;
		border-radius: 0.38rem;
		background: #016aa5;
		color: #fff;
		cursor: pointer;
	}

	.feed-edit-save:disabled { opacity: 0.6; }

	.feed-edit-cancel {
		font-family: var(--font-typewriter);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.24rem 0.7rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.38rem;
		background: transparent;
		color: #526b81;
		cursor: pointer;
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

	.feeding-feed-row-alert {
		background: #fff8df;
		box-shadow: inset 0 0 0 1px #ddc27b;
	}

	.surgery-day-pill {
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

	.surgery-pill {
		display: inline-flex;
		border: 1.5px solid #b03030;
		border-radius: 0.2rem;
		padding: 0.18rem 0.45rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #ffffff;
		background: #cf4b4b;
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

	.feeding-feed-tag-allergy {
		border-color: #e8a8a8;
		background: #fff0f0;
		color: #8b2020;
	}

	.feeding-fed-summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem;
		padding: 0.26rem 0.42rem;
		border: 1px solid #b6d9c2;
		border-radius: 0.22rem;
		background: #f0fbf4;
	}

	.feeding-fed-amount {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.88rem;
		color: #1d5a3b;
		text-transform: capitalize;
	}

	/* Amount-eaten scale: green → yellow-green → amber → orange → red */
	.feeding-fed-summary-most {
		border-color: #ccd9a2;
		background: #f6fae9;
	}

	.feeding-fed-summary-most .feeding-fed-amount {
		color: #55691c;
	}

	.feeding-fed-summary-half {
		border-color: #e2cc8b;
		background: #fdf8e6;
	}

	.feeding-fed-summary-half .feeding-fed-amount {
		color: #8a6414;
	}

	.feeding-fed-summary-little {
		border-color: #e5b58c;
		background: #fdf0e2;
	}

	.feeding-fed-summary-little .feeding-fed-amount {
		color: #9c531a;
	}

	.feeding-fed-summary-none {
		border-color: #dfa3a3;
		background: #fdeaea;
	}

	.feeding-fed-summary-none .feeding-fed-amount {
		color: #8b2020;
	}

	.feeding-fed-notes {
		font-size: 0.78rem;
		color: #3a5a45;
		font-style: italic;
	}

	.feeding-fed-by {
		font-size: 0.66rem;
		font-family: var(--font-typewriter);
		letter-spacing: 0.06em;
		color: #4d7a5e;
	}

	.feeding-edit-btn {
		min-height: 2rem;
		border: 1px solid #b6d9c2;
		border-radius: 0.22rem;
		background: #ffffff;
		padding: 0.18rem 0.62rem;
		font-family: var(--font-typewriter);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #266741;
	}

	.feeding-inline-edit-actions {
		display: flex;
		gap: 0.4rem;
	}

	.feeding-edit-save-btn {
		flex: 1;
		min-height: 2rem;
		border: 1px solid #7abf98;
		border-radius: 0.22rem;
		background: #edf7f1;
		padding: 0.28rem 0.6rem;
		font-family: var(--font-typewriter);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #266741;
	}

	.feeding-edit-save-btn:disabled {
		opacity: 0.6;
	}

	.feeding-edit-cancel-btn {
		flex: 1;
		min-height: 2rem;
		border: 1px solid #c8d6e0;
		border-radius: 0.22rem;
		background: #f4f7fa;
		padding: 0.28rem 0.6rem;
		font-family: var(--font-typewriter);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.feeding-edit-remove-btn {
		flex: 1;
		min-height: 2rem;
		border: 1px solid #e0a8a8;
		border-radius: 0.22rem;
		background: #fff5f5;
		padding: 0.28rem 0.6rem;
		font-family: var(--font-typewriter);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8b2020;
	}

	.feeding-edit-remove-btn:disabled {
		opacity: 0.6;
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
			grid-auto-flow: column;
			grid-auto-columns: auto;
			align-items: end;
		}

		.meal-switch,
		.mark-all-btn,
		.unmark-all-btn,
		.didnt-eat-btn {
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
			--kennel-row: 5.5rem;
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
