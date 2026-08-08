<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { updateDog, setDogsSickHold, setDogsMonitor } from '$lib/data/dogs';
	import { dogs as dogsStore, dogsLoaded, ensureDogsLoaded, refreshDogs } from '$lib/stores/dogs';
	import { createId } from '$lib/utils/storage';
	import type { Dog, IsolationReason, Treatment } from '$lib/types';
	import { formatDate, toDate } from '$lib/utils/dates';
	import { differenceInDays, startOfDay } from 'date-fns';
	import toast from 'svelte-french-toast';
	import TreatmentEditor from '$lib/components/medical/TreatmentEditor.svelte';
	const today = new Date();

	$: dogs = $dogsStore;
	$: loading = !$dogsLoaded;

	// Surgery form
	let addDogId = '';
	let addDate = today.toISOString().slice(0, 10);
	// Bound to a type="number" input, so Svelte stores it as a number (or null/'' when empty).
	let addRestDays: string | number = '';
	let adding = false;
	let showAddSurgery = false;

	// FortiFlora form
	let ffDogId = '';
	let ffDate = today.toISOString().slice(0, 10);
	let ffDays = '';
	let ffTime: 'am' | 'pm' | 'both' = 'both';
	let addingFf = false;
	let showAddFf = false;

	// Isolation form
	let isoDogId = '';
	let isoReason: 'sick' | 'bite_quarantine' | '' = '';
	let isoDate = today.toISOString().slice(0, 10);
	let isolating = false;
	let showAddIso = false;

	// Treatment form
	let txDogId = '';
	let txCondition = '';
	let txName = '';
	let txNotes = '';
	let txStartDate = today.toISOString().slice(0, 10);
	let txEndDate = '';
	let addingTx = false;
	let showAddTx = false;

	let fleaDogId = '';
	let showAddFleas = false;
	let markingFleas = false;

	// Group update — built for exactly the message staff send: "these dogs are on
	// treatment for URI, these for diarrhea, these are done and on monitor." Pick the
	// dogs (or a whole transfer), name the condition, choose the stage.
	// Outbreak mode — off on a normal day, so the card is just treatment and monitor.
	// Turning it on reveals the sick (red-zone) controls. Kept in localStorage so it
	// survives a reload, and forced on while any dog is still flagged so staff can
	// always clear them.
	const OUTBREAK_KEY = 'medicalOutbreakMode';
	let outbreakMode = false;
	$: outbreakActive = outbreakMode || sickDogs.length > 0;

	function toggleOutbreakMode() {
		outbreakMode = !outbreakMode;
		try {
			if (outbreakMode) localStorage.setItem(OUTBREAK_KEY, '1');
			else localStorage.removeItem(OUTBREAK_KEY);
		} catch {
			/* ignore storage failures */
		}
		if (!outbreakMode && sickDogs.length > 0) {
			toast(`${sickDogs.length} dog${sickDogs.length === 1 ? ' is' : 's are'} still flagged sick.`, {
				icon: '⚠️'
			});
		}
	}

	let groupReason = '';
	let groupMedication = '';
	let groupStage: 'treating' | 'monitor' | 'sick' = 'treating';
	// The group form can't target a stage whose controls are hidden.
	$: if (!outbreakActive && groupStage === 'sick') groupStage = 'treating';
	let showGroupForm = false;
	let savingSickId = '';
	let savingGroup = false;
	let groupCheckedIds: Record<string, boolean> = {};
	let groupOrigin = '';

	const isoReasonOptions: { value: IsolationReason | null; label: string }[] = [
		{ value: null, label: 'ISO' },
		{ value: 'sick', label: 'Sick' },
		{ value: 'bite_quarantine', label: 'Bite' }
	];

	$: eligibleToAdd = dogs
		.filter((d) => d.status === 'active' && !d.surgeryDate)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: eligibleForFf = dogs
		.filter((d) => d.status === 'active' && !d.fortifloraDate)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: eligibleToIsolate = dogs
		.filter((d) => d.status === 'active' && d.isolationStatus === 'none')
		.sort((a, b) => a.name.localeCompare(b.name));

	// A dog can hold multiple treatments, so any active dog can have one added.
	$: eligibleForTx = dogs
		.filter((d) => d.status === 'active')
		.sort((a, b) => a.name.localeCompare(b.name));

	$: eligibleForFleas = dogs
		.filter((d) => d.status === 'active' && !d.hasFleas)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: fleaDogs = dogs
		.filter((d) => d.status === 'active' && d.hasFleas)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: sickDogs = dogs
		.filter((d) => d.status === 'active' && d.sickHold)
		.sort((a, b) => a.name.localeCompare(b.name));

	$: monitorDogs = dogs
		.filter((d) => d.status === 'active' && d.sickMonitor)
		.sort((a, b) => a.name.localeCompare(b.name));

	// All active dogs are batch-selectable — during an outbreak this is how staff mark
	// exactly which dogs are sick, and afterwards how whole groups move to treatment
	// or monitor.
	$: groupEligible = dogs
		.filter((d) => d.status === 'active')
		.sort((a, b) => a.name.localeCompare(b.name));

	// Distinct transfer origins, for one-click group select.
	$: groupOriginOptions = Array.from(
		new Set(groupEligible.map((d) => d.origin?.trim()).filter((o): o is string => !!o))
	).sort((a, b) => a.localeCompare(b));
	$: groupSelectedIds = groupEligible.filter((d) => groupCheckedIds[d.id]).map((d) => d.id);

	function selectGroupOrigin(origin: string) {
		groupOrigin = origin;
		if (!origin) return;
		const next = { ...groupCheckedIds };
		for (const dog of groupEligible) {
			if (dog.origin?.trim() === origin) next[dog.id] = true;
		}
		groupCheckedIds = next;
	}

	$: surgeryDogs = dogs
		.filter((d) => d.status === 'active' && d.surgeryDate !== null)
		.map((d) => {
			const surgeryDateObj = toDate(d.surgeryDate)!;
			const daysAgo = differenceInDays(startOfDay(today), startOfDay(surgeryDateObj));
			const restDays = d.surgeryRestDays ?? 0;
			const daysLeft = Math.max(0, restDays - daysAgo);
			const isToday = daysAgo === 0;
			const isResting = daysAgo >= 0 && daysAgo < restDays;
			return { dog: d, surgeryDateObj, daysAgo, restDays, daysLeft, isToday, isResting };
		})
		.sort((a, b) => {
			if (a.isResting && !b.isResting) return -1;
			if (!a.isResting && b.isResting) return 1;
			if (a.isResting && b.isResting) return b.daysLeft - a.daysLeft;
			if (a.isToday && !b.isToday) return -1;
			if (!a.isToday && b.isToday) return 1;
			return a.daysAgo - b.daysAgo;
		});

	$: fortifloraDogs = dogs
		.filter((d) => d.status === 'active' && d.fortifloraDate !== null)
		.map((d) => {
			const startObj = toDate(d.fortifloraDate)!;
			const daysAgo = differenceInDays(startOfDay(today), startOfDay(startObj));
			const totalDays = d.fortifloraDays ?? 0;
			const daysLeft = Math.max(0, totalDays - daysAgo);
			const isActive = daysAgo >= 0 && daysAgo < totalDays;
			return { dog: d, startObj, daysAgo, totalDays, daysLeft, isActive };
		})
		.sort((a, b) => {
			if (a.isActive && !b.isActive) return -1;
			if (!a.isActive && b.isActive) return 1;
			if (a.isActive && b.isActive) return b.daysLeft - a.daysLeft;
			return a.daysAgo - b.daysAgo;
		});

	$: isolatedDogs = dogs
		.filter((d) => d.status === 'active' && d.isolationStatus !== 'none')
		.map((d) => {
			const until = toDate(d.isolationUntilDate ?? null);
			const daysLeft = until ? differenceInDays(startOfDay(until), startOfDay(today)) : null;
			return { dog: d, daysLeft };
		})
		.sort((a, b) => {
			if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
			if (a.daysLeft !== null) return -1;
			if (b.daysLeft !== null) return 1;
			return a.dog.name.localeCompare(b.dog.name);
		});

	$: treatmentDogs = dogs
		.filter((d) => d.status === 'active' && (d.treatments?.length ?? 0) > 0)
		.map((d) => ({
			dog: d,
			treatments: (d.treatments ?? []).map((t) => {
				const endDate = toDate(t.endDate ?? null);
				const daysLeft = endDate ? differenceInDays(startOfDay(endDate), startOfDay(today)) : null;
				return { t, daysLeft };
			})
		}))
		.sort((a, b) => a.dog.name.localeCompare(b.dog.name));

	// The Treatment card is ONE list: every unwell dog appears once with a stage.
	// Sick (outbreak) trumps treating trumps monitor; the pipeline reads
	// monitor → treating, so the list sorts sick, monitor, treating, then name.
	const STAGE_ORDER: Record<string, number> = { sick: 0, monitor: 1, treating: 2 };
	$: illDogs = dogs
		.filter(
			(d) =>
				d.status === 'active' && (d.sickHold || d.sickMonitor || (d.treatments?.length ?? 0) > 0)
		)
		.map((d) => ({
			dog: d,
			stage: d.sickHold ? 'sick' : (d.treatments?.length ?? 0) > 0 ? 'treating' : 'monitor',
			treatments: (d.treatments ?? []).map((t) => {
				const endDate = toDate(t.endDate ?? null);
				const daysLeft = endDate ? differenceInDays(startOfDay(endDate), startOfDay(today)) : null;
				return { t, daysLeft };
			})
		}))
		.sort(
			(a, b) =>
				STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.dog.name.localeCompare(b.dog.name)
		);

	function treatmentNames(dog: Dog): string | null {
		return (dog.treatments ?? []).map((t) => t.name).join(', ') || null;
	}

	// Inline treatment editing — a treatment is often logged in a hurry, so every part of
	// it (reason, medication, dates, notes) stays editable from its row, as does removing it.
	let editingTxId = '';
	let editingTxFocus: 'condition' | 'name' = 'name';
	let savingTx = false;

	function startEditTreatment(t: Treatment, focus: 'condition' | 'name' = 'name') {
		editingTxId = t.id;
		editingTxFocus = focus;
	}

	function cancelEditTreatment() {
		editingTxId = '';
	}

	async function saveTreatmentEdit(
		dog: Dog,
		treatmentId: string,
		detail: { condition: string | null; name: string; startDate: string; endDate: string; notes: string | null }
	) {
		savingTx = true;
		const next = (dog.treatments ?? []).map((t) =>
			t.id === treatmentId
				? {
						...t,
						condition: detail.condition,
						name: detail.name,
						startDate: detail.startDate ? new Date(detail.startDate + 'T12:00:00') : null,
						endDate: detail.endDate ? new Date(detail.endDate + 'T12:00:00') : null,
						notes: detail.notes
					}
				: t
		);
		try {
			await updateDog(dog.id, { treatments: next });
			await refreshDogs();
			cancelEditTreatment();
			toast.success(`${dog.name}'s treatment updated.`);
		} catch {
			toast.error(`Could not update ${dog.name}'s treatment.`);
			await refreshDogs();
		} finally {
			savingTx = false;
		}
	}

	// A treatment logged with only a reason stores that reason as its name too, so the
	// two matching means nobody has recorded what the dog is actually being given.
	function needsMedication(t: Treatment): boolean {
		const condition = t.condition?.trim();
		return !!condition && t.name.trim().toLowerCase() === condition.toLowerCase();
	}

	// What the dog is being treated FOR, as opposed to what they're being given.
	// Older records have no condition, so this can be empty even with treatments.
	function treatmentConditions(dog: Dog): string[] {
		const seen = new Set<string>();
		for (const t of dog.treatments ?? []) {
			const condition = t.condition?.trim();
			if (condition) seen.add(condition);
		}
		return [...seen];
	}


	// One dropdown per row drives all stage moves. "Treating" with no meds yet just
	// opens the prefilled treatment form — the stage flips once the med is added.
	// Monitor is a care state (watching, no meds) — turning it on finishes any treatment,
	// since a dog is either being medicated or being watched.
	async function toggleMonitor(dog: Dog) {
		savingSickId = dog.id;
		try {
			if (dog.sickMonitor) {
				await setDogsMonitor([dog.id], false);
				toast.success(`${dog.name} off monitor.`);
			} else {
				const reason =
					treatmentConditions(dog).join(', ') || treatmentNames(dog) || dog.sickHoldReason || null;
				if ((dog.treatments?.length ?? 0) > 0) await updateDog(dog.id, { treatments: [] });
				await setDogsMonitor([dog.id], true, reason);
				toast.success(`${dog.name} on monitor.`);
			}
			await refreshDogs();
		} catch {
			toast.error(`Could not update ${dog.name}.`);
			await refreshDogs();
		} finally {
			savingSickId = '';
		}
	}

	// Sick is the outbreak flag — independent of treatment. It red-zones the dog on the
	// kennel maps and blocks playgroups/day-trips/yard until cleared.
	async function toggleSick(dog: Dog) {
		savingSickId = dog.id;
		try {
			if (dog.sickHold) {
				await setDogsSickHold([dog.id], false);
				toast.success(`${dog.name} no longer flagged sick.`);
			} else {
				await setDogsSickHold(
					[dog.id],
					true,
					treatmentConditions(dog).join(', ') || treatmentNames(dog) || dog.sickMonitorReason
				);
				toast.success(`${dog.name} flagged sick.`);
			}
			await refreshDogs();
		} catch {
			toast.error(`Could not update ${dog.name}.`);
			await refreshDogs();
		} finally {
			savingSickId = '';
		}
	}

	async function addToSurgery() {
		if (!addDogId || !addDate) return;
		adding = true;
		try {
			const restDays = addRestDays === '' || addRestDays == null ? null : Number(addRestDays);
			await updateDog(addDogId, {
				surgeryDate: new Date(addDate + 'T12:00:00'),
				surgeryRestDays: restDays != null && Number.isFinite(restDays) && restDays >= 0 ? restDays : null
			});
			await refreshDogs();
			addDogId = '';
			addDate = new Date().toISOString().slice(0, 10);
			addRestDays = '';
			showAddSurgery = false;
			toast.success('Added to surgery list.');
		} catch (error) {
			console.error('addToSurgery failed:', error);
			toast.error('Could not add to surgery list.');
		} finally {
			adding = false;
		}
	}

	async function clearSurgery(dog: Dog) {
		try {
			await updateDog(dog.id, { lastSurgeryDate: dog.surgeryDate, surgeryDate: null, surgeryRestDays: null });
			await refreshDogs();
			toast.success(`${dog.name} cleared from surgery list.`);
		} catch (error) {
			console.error('clearSurgery failed:', error);
			toast.error('Could not clear surgery record.');
		}
	}

	async function addToFortiflora() {
		if (!ffDogId || !ffDate) return;
		addingFf = true;
		try {
			const days = ffDays ? Number(ffDays) : null;
			await updateDog(ffDogId, {
				fortifloraDate: new Date(ffDate + 'T12:00:00'),
				fortifloraDays: Number.isFinite(days) && days! > 0 ? days : null,
				fortifloraTime: ffTime
			});
			await refreshDogs();
			ffDogId = '';
			ffDate = today.toISOString().slice(0, 10);
			ffDays = '';
			ffTime = 'both';
			showAddFf = false;
			toast.success('Added to FortiFlora list.');
		} catch (error) {
			console.error('FortiFlora add failed:', error);
			toast.error('Could not add to FortiFlora list.');
		} finally {
			addingFf = false;
		}
	}

	async function clearFortiflora(dog: Dog) {
		try {
			await updateDog(dog.id, { fortifloraDate: null, fortifloraDays: null, fortifloraTime: null });
			await refreshDogs();
			toast.success(`${dog.name} cleared from FortiFlora list.`);
		} catch {
			toast.error('Could not clear FortiFlora record.');
		}
	}

	async function applyGroup() {
		if (groupSelectedIds.length === 0 || savingGroup) return;
		const reason = groupReason.trim() || null;
		if (groupStage === 'treating' && !reason) {
			toast.error('Name the condition the group is being treated for.');
			return;
		}
		savingGroup = true;
		const ids = groupSelectedIds;
		try {
			if (groupStage === 'sick') {
				await setDogsSickHold(ids, true, reason);
			} else if (groupStage === 'monitor') {
				await setDogsMonitor(ids, true, reason);
			} else {
				// "On treatment for URI" — the condition is what they're being treated for;
				// the medication is optional (staff often record it later).
				const medication = groupMedication.trim();
				await Promise.all(
					ids.map((id) => {
						const dog = dogs.find((d) => d.id === id);
						const entry: Treatment = {
							id: createId('tx'),
							name: medication || reason!,
							condition: reason,
							notes: null,
							startDate: new Date(),
							endDate: null
						};
						return updateDog(id, { treatments: [...(dog?.treatments ?? []), entry] });
					})
				);
				// Treatment is the step after monitor — the watch ends when meds start.
				await setDogsMonitor(ids, false);
			}
			await refreshDogs();
			groupCheckedIds = {};
			groupOrigin = '';
			groupReason = '';
			groupMedication = '';
			showGroupForm = false;
			const label =
				groupStage === 'sick'
					? 'marked sick'
					: groupStage === 'monitor'
						? 'put on monitor'
						: `on treatment for ${reason}`;
			toast.success(`${ids.length} dog${ids.length === 1 ? '' : 's'} ${label}.`);
		} catch {
			toast.error('Could not update the group.');
			await refreshDogs();
		} finally {
			savingGroup = false;
		}
	}

	// Opens the add-treatment form prefilled for a monitored dog that got worse.
	function startTreatment(dog: Dog) {
		txDogId = dog.id;
		showAddTx = true;
	}

	async function markFleas() {
		if (!fleaDogId) return;
		markingFleas = true;
		try {
			await updateDog(fleaDogId, { hasFleas: true });
			await refreshDogs();
			fleaDogId = '';
			showAddFleas = false;
			toast.success('Marked as having fleas.');
		} catch {
			toast.error('Could not mark fleas.');
		} finally {
			markingFleas = false;
		}
	}

	async function clearFleas(dog: Dog) {
		try {
			await updateDog(dog.id, { hasFleas: false });
			await refreshDogs();
			toast.success(`${dog.name} cleared of fleas.`);
		} catch {
			toast.error('Could not clear fleas.');
		}
	}

	async function putInIsolation() {
		if (!isoDogId) return;
		isolating = true;
		try {
			await updateDog(isoDogId, {
				isolationStatus: 'iso',
				isolationReason: isoReason || null,
				isolationUntilDate: new Date(isoDate + 'T12:00:00')
			});
			await refreshDogs();
			isoDogId = '';
			isoReason = '';
			isoDate = today.toISOString().slice(0, 10);
			showAddIso = false;
			toast.success('Dog added to isolation.');
		} catch {
			toast.error('Could not update isolation status.');
		} finally {
			isolating = false;
		}
	}

	async function clearIsolation(dog: Dog) {
		try {
			await updateDog(dog.id, { isolationStatus: 'none', isolationUntilDate: null });
			await refreshDogs();
			toast.success(`${dog.name} cleared from isolation.`);
		} catch {
			toast.error('Could not clear isolation.');
		}
	}

	async function updateIsoDate(dog: Dog, dateStr: string) {
		if (!dateStr) return;
		try {
			await updateDog(dog.id, { isolationUntilDate: new Date(dateStr + 'T12:00:00') });
			await refreshDogs();
		} catch {
			toast.error('Could not update isolation date.');
		}
	}

	function isoDateValue(dog: Dog): string {
		const d = toDate(dog.isolationUntilDate ?? null);
		return d ? d.toISOString().slice(0, 10) : '';
	}

	async function addTreatment() {
		if (!txDogId || !(txName.trim() || txCondition.trim())) return;
		addingTx = true;
		try {
			const dog = dogs.find((d) => d.id === txDogId);
			const newTreatment: Treatment = {
				id: createId('tx'),
				name: txName.trim() || txCondition.trim(),
				condition: txCondition.trim() || null,
				notes: txNotes.trim() || null,
				startDate: new Date(txStartDate + 'T12:00:00'),
				endDate: txEndDate ? new Date(txEndDate + 'T12:00:00') : null
			};
			await updateDog(txDogId, {
				treatments: [...(dog?.treatments ?? []), newTreatment]
			});
			// Monitor is the step before treatment — starting treatment ends the watch.
			if (dog?.sickMonitor) await setDogsMonitor([dog.id], false);
			await refreshDogs();
			txDogId = '';
			txCondition = '';
			txName = '';
			txNotes = '';
			txStartDate = today.toISOString().slice(0, 10);
			txEndDate = '';
			showAddTx = false;
			toast.success('Added to treatment list.');
		} catch {
			toast.error('Could not add treatment.');
		} finally {
			addingTx = false;
		}
	}

	async function removeTreatment(dog: Dog, treatmentId: string) {
		try {
			await updateDog(dog.id, {
				treatments: (dog.treatments ?? []).filter((t) => t.id !== treatmentId)
			});
			await refreshDogs();
			toast.success(`Treatment removed for ${dog.name}.`);
		} catch {
			toast.error('Could not remove treatment.');
		}
	}

	async function autoClearExpiredIsolations() {
		const expired = dogs.filter((d) => {
			if (d.status !== 'active' || d.isolationStatus === 'none') return false;
			const until = toDate(d.isolationUntilDate ?? null);
			if (!until) return false;
			return differenceInDays(startOfDay(today), startOfDay(until)) > 0;
		});
		if (expired.length === 0) return;
		await Promise.all(
			expired.map((d) => updateDog(d.id, { isolationStatus: 'none', isolationUntilDate: null }))
		);
		await refreshDogs();
		toast.success(`Isolation cleared: ${expired.map((d) => d.name).join(', ')}`);
	}

	async function autoClearExpiredTreatments() {
		const isExpired = (t: Treatment) => {
			const end = toDate(t.endDate ?? null);
			return end ? differenceInDays(startOfDay(today), startOfDay(end)) > 0 : false;
		};
		const updates = dogs
			.filter((d) => d.status === 'active' && (d.treatments?.length ?? 0) > 0)
			.map((d) => {
				const kept = (d.treatments ?? []).filter((t) => !isExpired(t));
				const removed = (d.treatments ?? []).filter((t) => isExpired(t));
				return { dog: d, kept, removed };
			})
			.filter((u) => u.removed.length > 0);
		if (updates.length === 0) return;
		await Promise.all(updates.map((u) => updateDog(u.dog.id, { treatments: u.kept })));
		await refreshDogs();
		const label = updates
			.map((u) => `${u.dog.name} (${u.removed.map((t) => t.name).join(', ')})`)
			.join('; ');
		toast.success(`Treatment cleared: ${label}`);
	}

	// Dog data, the ASM-sync re-fetch, and post-mutation refreshes all flow through
	// the shared dog store ($lib/stores/dogs); `refreshDogs` is its force-refresh.

	onMount(async () => {
		try {
			outbreakMode = localStorage.getItem(OUTBREAK_KEY) === '1';
		} catch {
			/* ignore */
		}
		await ensureDogsLoaded();
		await autoClearExpiredIsolations();
		await autoClearExpiredTreatments();
	});
</script>

<svelte:head>
	<title>Medical | Cache Humane Society</title>
</svelte:head>

<section class="med-dashboard">
	<header class="med-head">
		<p class="med-kicker typewriter">Cache Humane Society</p>
		<h1 class="med-title">Medical</h1>
		{#if !loading}
			<div class="med-chips typewriter">
				<span class="med-chip med-chip-rose">ISO {isolatedDogs.length}</span>
				<span class="med-chip med-chip-amber">Surgery {surgeryDogs.length}</span>
				<span class="med-chip med-chip-sage">FortiFlora {fortifloraDogs.length}</span>
				<span class="med-chip med-chip-lilac">Care {illDogs.length}</span>
				{#if sickDogs.length > 0}
					<span class="med-chip med-chip-rose">Sick {sickDogs.length}</span>
				{/if}
				{#if monitorDogs.length > 0}
					<span class="med-chip med-chip-sage">Monitor {monitorDogs.length}</span>
				{/if}
			</div>
		{/if}
	</header>

	{#if loading}
		<p class="med-loading">Loading…</p>
	{:else}
		<div class="med-columns">

			<!-- Isolation (rose) -->
			<section class="med-card med-card-rose">
				<div class="med-card-head">
					<h2>Isolation</h2>
					<div class="med-head-right">
						<span class="med-pill med-pill-rose">{isolatedDogs.length}</span>
						<button
							class="med-add-toggle {showAddIso ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddIso = !showAddIso)}
							aria-label="Add to isolation"
						>+</button>
					</div>
				</div>

				{#if showAddIso}
					<form class="med-form" on:submit|preventDefault={putInIsolation}>
						<select class="med-input med-input-grow" bind:value={isoDogId} required>
							<option value="" disabled>Dog…</option>
							{#each eligibleToIsolate as dog}
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
						<select class="med-input" bind:value={isoReason}>
							<option value="">ISO</option>
							<option value="sick">Sick</option>
							<option value="bite_quarantine">Bite</option>
						</select>
						<input class="med-input" type="date" bind:value={isoDate} required />
						<button class="med-submit typewriter" type="submit" disabled={isolating || !isoDogId}>
							{isolating ? '…' : 'Add'}
						</button>
					</form>
				{/if}

				<div class="med-items">
					{#if isolatedDogs.length === 0}
						<p class="med-empty">No dogs in isolation.</p>
					{:else}
						{#each isolatedDogs as { dog, daysLeft }}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									<div class="med-row-sub">
										<span class="med-label">Until</span>
										<input
											class="med-date-inline"
											type="date"
											value={isoDateValue(dog)}
											on:change={(e) => updateIsoDate(dog, e.currentTarget.value)}
										/>
										{#if daysLeft !== null}
											<span class="med-tag {daysLeft === 0 ? 'med-tag-warn' : 'med-tag-info'}">
												{daysLeft === 0 ? 'Last day' : `${daysLeft}d`}
											</span>
										{/if}
									</div>
									<div class="med-reason-row">
										{#each isoReasonOptions as opt}
											<button
												class="med-reason-btn {(dog.isolationReason ?? null) === opt.value ? 'med-reason-active' : ''}"
												type="button"
												on:click={() =>
													updateDog(dog.id, { isolationReason: opt.value }).then(() => refreshDogs())}
											>{opt.label}</button>
										{/each}
									</div>
								</div>
								<button class="med-clear typewriter" type="button" on:click={() => clearIsolation(dog)}>Clear</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- Surgery (amber) -->
			<section class="med-card med-card-amber">
				<div class="med-card-head">
					<h2>Surgery</h2>
					<div class="med-head-right">
						<span class="med-pill med-pill-amber">{surgeryDogs.length}</span>
						<button
							class="med-add-toggle {showAddSurgery ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddSurgery = !showAddSurgery)}
							aria-label="Add to surgery list"
						>+</button>
					</div>
				</div>

				{#if showAddSurgery}
					<form class="med-form" on:submit|preventDefault={addToSurgery}>
						<select class="med-input med-input-grow" bind:value={addDogId} required>
							<option value="" disabled>Dog…</option>
							{#each eligibleToAdd as dog}
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
						<input class="med-input" type="date" bind:value={addDate} required />
						<input class="med-input med-input-sm" type="number" min="0" max="60" placeholder="Rest days" bind:value={addRestDays} />
						<button class="med-submit typewriter" type="submit" disabled={adding || !addDogId}>
							{adding ? '…' : 'Add'}
						</button>
					</form>
				{/if}

				<div class="med-items">
					{#if surgeryDogs.length === 0}
						<p class="med-empty">No dogs on the surgery list.</p>
					{:else}
						{#each surgeryDogs as { dog, surgeryDateObj, daysAgo, daysLeft, isToday, isResting }}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									<div class="med-row-sub">
										<span class="med-meta">{formatDate(surgeryDateObj)}</span>
										{#if isToday && (dog.surgeryRestDays ?? 0) === 0}
											<span class="med-tag med-tag-warn">Surgery today</span>
										{:else if isToday}
											<span class="med-tag med-tag-warn">Day 0 · {dog.surgeryRestDays}d rest</span>
										{:else if isResting}
											<span class="med-tag med-tag-info">{daysLeft}d left</span>
										{:else}
											<span class="med-tag med-tag-done">Rest complete</span>
										{/if}
									</div>
								</div>
								<button class="med-clear typewriter" type="button" on:click={() => clearSurgery(dog)}>Clear</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- FortiFlora (sage) -->
			<section class="med-card med-card-sage">
				<div class="med-card-head">
					<h2>FortiFlora</h2>
					<div class="med-head-right">
						<span class="med-pill med-pill-sage">{fortifloraDogs.length}</span>
						<button
							class="med-add-toggle {showAddFf ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddFf = !showAddFf)}
							aria-label="Add to FortiFlora list"
						>+</button>
					</div>
				</div>

				{#if showAddFf}
					<form class="med-form" on:submit|preventDefault={addToFortiflora}>
						<select class="med-input med-input-grow" bind:value={ffDogId} required>
							<option value="" disabled>Dog…</option>
							{#each eligibleForFf as dog}
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
						<input class="med-input" type="date" bind:value={ffDate} required />
						<input class="med-input med-input-sm" type="number" min="1" max="60" placeholder="Days" bind:value={ffDays} />
						<select class="med-input" bind:value={ffTime}>
							<option value="both">AM + PM</option>
							<option value="am">AM only</option>
							<option value="pm">PM only</option>
						</select>
						<button class="med-submit typewriter" type="submit" disabled={addingFf || !ffDogId}>
							{addingFf ? '…' : 'Add'}
						</button>
					</form>
				{/if}

				<div class="med-items">
					{#if fortifloraDogs.length === 0}
						<p class="med-empty">No dogs on FortiFlora.</p>
					{:else}
						{#each fortifloraDogs as { dog, startObj, daysLeft, isActive }}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									<div class="med-row-sub">
										<span class="med-meta">
											Since {formatDate(startObj)}{dog.fortifloraTime && dog.fortifloraTime !== 'both'
												? ` · ${dog.fortifloraTime.toUpperCase()}`
												: ''}
										</span>
										{#if isActive}
											<span class="med-tag med-tag-info">{daysLeft}d left</span>
										{:else}
											<span class="med-tag med-tag-done">Complete</span>
										{/if}
									</div>
								</div>
								<button class="med-clear typewriter" type="button" on:click={() => clearFortiflora(dog)}>Clear</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- Treatment (lilac) -->
			<section class="med-card med-card-lilac">
				<div class="med-card-head">
					<h2>Under Care</h2>
					<div class="med-head-right">
						{#if sickDogs.length > 0}
							<span class="med-pill med-pill-rose">{sickDogs.length} sick</span>
						{/if}
						<span class="med-pill med-pill-lilac">{treatmentDogs.length}</span>
						<button
							class="med-outbreak-toggle {outbreakActive ? 'med-outbreak-toggle-open' : ''}"
							type="button"
							aria-pressed={outbreakActive}
							title={outbreakActive
								? 'Turn off outbreak mode — hides the sick controls'
								: 'Turn on outbreak mode — adds the sick (red zone) controls'}
							on:click={toggleOutbreakMode}
						>Outbreak</button>
						<button
							class="med-group-toggle {showGroupForm ? 'med-group-toggle-open' : ''}"
							type="button"
							title="Update a whole group of dogs at once"
							on:click={() => (showGroupForm = !showGroupForm)}
						>Update group</button>
						<button
							class="med-add-toggle {showAddTx ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddTx = !showAddTx)}
							aria-label="Add a treatment"
						>+</button>
					</div>
				</div>

				{#if showAddTx}
					<form class="med-form med-form-stack" on:submit|preventDefault={addTreatment}>
						<div class="med-form-row">
							<select class="med-input med-input-grow" bind:value={txDogId} required>
								<option value="" disabled>Dog…</option>
								{#each eligibleForTx as dog}
									<option value={dog.id}>{dog.name}</option>
								{/each}
							</select>
							<input
								class="med-input med-input-grow"
								type="text"
								placeholder="Reason (e.g. URI)"
								bind:value={txCondition}
							/>
							<input
								class="med-input med-input-grow"
								type="text"
								placeholder="Medication (optional)"
								bind:value={txName}
							/>
						</div>
						<div class="med-form-row">
							<input class="med-input" type="date" bind:value={txStartDate} required />
							<input class="med-input" type="date" placeholder="End date (opt.)" bind:value={txEndDate} />
							<button class="med-submit typewriter" type="submit" disabled={addingTx || !txDogId || !(txName.trim() || txCondition.trim())}>
								{addingTx ? '…' : 'Add'}
							</button>
						</div>
						<input
							class="med-input med-input-full"
							type="text"
							placeholder="Notes (optional)"
							bind:value={txNotes}
						/>
					</form>
				{/if}

				{#if showGroupForm}
					<form class="med-form med-form-stack" on:submit|preventDefault={applyGroup}>
						<div class="med-form-row">
							<select
								class="med-input med-input-grow"
								value={groupOrigin}
								on:change={(e) => selectGroupOrigin(e.currentTarget.value)}
							>
								<option value="">Select a whole transfer…</option>
								{#each groupOriginOptions as origin}
									<option value={origin}>{origin}</option>
								{/each}
							</select>
							<button
								class="med-clear typewriter"
								type="button"
								on:click={() => ((groupCheckedIds = {}), (groupOrigin = ''))}
							>Clear</button>
						</div>
						<div class="med-check-list">
							{#each groupEligible as dog (dog.id)}
								<label class="med-check">
									<input
										type="checkbox"
										checked={!!groupCheckedIds[dog.id]}
										on:change={(e) => (groupCheckedIds = { ...groupCheckedIds, [dog.id]: e.currentTarget.checked })}
									/>
									<span>{dog.name}</span>
									{#if dog.sickHold}<span class="med-check-tag med-check-tag-sick">sick</span>
									{:else if (dog.treatments?.length ?? 0) > 0}<span class="med-check-tag med-check-tag-tx">tx</span>
									{:else if dog.sickMonitor}<span class="med-check-tag">monitor</span>{/if}
									{#if dog.origin?.trim()}<span class="med-check-origin">{dog.origin.trim()}</span>{/if}
								</label>
							{/each}
						</div>
						<div class="med-form-row">
							<input
								class="med-input med-input-grow"
								type="text"
								placeholder="Reason (e.g. URI, diarrhea)"
								bind:value={groupReason}
							/>
							{#if groupStage === 'treating'}
								<input
									class="med-input med-input-grow"
									type="text"
									placeholder="Medication (optional)"
									bind:value={groupMedication}
								/>
							{/if}
							<select class="med-input" bind:value={groupStage}>
								<option value="treating">Start treatment</option>
								<option value="monitor">Put on monitor</option>
								{#if outbreakActive}
									<option value="sick">Flag sick (outbreak)</option>
								{/if}
							</select>
							<button
								class="med-submit typewriter"
								type="submit"
								disabled={savingGroup || groupSelectedIds.length === 0}
							>
								{savingGroup ? '…' : `Apply to ${groupSelectedIds.length || '…'}`}
							</button>
						</div>
						<p class="med-hint">"These six are on treatment for URI" → check the dogs, type URI, start treatment. Monitor means watching without meds.{#if outbreakActive} Flagging sick makes dogs staff-only and blocks playgroups, day-trips and yard.{/if}</p>
					</form>
				{/if}

				<div class="med-items">
					{#if illDogs.length === 0}
						<p class="med-empty">No dogs under care.</p>
					{:else}
						{#each illDogs as { dog, stage, treatments } (dog.id)}
							{@const storedReason = dog.sickHoldReason ?? dog.sickMonitorReason ?? null}
							{@const conditions = treatmentConditions(dog)}
							<!-- The reason is the condition; the treatments below are the medications.
							     Records with no condition fall back to the treatment name itself. -->
							{@const reason = storedReason ?? (conditions.join(', ') || treatmentNames(dog))}
							<!-- When the reason IS one of the treatments, that treatment's detail rides on
							     the reason line instead of repeating the name underneath. -->
							{@const inlineTx = treatments.find(
								({ t }) => t.name.trim().toLowerCase() === (reason ?? '').trim().toLowerCase()
							) ?? null}
							{@const restTx = inlineTx ? treatments.filter((row) => row !== inlineTx) : treatments}
							<!-- A reason derived from several treatment NAMES would just repeat the list
							     below it; conditions are separate information, so they always show. -->
							{@const showReason =
								!!reason && (!!storedReason || conditions.length > 0 || !!inlineTx)}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									{#if stage !== 'treating' || inlineTx || conditions.length > 0}
										<div class="med-meta-row">
											{#if showReason}
												<span class="med-field-label">Reason</span>
												<span class="med-meta">{reason}</span>
											{:else if treatments.length === 0}
												<span class="med-field-label">Reason</span>
												<span class="med-meta med-meta-soft">not recorded</span>
											{/if}
											{#if inlineTx && inlineTx.daysLeft !== null}
												<span class="med-tag {inlineTx.daysLeft <= 0 ? 'med-tag-done' : 'med-tag-info'}">
													{inlineTx.daysLeft > 0 ? `${inlineTx.daysLeft}d left` : 'Last day'}
												</span>
											{/if}
											{#if stage === 'sick' && dog.sickHoldSince}
												<span class="med-meta med-meta-soft">since {formatDate(dog.sickHoldSince)}</span>
											{:else if stage === 'monitor' && dog.sickMonitorSince}
												<span class="med-meta med-meta-soft">since {formatDate(dog.sickMonitorSince)}</span>
											{/if}
											{#if inlineTx && editingTxId !== inlineTx.t.id}
												{#if !inlineTx.t.condition}
													<button
														class="med-reason-add"
														type="button"
														on:click={() => startEditTreatment(inlineTx.t, 'condition')}
													>+ reason</button>
												{:else if needsMedication(inlineTx.t) && !dog.sickMonitor}
													<button
														class="med-reason-add"
														type="button"
														on:click={() => startEditTreatment(inlineTx.t, 'name')}
													>+ medication</button>
												{/if}
												<button
													class="med-tx-edit"
													type="button"
													aria-label="Edit {inlineTx.t.name}"
													on:click={() => startEditTreatment(inlineTx.t)}
												>Edit</button>
											{/if}
										</div>
										{#if inlineTx && editingTxId === inlineTx.t.id}
											<TreatmentEditor
												treatment={inlineTx.t}
												focusField={editingTxFocus}
												saving={savingTx}
												on:save={(e) => saveTreatmentEdit(dog, inlineTx.t.id, e.detail)}
												on:cancel={cancelEditTreatment}
												on:remove={() => (cancelEditTreatment(), removeTreatment(dog, inlineTx.t.id))}
											/>
										{/if}
										{#if inlineTx?.t.notes}
											<p class="med-notes">{inlineTx.t.notes}</p>
										{/if}
									{/if}
									{#if restTx.length > 0}
										<div class="med-tx-list">
											{#each restTx as { t, daysLeft }}
												<div class="med-tx-item">
													{#if editingTxId === t.id}
														<TreatmentEditor
															treatment={t}
															focusField={editingTxFocus}
															saving={savingTx}
															on:save={(e) => saveTreatmentEdit(dog, t.id, e.detail)}
															on:cancel={cancelEditTreatment}
															on:remove={() => (cancelEditTreatment(), removeTreatment(dog, t.id))}
														/>
													{:else}
														<div class="med-tx-line">
															<span class="med-field-label">{needsMedication(t) ? 'Reason' : 'Med'}</span>
															<button
																class="med-tx-name"
																type="button"
																title="Edit treatment"
																on:click={() => startEditTreatment(t)}
															>{t.name}</button>
															{#if !t.condition}
																<button
																	class="med-reason-add"
																	type="button"
																	on:click={() => startEditTreatment(t, 'condition')}
																>+ reason</button>
															{:else if needsMedication(t) && !dog.sickMonitor}
																<button
																	class="med-reason-add"
																	type="button"
																	on:click={() => startEditTreatment(t, 'name')}
																>+ medication</button>
															{:else if conditions.length > 1}
																<!-- Which condition this med is for, when the dog has more than one. -->
																<button
																	class="med-reason-edit"
																	type="button"
																	title="Edit reason"
																	on:click={() => startEditTreatment(t, 'condition')}
																>for {t.condition}</button>
															{/if}
															{#if daysLeft !== null}
																<span class="med-tag {daysLeft <= 0 ? 'med-tag-done' : 'med-tag-info'}">
																	{daysLeft > 0 ? `${daysLeft}d left` : 'Last day'}
																</span>
															{/if}
															<button
																class="med-tx-remove"
																type="button"
																aria-label="Remove {t.name}"
																on:click={() => removeTreatment(dog, t.id)}
															>×</button>
														</div>
														{#if t.notes}
															<p class="med-notes">{t.notes}</p>
														{/if}
													{/if}
												</div>
											{/each}
										</div>
									{/if}
								</div>
								<div class="med-switches">
									<button
										type="button"
										class="med-switch {dog.sickMonitor ? 'med-switch-on-monitor' : ''}"
										disabled={savingSickId === dog.id}
										aria-pressed={!!dog.sickMonitor}
										title={dog.sickMonitor ? 'Stop watching' : 'Watch — no meds'}
										on:click={() => toggleMonitor(dog)}
									>Monitor</button>
									{#if outbreakActive}
										<button
											type="button"
											class="med-switch {dog.sickHold ? 'med-switch-on-sick' : ''}"
											disabled={savingSickId === dog.id}
											aria-pressed={!!dog.sickHold}
											title={dog.sickHold ? 'Clear the outbreak flag' : 'Flag sick — staff-only, no playgroups or trips'}
											on:click={() => toggleSick(dog)}
										>Sick</button>
									{/if}
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- Fleas (amber) -->
			<section class="med-card med-card-amber">
				<div class="med-card-head">
					<h2>Fleas</h2>
					<div class="med-head-right">
						<span class="med-pill med-pill-amber">{fleaDogs.length}</span>
						<button
							class="med-add-toggle {showAddFleas ? 'med-add-toggle-open' : ''}"
							type="button"
							on:click={() => (showAddFleas = !showAddFleas)}
							aria-label="Mark a dog as having fleas"
						>+</button>
					</div>
				</div>

				{#if showAddFleas}
					<form class="med-form" on:submit|preventDefault={markFleas}>
						<select class="med-input med-input-grow" bind:value={fleaDogId} required>
							<option value="" disabled>Dog…</option>
							{#each eligibleForFleas as dog}
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
						<button class="med-submit typewriter" type="submit" disabled={markingFleas || !fleaDogId}>
							{markingFleas ? '…' : 'Mark'}
						</button>
					</form>
				{/if}

				<div class="med-items">
					{#if fleaDogs.length === 0}
						<p class="med-empty">No dogs marked with fleas.</p>
					{:else}
						{#each fleaDogs as dog (dog.id)}
							<div class="med-row">
								<div class="med-row-body">
									<button class="med-dog-link" on:click={() => goto(`/dogs/${dog.id}`)}>
										{dog.name}
										{#if dog.outdoorKennelAssignment}
											<span class="med-kennel">· K{dog.outdoorKennelAssignment}</span>
										{/if}
									</button>
									<div class="med-row-sub">
										<span class="med-tag med-tag-info">Buffer kennels on inside map</span>
									</div>
								</div>
								<button class="med-clear typewriter" type="button" on:click={() => clearFleas(dog)}>Clear</button>
							</div>
						{/each}
					{/if}
				</div>
			</section>

		</div>
	{/if}
</section>

<style>
	.med-dashboard {
		padding: 0.66rem 0.66rem 0.84rem;
		border-radius: 1rem;
		background:
			radial-gradient(40rem 20rem at 100% -25%, rgba(57, 142, 193, 0.05) 0%, transparent 62%),
			linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%);
	}

	.med-head {
		margin-bottom: 0.8rem;
		padding: 0 0.1rem;
	}

	.med-kicker {
		margin: 0 0 0.2rem;
		font-size: 0.6rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #cf4b4b;
	}

	.med-title {
		margin: 0 0 0.5rem;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.6rem, 3.5vw, 2.4rem);
		font-weight: 500;
		line-height: 1.04;
		color: #2e3845;
	}

	.med-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.med-chip {
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

	.med-chip-rose  { background: #fce8ed; color: #a03050; border-color: #e8a0b8; }
	.med-chip-amber { background: #fef0d8; color: #7a5010; border-color: #e8c880; }
	.med-chip-sage  { background: #e4f2e4; color: #2e6c30; border-color: #9ccf9e; }
	.med-chip-lilac { background: #f0ebf8; color: #6030a0; border-color: #c4a8e0; }

	.med-loading {
		font-family: var(--font-ui);
		font-size: 0.9rem;
		color: #7a8fa0;
		padding: 2rem 0;
		margin: 0;
	}

	.med-columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.58rem;
	}

	/* Card */
	.med-card {
		display: flex;
		flex-direction: column;
		gap: 0.42rem;
		padding: 0.58rem 0.5rem 0.52rem;
		border-radius: 0.92rem;
		break-inside: avoid;
	}

	.med-card-rose   { background: linear-gradient(180deg, #f4dde4 0%, #f0d8df 100%); }
	.med-card-amber  { background: linear-gradient(180deg, #faecd4 0%, #f5e6cb 100%); }
	.med-card-sage   { background: linear-gradient(180deg, #ddeedd 0%, #d7e9d7 100%); }
	.med-card-lilac  { background: linear-gradient(180deg, #ece8f3 0%, #e7e3ef 100%); }

	.med-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.48rem;
	}

	.med-card-head h2 {
		margin: 0;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: clamp(1.44rem, 1.95vw, 2.04rem);
		font-weight: 500;
		line-height: 1.02;
		color: #2e3845;
	}

	.med-head-right {
		display: flex;
		align-items: center;
		gap: 0.38rem;
		flex-shrink: 0;
	}

	/* Pills */
	.med-pill {
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

	.med-pill-rose   { background: #dd7182; }
	.med-pill-amber  { background: #b87828; }
	.med-pill-sage   { background: #5a9e68; }
	.med-pill-lilac  { background: #a98dba; }

	/* Add toggle button */
	.med-add-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 999px;
		border: 1.5px solid rgba(96, 109, 123, 0.22);
		background: rgba(255, 255, 255, 0.55);
		font-size: 1rem;
		font-weight: 400;
		line-height: 1;
		color: #526b81;
		cursor: pointer;
		transition: transform 180ms ease, background 140ms ease;
	}

	.med-add-toggle:hover {
		background: rgba(255, 255, 255, 0.8);
	}

	.med-add-toggle-open {
		transform: rotate(45deg);
	}

	/* Add form */
	.med-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		padding: 0.55rem 0.5rem;
		border-radius: 0.58rem;
		background: rgba(255, 255, 255, 0.55);
		border: 1px solid rgba(96, 109, 123, 0.15);
	}

	.med-form-stack {
		flex-direction: column;
		align-items: stretch;
	}

	.med-form-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.med-input {
		font-family: var(--font-ui);
		font-size: 0.8rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.36rem;
		padding: 0.28rem 0.45rem;
		background: #fff;
		color: #133149;
		min-width: 0;
	}

	.med-input-grow { flex: 1; min-width: 8rem; }
	.med-input-sm   { width: 5.5rem; flex-shrink: 0; }
	.med-input-full { width: 100%; box-sizing: border-box; }

	.med-submit {
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 0.28rem 0.82rem;
		border: none;
		border-radius: 0.36rem;
		background: #526b81;
		color: #fff;
		cursor: pointer;
		flex-shrink: 0;
	}

	.med-submit:disabled {
		opacity: 0.45;
		cursor: default;
	}

	/* Items list */
	.med-items {
		display: grid;
		gap: 0.34rem;
	}

	.med-empty {
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

	/* Dog row */
	.med-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.44rem 0.5rem;
		border: 1px solid rgba(96, 109, 123, 0.15);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.5);
	}

	.med-row-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.16rem;
	}

	.med-dog-link {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.92rem;
		color: #016aa5;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: transparent;
		line-height: 1.2;
	}

	.med-dog-link:hover {
		text-decoration-color: currentColor;
	}

	.med-kennel {
		font-weight: 500;
		font-size: 0.78rem;
		color: #7a8fa0;
	}

	.med-row-sub {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.med-label {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: #7a8fa0;
		font-weight: 500;
	}

	.med-meta {
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: #526b81;
	}

	.med-meta-soft {
		color: #7a8fa0;
	}

	/* Tells reason apart from medication at a glance. */
	.med-field-label {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.56rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: #9aa7b4;
	}

	.med-reason-add,
	.med-reason-edit {
		border: 1px dashed #c4b8d6;
		background: transparent;
		border-radius: 0.4rem;
		padding: 0.02rem 0.34rem;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 600;
		color: #8a7ea3;
		cursor: pointer;
	}

	.med-reason-edit {
		border-style: solid;
		border-color: transparent;
		color: #7a8fa0;
	}

	.med-reason-add:hover,
	.med-reason-edit:hover {
		color: #4d3a63;
		border-color: #a98dba;
	}

	/* The medication doubles as the edit affordance — it looks like text until hovered. */
	.med-tx-name {
		border: 0;
		background: none;
		padding: 0;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: #526b81;
		cursor: pointer;
		text-align: left;
	}

	.med-tx-name:hover {
		color: #4d3a63;
		text-decoration: underline;
	}

	.med-tx-edit {
		border: 1px solid transparent;
		background: none;
		border-radius: 0.4rem;
		padding: 0.02rem 0.34rem;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 600;
		color: #8a7ea3;
		cursor: pointer;
	}

	.med-tx-edit:hover {
		border-color: #a98dba;
		color: #4d3a63;
	}

	.med-meta-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.med-outbreak-toggle,
	.med-group-toggle {
		border: 1px solid #cfc4dd;
		background: #ffffff;
		color: #7d7490;
		border-radius: 999px;
		padding: 0.18rem 0.6rem;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
	}

	.med-outbreak-toggle-open {
		background: #cf4b4b;
		border-color: #cf4b4b;
		color: #fff;
	}

	.med-group-toggle-open {
		background: #ece8f3;
		border-color: #a98dba;
		color: #4d3a63;
	}

	.med-hint {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: #8a7070;
		line-height: 1.4;
	}

	.med-check-list {
		max-height: 220px;
		overflow-y: auto;
		display: grid;
		gap: 0.1rem;
		border: 1px solid #ecd6d6;
		border-radius: 0.6rem;
		background: #fff;
		padding: 0.4rem 0.5rem;
	}

	.med-check {
		display: flex;
		align-items: center;
		gap: 0.44rem;
		font-family: var(--font-ui);
		font-size: 0.84rem;
		font-weight: 600;
		color: #33414f;
		padding: 0.12rem 0;
	}

	.med-check-tag {
		font-size: 0.56rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #2e6c30;
	}

	.med-check-tag-sick {
		color: #cf4b4b;
	}

	.med-check-tag-tx {
		color: #6030a0;
	}

	.med-check-origin {
		margin-left: auto;
		font-size: 0.66rem;
		font-weight: 700;
		color: #8a7c7c;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* Two independent switches: Monitor is a care state, Sick is the outbreak flag. */
	.med-switches {
		display: flex;
		flex-shrink: 0;
		align-self: flex-start;
		gap: 0.28rem;
	}

	.med-switch {
		border: 1px solid #cfc4dd;
		background: #ffffff;
		color: #7d7490;
		border-radius: 999px;
		padding: 0.16rem 0.6rem;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		cursor: pointer;
	}

	.med-switch:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.med-switch-on-monitor {
		background: #e4f2e4;
		border-color: #9ccf9e;
		color: #2e6c30;
	}

	.med-switch-on-sick {
		background: #cf4b4b;
		border-color: #cf4b4b;
		color: #ffffff;
	}

	.med-date-inline {
		font-family: var(--font-ui);
		font-size: 0.74rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.28rem;
		padding: 0.14rem 0.32rem;
		background: rgba(255, 255, 255, 0.8);
		color: #133149;
	}

	.med-tag {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.1rem 0.42rem;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.med-tag-warn { background: rgba(207, 75, 75, 0.12); color: #a03232; }
	.med-tag-info { background: rgba(1, 106, 165, 0.1); color: #016aa5; }
	.med-tag-done { background: rgba(58, 175, 42, 0.1); color: #3aaf2a; }

	.med-reason-row {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		margin-top: 0.1rem;
	}

	.med-reason-btn {
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 600;
		padding: 0.14rem 0.46rem;
		border: 1px solid rgba(96, 109, 123, 0.22);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.55);
		color: #526b81;
		cursor: pointer;
	}

	.med-reason-active {
		background: rgba(207, 75, 75, 0.1);
		border-color: rgba(207, 75, 75, 0.35);
		color: #a03232;
	}

	.med-notes {
		margin: 0.1rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: #526b81;
		line-height: 1.35;
	}

	.med-tx-list {
		display: grid;
		gap: 0.26rem;
		margin-top: 0.08rem;
	}

	.med-tx-item {
		display: flex;
		flex-direction: column;
		gap: 0.08rem;
		padding-bottom: 0.22rem;
		border-bottom: 1px solid rgba(96, 109, 123, 0.12);
	}

	.med-tx-item:last-child {
		padding-bottom: 0;
		border-bottom: none;
	}

	.med-tx-line {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.med-tx-remove {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 999px;
		border: 1px solid rgba(96, 109, 123, 0.22);
		background: rgba(255, 255, 255, 0.55);
		color: #526b81;
		font-size: 0.86rem;
		line-height: 1;
		cursor: pointer;
		flex-shrink: 0;
	}

	.med-tx-remove:hover {
		background: rgba(207, 75, 75, 0.1);
		border-color: rgba(207, 75, 75, 0.35);
		color: #a03232;
	}

	.med-clear {
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.24rem 0.55rem;
		border: 1px solid rgba(96, 109, 123, 0.22);
		border-radius: 0.4rem;
		background: rgba(255, 255, 255, 0.55);
		color: #526b81;
		cursor: pointer;
		flex-shrink: 0;
		align-self: flex-start;
		margin-top: 0.18rem;
	}

	.med-clear:hover {
		background: rgba(255, 255, 255, 0.85);
		color: #133149;
	}

	@media (min-width: 760px) {
		.med-columns {
			display: block;
			columns: 2;
			column-gap: 0.58rem;
		}

		.med-card {
			margin-bottom: 0.58rem;
		}
	}
</style>
