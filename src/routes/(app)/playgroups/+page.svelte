<script lang="ts">
	import { format } from 'date-fns';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { listDogs } from '$lib/data/dogs';
	import {
		addPlaygroupSession,
		deletePlaygroupSession,
		listPlaygroupSessions,
		listPendingPlaygroups,
		markPendingProcessed,
		updatePlaygroupSession
	} from '$lib/data/playgroups';
	import type { PendingPlaygroup } from '$lib/data/playgroups';
	import { parsePlaygroupMessage } from '$lib/utils/parsePlaygroupMessage';
	import type { ParsedPlaygroupMessage } from '$lib/utils/parsePlaygroupMessage';
	import { formatDateTime, toDate } from '$lib/utils/dates';
	import { getCautionDogs } from '$lib/utils/attention';
	import {
		buildRecommendations,
		buildTestSuggestions,
		getReadiness,
		guidanceForDog,
		isPuppy,
		readinessLabel,
		sizeCategory,
		sizeLabelShort
	} from '$lib/utils/playgroupRecommendations';
	import type { PlaygroupRecommendation } from '$lib/utils/playgroupRecommendations';
	import { matchDogByName } from '$lib/utils/dogs';
	import { canAccessPlaygroups, canEditPlaygroups, resolveRole } from '$lib/utils/permissions';
	import type { Dog, PlaygroupOutcome, PlaygroupSession, UserRole } from '$lib/types';
	import { energyLabel, compatibilityLabel } from '$lib/utils/labels';
	import { syncVersion } from '$lib/stores/sync';

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	let dogs: Dog[] = [];
	let sessions: PlaygroupSession[] = [];
	let loading = true;
	let savingManual = false;
	let loggingRecommendationId = '';
	let search = '';

	let manualGroupName = '';
	let manualDate = format(new Date(), 'yyyy-MM-dd');
	let manualOutcome: PlaygroupOutcome = 'successful';
	let manualDuration = '';
	let manualNotes = '';
	let manualDogIds: string[] = [];
	let manualExtraNames = '';
	let showManualModal = false;
	let playgroupsLoaded = false;

	// Slack import — paste
	let showSlackImport = false;
	let importText = '';
	let importParsed: ParsedPlaygroupMessage | null = null;
	let importDate = format(new Date(), 'yyyy-MM-dd');
	let importOutcome: PlaygroupOutcome = 'successful';
	let importGroupName = '';
	let importNotes = '';
	let savingImport = false;
	let importExcludedNames: string[] = [];

	// Slack import — pending from webhook
	let pendingPlaygroups: PendingPlaygroup[] = [];
	let activePending: PendingPlaygroup | null = null;
	let savingPending = false;

	// Tabs
	let activeTab: 'dogs' | 'recommendations' | 'history' = 'dogs';

	// History editing
	let editingSessionId: string | null = null;
	let editDate = '';
	let editGroupName = '';
	let editOutcome: PlaygroupOutcome = 'successful';
	let editNotes = '';
	let editDogIds: string[] = [];
	let savingEdit = false;

	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canViewPlaygroups = canAccessPlaygroups(role);
	$: canEdit = canEditPlaygroups(role);
	$: if (canViewPlaygroups && !playgroupsLoaded) {
		playgroupsLoaded = true;
		void refreshData();
	}
	$: if (!canViewPlaygroups) {
		loading = false;
	}

	$: activeDogs = dogs
		.filter((dog) => dog.status === 'active' && !dog.permanentFoster && !dog.inFoster && !dog.isIncoming)
		.sort((a, b) => a.name.localeCompare(b.name));
	$: filteredDogs = activeDogs.filter((dog) => dog.name.toLowerCase().includes(search.toLowerCase()));
	$: dogIdsWithHistory = new Set(sessions.flatMap((s) => s.dogIds));
	$: readyDogs = activeDogs.filter((dog) => {
		if (dog.isolationStatus !== 'none' || dog.goodWithDogs === 'no' || dog.awaitingEvaluation) return false;
		if (dog.goodWithDogs === 'yes' || isPuppy(dog)) return true;
		return dogIdsWithHistory.has(dog.id);
	});
	$: cautionDogs = getCautionDogs(activeDogs, sessions);
	$: holdDogs = activeDogs.filter((dog) => getReadiness(dog) === 'hold');
	$: unknownWeightDogs = readyDogs.filter((d) => d.weightLbs === null || d.weightLbs === undefined);
	$: ({ groups: readyGroups, swapIns } = buildRecommendations(readyDogs));
	$: testSuggestions = buildTestSuggestions(cautionDogs, readyGroups);
	$: history = [...sessions].sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0));


	function dateDayCount(value: Dog['intakeDate']) {
		const date = toDate(value);
		if (!date) return null;
		return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
	}

	function parseInputDate(value: string) {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (!match) return new Date();
		const year = Number(match[1]);
		const month = Number(match[2]) - 1;
		const day = Number(match[3]);
		const parsed = new Date(year, month, day);
		return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
	}

	function toggleManualDog(dogId: string, checked: boolean) {
		if (checked) {
			if (!manualDogIds.includes(dogId)) manualDogIds = [...manualDogIds, dogId];
			return;
		}
		manualDogIds = manualDogIds.filter((id) => id !== dogId);
	}

	$: if ($syncVersion > 0) void refreshData();

	async function refreshData() {
		loading = true;
		[dogs, sessions, pendingPlaygroups] = await Promise.all([
			listDogs(),
			listPlaygroupSessions(),
			listPendingPlaygroups()
		]);
		loading = false;
	}

	function matchImportDogs(names: string[]) {
		const active = dogs.filter((d) => d.status === 'active' && !d.permanentFoster && !d.isIncoming);
		const all = dogs.filter((d) => !d.permanentFoster && !d.isIncoming);
		return names.map((name) => {
			const dog = matchDogByName(name, active) ?? matchDogByName(name, all);
			return { name, dog, isActive: dog ? dog.status === 'active' : false };
		});
	}

	function parseImport() {
		if (!importText.trim()) return;
		const allDogNames = dogs
			.filter((d) => !d.permanentFoster && !d.isIncoming)
			.map((d) => d.name);
		importParsed = parsePlaygroupMessage(importText, allDogNames);
		importOutcome = importParsed.outcome;
		importNotes = importParsed.notes ?? '';
		importGroupName = '';
		importExcludedNames = [];
	}

	function clearImport() {
		importText = '';
		importParsed = null;
		importGroupName = '';
		importNotes = '';
		importOutcome = 'successful';
		activePending = null;
		importExcludedNames = [];
	}

	function openPending(p: PendingPlaygroup) {
		activePending = p;
		importDate = format(new Date(), 'yyyy-MM-dd');
		importOutcome = p.suggestedOutcome;
		importNotes = p.suggestedNotes ?? '';
		importGroupName = '';
		importExcludedNames = [];
		showSlackImport = false;
	}

	function toggleExclude(name: string) {
		if (importExcludedNames.includes(name)) {
			importExcludedNames = importExcludedNames.filter((n) => n !== name);
		} else {
			importExcludedNames = [...importExcludedNames, name];
		}
	}

	async function saveImportSession() {
		if (!importParsed) return;
		const allMatches = matchImportDogs(importParsed.dogNames);
		const matches = allMatches.filter((m) => !importExcludedNames.includes(m.name));
		if (matches.length < 2) {
			toast.error('At least 2 dogs required.');
			return;
		}
		savingImport = true;
		try {
			await addPlaygroupSession(
				{
					date: parseInputDate(importDate),
					groupName: importGroupName.trim(),
					dogIds: matches.filter((m) => m.dog !== null).map((m) => m.dog!.id),
					dogNames: matches.map((m) => m.name),
					recommendationType: 'manual',
					outcome: importOutcome,
					notes: importNotes.trim() || null,
					durationMinutes: null
				},
				$authProfile
			);
			sessions = await listPlaygroupSessions();
			clearImport();
			showSlackImport = false;
			toast.success('Playgroup session saved.');
		} catch (e) {
			console.error(e);
			toast.error('Unable to save session.');
		} finally {
			savingImport = false;
		}
	}

	async function savePendingSession() {
		if (!activePending) return;
		const allMatches = matchImportDogs(activePending.dogNames);
		const matches = allMatches.filter((m) => !importExcludedNames.includes(m.name));
		if (matches.length < 2) {
			toast.error('At least 2 dogs required.');
			return;
		}
		savingPending = true;
		try {
			await addPlaygroupSession(
				{
					date: parseInputDate(importDate),
					groupName: importGroupName.trim(),
					dogIds: matches.filter((m) => m.dog !== null).map((m) => m.dog!.id),
					dogNames: matches.map((m) => m.name),
					recommendationType: 'manual',
					outcome: importOutcome,
					notes: importNotes.trim() || null,
					durationMinutes: null
				},
				$authProfile
			);
			await markPendingProcessed(activePending.id);
			pendingPlaygroups = pendingPlaygroups.filter((p) => p.id !== activePending!.id);
			sessions = await listPlaygroupSessions();
			clearImport();
			toast.success('Playgroup session saved.');
		} catch (e) {
			console.error(e);
			toast.error('Unable to save session.');
		} finally {
			savingPending = false;
		}
	}

	async function dismissPending(id: string) {
		try {
			await markPendingProcessed(id);
		} catch {
			// best-effort
		}
		pendingPlaygroups = pendingPlaygroups.filter((p) => p.id !== id);
		if (activePending?.id === id) clearImport();
	}

	async function logRecommendation(recommendation: PlaygroupRecommendation) {
		if (loggingRecommendationId) return;
		loggingRecommendationId = recommendation.id;
		try {
			await addPlaygroupSession(
				{
					date: new Date(),
					groupName: recommendation.title,
					dogIds: recommendation.dogIds,
					dogNames: recommendation.dogs.map((dog) => dog.name),
					recommendationType: recommendation.recommendationType,
					outcome: 'successful',
					notes: recommendation.reason,
					durationMinutes: null
				},
				$authProfile
			);
			sessions = await listPlaygroupSessions();
			toast.success('Playgroup added to history.');
		} catch (error) {
			console.error(error);
			toast.error('Unable to save playgroup history.');
		} finally {
			loggingRecommendationId = '';
		}
	}

	async function saveManualSession() {
		const selectedDogs = activeDogs.filter((dog) => manualDogIds.includes(dog.id));
		const extraNames = manualExtraNames.split(',').map((n) => n.trim()).filter(Boolean);
		if (selectedDogs.length + extraNames.length < 2) {
			toast.error('Select at least 2 dogs.');
			return;
		}
		let durationMinutes: number | null = null;
		if (manualDuration.trim()) {
			const parsed = Number(manualDuration);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				toast.error('Duration must be a positive number.');
				return;
			}
			durationMinutes = Math.round(parsed);
		}

		savingManual = true;
		try {
			await addPlaygroupSession(
				{
					date: parseInputDate(manualDate),
					groupName: manualGroupName.trim(),
					dogIds: selectedDogs.map((dog) => dog.id),
					dogNames: [...selectedDogs.map((dog) => dog.name), ...extraNames],
					recommendationType: 'manual',
					outcome: manualOutcome,
					notes: manualNotes.trim() || null,
					durationMinutes
				},
				$authProfile
			);
			sessions = await listPlaygroupSessions();
			manualGroupName = '';
			manualOutcome = 'successful';
			manualDuration = '';
			manualNotes = '';
			manualDogIds = [];
			manualExtraNames = '';
			manualDate = format(new Date(), 'yyyy-MM-dd');
			showManualModal = false;
			toast.success('Playgroup session saved.');
		} catch (error) {
			console.error(error);
			toast.error('Unable to save playgroup session.');
		} finally {
			savingManual = false;
		}
	}

	function startEdit(session: PlaygroupSession) {
		editingSessionId = session.id;
		editDate = format(toDate(session.date) ?? new Date(), 'yyyy-MM-dd');
		editGroupName = session.groupName;
		editOutcome = session.outcome;
		editNotes = session.notes ?? '';
		editDogIds = [...session.dogIds];
	}

	function cancelEdit() {
		editingSessionId = null;
	}

	async function saveEdit() {
		if (!editingSessionId) return;
		savingEdit = true;
		try {
			const editSelectedDogs = dogs.filter((d) => editDogIds.includes(d.id));
			await updatePlaygroupSession(editingSessionId, {
				date: parseInputDate(editDate),
				groupName: editGroupName.trim(),
				outcome: editOutcome,
				notes: editNotes.trim() || null,
				dogIds: editSelectedDogs.map((d) => d.id),
				dogNames: editSelectedDogs.map((d) => d.name)
			});
			sessions = await listPlaygroupSessions();
			editingSessionId = null;
			toast.success('Session updated.');
		} catch (error) {
			console.error(error);
			toast.error('Unable to update session.');
		} finally {
			savingEdit = false;
		}
	}

	async function deleteSession(id: string) {
		if (!confirm('Delete this playgroup session? This cannot be undone.')) return;
		try {
			await deletePlaygroupSession(id);
			sessions = sessions.filter((s) => s.id !== id);
		} catch (error) {
			console.error(error);
			toast.error('Unable to delete session.');
		}
	}

	function outcomeClass(value: PlaygroupOutcome) {
		if (value === 'successful') return 'outcome-success';
		if (value === 'mixed') return 'outcome-mixed';
		if (value === 'incident') return 'outcome-incident';
		return 'outcome-cancelled';
	}
</script>

<svelte:head>
	<title>Playgroups | Cache Humane Society</title>
</svelte:head>

{#if !canViewPlaygroups}
	<section class="playgroups-board" aria-label="Playgroups board">
		<div class="playgroups-restricted panel panel-wide">
			<h3>Manager only</h3>
			<p class="panel-note">Playgroups are temporarily available only to manager and admin accounts.</p>
		</div>
	</section>
{:else}
	<section class="playgroups-board" aria-label="Playgroups board">
		<header class="playgroups-header">
			<div class="playgroups-controls">
				<div class="controls-top-row">
					<input
						class="playgroups-search"
						placeholder="search dog name"
						bind:value={search}
					/>
				</div>
				<div class="stats-row typewriter">
					<span class="stat-chip stat-ready">Ready: {readyDogs.length}</span>
					<span class="stat-chip stat-caution">Caution: {cautionDogs.length}</span>
					<span class="stat-chip stat-hold">Hold: {holdDogs.length}</span>
					<span class="stat-chip">History: {history.length}</span>
					{#if canEdit}
					<div class="header-actions">
						<button class="slack-toggle-btn typewriter" type="button" on:click={() => showManualModal = true}>
							Log playgroup
						</button>
						<button
							class="slack-toggle-btn typewriter"
							type="button"
							on:click={() => { showSlackImport = !showSlackImport; if (!showSlackImport) clearImport(); }}
						>
							{showSlackImport ? 'Cancel' : 'Paste log'}
						</button>
					</div>
					{/if}
				</div>
			</div>
		</header>

		{#if loading}
			<p class="playgroups-state marker-line marker-muted">Loading playgroups...</p>
		{:else}

			<!-- Pending Slack messages -->
			{#if pendingPlaygroups.length > 0 && !activePending}
				<div class="slack-pending-bar">
					<span class="slack-pending-label typewriter">
						{pendingPlaygroups.length} playgroup {pendingPlaygroups.length === 1 ? 'message' : 'messages'} from Slack
					</span>
					<div class="slack-pending-list">
						{#each pendingPlaygroups as p}
							<div class="slack-pending-item">
								<span class="slack-pending-dogs">{p.dogNames.join(', ') || 'No dogs parsed'}</span>
								<div class="slack-pending-actions">
									<button class="slack-pending-btn typewriter" type="button" on:click={() => openPending(p)}>Review</button>
									<button class="slack-pending-dismiss typewriter" type="button" on:click={() => dismissPending(p.id)}>Dismiss</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Confirmation form — active pending item -->
			{#if activePending}
				{@const pendingMatches = matchImportDogs(activePending.dogNames)}
				<div class="slack-confirm-panel">
					<div class="slack-confirm-head">
						<p class="slack-confirm-title typewriter">Review Slack playgroup</p>
						<button class="slack-back-btn typewriter" type="button" on:click={clearImport}>Back</button>
					</div>
					<div class="slack-dog-pills">
						{#each pendingMatches as m}
							<button
								type="button"
								class={`slack-dog-pill ${importExcludedNames.includes(m.name) ? 'pill-excluded' : m.dog ? (m.isActive ? 'pill-matched' : 'pill-archived') : 'pill-unmatched'}`}
								on:click={() => toggleExclude(m.name)}
								title={importExcludedNames.includes(m.name) ? 'Click to include' : 'Click to remove'}
							>{m.name}</button>
						{/each}
					</div>
					{#if pendingMatches.some((m) => !m.dog)}
						<p class="slack-unmatched-note">Gray: not in app — will still be saved by name. Click to remove.</p>
					{/if}
					{#if pendingMatches.some((m) => m.dog && !m.isActive)}
						<p class="slack-unmatched-note" style="color:#7a6000">Amber: no longer at shelter — will still be included. Click to remove.</p>
					{/if}
					<div class="slack-confirm-fields">
						<label class="form-field">
							<span class="typewriter">Group name (optional)</span>
							<input bind:value={importGroupName} placeholder="e.g. Morning Yard Group A" />
						</label>
						<label class="form-field">
							<span class="typewriter">Date</span>
							<input type="date" bind:value={importDate} />
						</label>
						<label class="form-field">
							<span class="typewriter">Outcome</span>
							<select bind:value={importOutcome}>
								<option value="successful">Successful</option>
								<option value="mixed">Mixed</option>
								<option value="incident">Incident</option>
								<option value="cancelled">Cancelled</option>
							</select>
						</label>
						<label class="form-field form-field-wide">
							<span class="typewriter">Notes</span>
							<textarea rows="3" bind:value={importNotes}></textarea>
						</label>
					</div>
					<div class="slack-confirm-raw">
						<p class="typewriter">Raw Slack message</p>
						<pre class="slack-raw-text">{activePending.rawText}</pre>
					</div>
					<button
						class="slack-save-btn typewriter"
						type="button"
						on:click={savePendingSession}
						disabled={savingPending}
					>
						{savingPending ? 'Saving...' : 'Save session'}
					</button>
				</div>
			{/if}

			<!-- Paste import panel -->
			{#if showSlackImport && !activePending}
				<div class="slack-import-panel">
					{#if !importParsed}
						<label class="form-field" for="slack-paste">
							<span class="typewriter">Paste playgroup log</span>
							<textarea
								id="slack-paste"
								class="slack-paste-area"
								rows="8"
								bind:value={importText}
								placeholder={'Archer in\nBirdie in\nArcher out\nBirdie out: rude body language at first, settled after 2 min'}
							></textarea>
						</label>
						<button
							class="slack-parse-btn typewriter"
							type="button"
							on:click={parseImport}
							disabled={!importText.trim()}
						>
							Parse
						</button>
					{:else}
						{@const pasteMatches = matchImportDogs(importParsed.dogNames)}
						<div class="slack-confirm-head">
							<p class="slack-confirm-title typewriter">Preview</p>
							<button class="slack-back-btn typewriter" type="button" on:click={clearImport}>Edit message</button>
						</div>
						<div class="slack-dog-pills">
							{#each pasteMatches as m}
								<button
									type="button"
									class={`slack-dog-pill ${importExcludedNames.includes(m.name) ? 'pill-excluded' : m.dog ? (m.isActive ? 'pill-matched' : 'pill-archived') : 'pill-unmatched'}`}
									on:click={() => toggleExclude(m.name)}
									title={importExcludedNames.includes(m.name) ? 'Click to include' : 'Click to remove'}
								>{m.name}</button>
							{/each}
							{#if pasteMatches.length === 0}
								<span class="typewriter" style="font-size:0.72rem;color:#7a3e3e">No dog names parsed. Check format.</span>
							{/if}
						</div>
						{#if pasteMatches.some((m) => !m.dog)}
							<p class="slack-unmatched-note">Gray: not in app — will still be saved by name. Click to remove.</p>
						{/if}
						{#if pasteMatches.some((m) => m.dog && !m.isActive)}
							<p class="slack-unmatched-note" style="color:#7a6000">Amber: no longer at shelter — will still be included.</p>
						{/if}
						<div class="slack-confirm-fields">
							<label class="form-field">
								<span class="typewriter">Group name (optional)</span>
								<input bind:value={importGroupName} placeholder="e.g. Morning Yard Group A" />
							</label>
							<label class="form-field">
								<span class="typewriter">Date</span>
								<input type="date" bind:value={importDate} />
							</label>
							<label class="form-field">
								<span class="typewriter">Outcome</span>
								<select bind:value={importOutcome}>
									<option value="successful">Successful</option>
									<option value="mixed">Mixed</option>
									<option value="incident">Incident</option>
									<option value="cancelled">Cancelled</option>
								</select>
							</label>
							<label class="form-field form-field-wide">
								<span class="typewriter">Notes</span>
								<textarea rows="3" bind:value={importNotes}></textarea>
							</label>
						</div>
						<button
							class="slack-save-btn typewriter"
							type="button"
							on:click={saveImportSession}
							disabled={savingImport}
						>
							{savingImport ? 'Saving...' : 'Save session'}
						</button>
					{/if}
				</div>
			{/if}

			<div class="pg-tab-bar">
				<button class={`pg-tab ${activeTab === 'dogs' ? 'pg-tab-active' : ''}`} type="button" on:click={() => activeTab = 'dogs'}>Dogs</button>
				<button class={`pg-tab ${activeTab === 'recommendations' ? 'pg-tab-active' : ''}`} type="button" on:click={() => activeTab = 'recommendations'}>Recommendations</button>
				<button class={`pg-tab ${activeTab === 'history' ? 'pg-tab-active' : ''}`} type="button" on:click={() => activeTab = 'history'}>History</button>
			</div>

			{#if activeTab === 'dogs'}
			<section class="panel">
				<div class="panel-head">
					<h3>Dog List</h3>
					<p class="panel-note">Use this as the source roster for group planning.</p>
				</div>
				{#if filteredDogs.length === 0}
					<p class="empty-line">No active dogs match search.</p>
				{:else}
					<!-- Mobile cards -->
					<div class="dog-card-list">
						{#each filteredDogs as dog}
							{@const readiness = getReadiness(dog)}
							<div class="dog-card">
								<div class="dog-card-top">
									<a href={`/dogs/${dog.id}`} class="dog-link">{dog.name}</a>
									<span class={`readiness-pill readiness-${readiness}`}>{readinessLabel(readiness)}</span>
									{#if dog.awaitingEvaluation}
										<span class="readiness-pill readiness-eval">Eval pending</span>
									{/if}
								</div>
								<div class="dog-card-meta typewriter">
									<span>Energy: {energyLabel(dog.energyLevel)}</span>
									<span>Run: {dog.outdoorKennelAssignment || 'Unassigned'}</span>
									<span>{dateDayCount(dog.intakeDate) ?? '—'} days in</span>
								</div>
								{#if guidanceForDog(dog)}
									<p class="dog-card-guidance">{guidanceForDog(dog)}</p>
								{/if}
							</div>
						{/each}
					</div>
					<!-- Desktop table -->
					<div class="list-wrap">
						<table class="dog-table">
							<thead>
								<tr>
									<th>Dog</th>
									<th>Readiness</th>
									<th>Energy</th>
									<th>Kennel</th>
									<th>In Shelter</th>
									<th>Guidance</th>
								</tr>
							</thead>
							<tbody>
								{#each filteredDogs as dog}
									{@const readiness = getReadiness(dog)}
									<tr>
										<td>
											<a href={`/dogs/${dog.id}`} class="dog-link">{dog.name}</a>
											<p class="table-meta typewriter">Good with dogs: {compatibilityLabel(dog.goodWithDogs)}</p>
										</td>
										<td>
											<span class={`readiness-pill readiness-${readiness}`}>{readinessLabel(readiness)}</span>
											{#if dog.awaitingEvaluation}
												<span class="readiness-pill readiness-eval">Eval pending</span>
											{/if}
										</td>
										<td>{energyLabel(dog.energyLevel)}</td>
										<td>{dog.outdoorKennelAssignment || 'Unassigned'}</td>
										<td>{dateDayCount(dog.intakeDate) ?? '—'} days</td>
										<td>{guidanceForDog(dog)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
			{:else if activeTab === 'recommendations'}
			<section class="panel">
				<div class="panel-head">
					<h3>Recommended Playgroups</h3>
					<p class="panel-note">Auto-suggested from readiness + size compatibility. Up to 4 dogs per group.</p>
				</div>
				{#if readyGroups.length === 0}
					<p class="empty-line">No recommendations yet. Mark more dogs as good with dogs to generate groups.</p>
				{:else}
					<div class="recommendation-grid">
						{#each readyGroups as recommendation}
							<article class="recommendation-card">
								<div class="recommendation-head">
									<h4>{recommendation.title}</h4>
									<span class="priority-chip">{recommendation.dogs.length} dogs</span>
								</div>
								<div class="dog-chip-row">
									{#each recommendation.dogs as dog}
										<a href={`/dogs/${dog.id}`} class="dog-chip">
											{dog.name}
											<span class="size-badge size-badge-{sizeCategory(dog)}">{sizeLabelShort(dog)}</span>
										</a>
									{/each}
								</div>
								{#if recommendation.dogs.some((d) => sizeCategory(d) === 'unknown')}
									<p class="size-unknown-note">⚠ Some dogs have no weight recorded — size compatibility unverified.</p>
								{/if}
								<p class="recommendation-reason">{recommendation.reason}</p>
								{#if canEdit}
								<button
									class="recommendation-log-btn typewriter"
									type="button"
									on:click={() => logRecommendation(recommendation)}
									disabled={loggingRecommendationId === recommendation.id}
								>
									{loggingRecommendationId === recommendation.id ? 'Saving...' : 'Log to history'}
								</button>
								{/if}
							</article>
						{/each}
					</div>
				{/if}

				{#if unknownWeightDogs.length > 0}
					<div class="unknown-weight-section">
						<p class="unknown-weight-title">Weight unknown</p>
						<div class="unknown-weight-list">
							{#each unknownWeightDogs as dog}
								<a href={`/dogs/${dog.id}`} class="unknown-weight-chip">{dog.name}</a>
							{/each}
						</div>
					</div>
				{/if}

				{#if swapIns.length > 0}
					<div class="test-section">
						<div class="test-section-head">
							<h4 class="test-section-title">Dogs to Rotate In</h4>
							<p class="test-section-note">Ready dogs that didn't fit neatly into a group — swap one in to replace or add to an existing group.</p>
						</div>
						<div class="test-grid">
							{#each swapIns as s}
								<div class="test-card">
									<div class="test-card-top">
										<a href={`/dogs/${s.dog.id}`} class="dog-link">{s.dog.name}</a>
										<span class="size-badge size-badge-{sizeCategory(s.dog)}">{sizeLabelShort(s.dog)}</span>
									</div>
									{#if s.compatibleGroups.length > 0}
										<p class="test-suggested">
											Fits in: {s.compatibleGroups.map((g) => g.title).join(', ')}
										</p>
									{:else}
										<p class="test-reason">No current group is size-compatible — may need their own intro session.</p>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if testSuggestions.length > 0}
					<div class="test-section">
						<div class="test-section-head">
							<h4 class="test-section-title">Dogs to Test</h4>
							<p class="test-section-note">Unknown compatibility — introduce to an established ready group to evaluate.</p>
						</div>
						<div class="test-grid">
							{#each testSuggestions as suggestion}
								<div class="test-card">
									<div class="test-card-top">
										<a href={`/dogs/${suggestion.dog.id}`} class="dog-link">{suggestion.dog.name}</a>
										<span class="readiness-pill readiness-caution">Unknown</span>
									</div>
									<p class="test-reason">{suggestion.reason}</p>
									{#if suggestion.suggestedGroup}
										<p class="test-suggested">
											Try with: <strong>{suggestion.suggestedGroup.title}</strong>
											({suggestion.suggestedGroup.dogs.map((d) => d.name).join(', ')})
										</p>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</section>
			{:else}
			<section class="panel panel-history">
				<div class="panel-head">
					<h3>Playgroup History</h3>
					<p class="panel-note">All previously logged playgroups.</p>
				</div>

				{#if history.length === 0}
					<p class="empty-line">No previous playgroups logged yet.</p>
				{:else}
					<div class="history-list">
						{#each history as session}
							<article class="history-card">
								{#if editingSessionId === session.id}
									<div class="history-edit-form">
										<div class="history-edit-row">
											<input type="date" bind:value={editDate} />
											<select bind:value={editOutcome}>
												<option value="successful">Successful</option>
												<option value="mixed">Mixed</option>
												<option value="incident">Incident</option>
												<option value="cancelled">Cancelled</option>
											</select>
										</div>
										<input type="text" bind:value={editGroupName} placeholder="Group name (optional)" />
										<div class="edit-dog-list">
											{#each activeDogs as dog}
												<label class="edit-dog-item">
													<input
														type="checkbox"
														value={dog.id}
														checked={editDogIds.includes(dog.id)}
														on:change={(e) => {
															if (e.currentTarget.checked) {
																editDogIds = [...editDogIds, dog.id];
															} else {
																editDogIds = editDogIds.filter((id) => id !== dog.id);
															}
														}}
													/>
													{dog.name}
												</label>
											{/each}
											{#each dogs.filter((d) => d.status !== 'active' && editDogIds.includes(d.id)) as dog}
												<label class="edit-dog-item edit-dog-item-inactive">
													<input
														type="checkbox"
														value={dog.id}
														checked={true}
														on:change={(e) => {
															if (!e.currentTarget.checked) {
																editDogIds = editDogIds.filter((id) => id !== dog.id);
															}
														}}
													/>
													{dog.name} <span class="edit-dog-left">left shelter</span>
												</label>
											{/each}
										</div>
										<textarea bind:value={editNotes} placeholder="Notes" rows={3}></textarea>
										<div class="history-edit-actions">
											<button class="btn-save-edit" on:click={saveEdit} disabled={savingEdit}>
												{savingEdit ? 'Saving…' : 'Save'}
											</button>
											<button class="btn-cancel-edit" on:click={cancelEdit}>Cancel</button>
										</div>
									</div>
								{:else}
									<div class="history-head">
										<p class="history-name">{session.groupName || '—'}</p>
										<div class="history-head-right">
											<span class={`outcome-pill ${outcomeClass(session.outcome)}`}>{session.outcome}</span>
											{#if canEdit}
											<button class="btn-edit-session" on:click={() => startEdit(session)}>Edit</button>
											<button class="btn-delete-session" on:click={() => deleteSession(session.id)}>Delete</button>
											{/if}
										</div>
									</div>
									{@const resolvedNames = session.dogNames.length > 0
										? session.dogNames
										: session.dogIds.map((id) => dogs.find((d) => d.id === id)?.name ?? id)}
									<p class="history-meta typewriter">
										{formatDateTime(session.date)} • {resolvedNames.length} dog(s)
										{#if session.durationMinutes}
											• {session.durationMinutes} min
										{/if}
									</p>
									<p class="history-dogs">{resolvedNames.join(', ')}</p>
									{#if session.notes}
										<p class="history-notes">{session.notes}</p>
									{/if}
									<p class="history-logger typewriter">Logged by {session.loggedByName}</p>
								{/if}
							</article>
						{/each}
					</div>
				{/if}
			</section>
			{/if}
		{/if}

		{#if showManualModal}
			<div class="manual-modal-overlay" use:portal role="presentation" on:click|self={() => showManualModal = false}>
				<div class="manual-modal" role="dialog" aria-modal="true" aria-label="Log playgroup">
					<div class="manual-modal-head">
						<p class="manual-modal-title typewriter">Log playgroup</p>
						<button class="manual-modal-close" type="button" aria-label="Close" on:click={() => showManualModal = false}>×</button>
					</div>
					<form class="manual-form" on:submit|preventDefault={saveManualSession}>
						<div class="manual-grid">
							<label class="form-field" for="manual-group-name">
								<span class="typewriter">Group name (optional)</span>
								<input id="manual-group-name" bind:value={manualGroupName} placeholder="Morning Yard Group A" />
							</label>
							<label class="form-field" for="manual-date">
								<span class="typewriter">Date</span>
								<input id="manual-date" type="date" bind:value={manualDate} />
							</label>
							<label class="form-field" for="manual-duration">
								<span class="typewriter">Duration (minutes)</span>
								<input id="manual-duration" type="number" min="1" bind:value={manualDuration} placeholder="30" />
							</label>
							<label class="form-field" for="manual-outcome">
								<span class="typewriter">Outcome</span>
								<select id="manual-outcome" bind:value={manualOutcome}>
									<option value="successful">Successful</option>
									<option value="mixed">Mixed</option>
									<option value="incident">Incident</option>
									<option value="cancelled">Cancelled</option>
								</select>
							</label>
							<label class="form-field form-field-wide" for="manual-notes">
								<span class="typewriter">Notes</span>
								<textarea id="manual-notes" rows="2" bind:value={manualNotes} placeholder="Behavior notes, handling notes, staff observations"></textarea>
							</label>
						</div>

						<div class="manual-dogs">
							<p class="manual-dogs-label">Select dogs for this session</p>
							<div class="manual-dog-list">
								{#each activeDogs as dog}
									<label class="manual-dog-option">
										<input
											type="checkbox"
											checked={manualDogIds.includes(dog.id)}
											on:change={(event) => toggleManualDog(dog.id, event.currentTarget.checked)}
										/>
										<span>{dog.name}</span>
									</label>
								{/each}
							</div>
						</div>

						<label class="form-field">
							<span>Add dogs not at shelter</span>
							<input
								type="text"
								bind:value={manualExtraNames}
								placeholder="e.g. Buddy, Rosie (comma-separated)"
							/>
						</label>

						<button class="manual-save-btn typewriter" type="submit" disabled={savingManual}>
							{savingManual ? 'Saving...' : 'Add to history'}
						</button>
					</form>
				</div>
			</div>
		{/if}
	</section>
{/if}

<style>
	.playgroups-board {
		border: 1px solid #d5e0ea;
		background: rgba(255, 255, 255, 0.9);
	}

	.playgroups-header {
		display: grid;
		gap: 0.38rem;
		padding: 0.82rem;
		border-bottom: 1px solid #d5e0ea;
	}

	.playgroups-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: clamp(1.5rem, 5.6vw, 2.1rem);
		text-transform: uppercase;
	}

	.playgroups-sub {
		margin: 0;
		font-size: 0.95rem;
	}

	.playgroups-controls {
		display: grid;
		gap: 0.4rem;
	}

	.playgroups-search {
		width: 100%;
		max-width: 22rem;
		border: 1px solid #d5e0ea;
		border-radius: 0.24rem;
		padding: 0.46rem 0.58rem;
		font-size: 1rem;
	}

	.stats-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.stat-chip {
		display: inline-flex;
		align-items: center;
		border: 1px solid #b8c7d9;
		border-radius: 999px;
		padding: 0.16rem 0.54rem;
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		background: #f8fbff;
		color: #3a5372;
	}

	.stat-ready {
		border-color: #a9d4b3;
		background: #eef8f0;
		color: #2e6b42;
	}

	.stat-caution {
		border-color: #e3cf97;
		background: #fff8e5;
		color: #79632d;
	}

	.stat-hold {
		border-color: #e2b6b6;
		background: #fff2f2;
		color: #7a3e3e;
	}

	.playgroups-state {
		padding: 0.82rem;
	}

	.playgroups-restricted {
		min-height: 10rem;
		display: grid;
		align-content: center;
	}

	.pg-tab-bar {
		display: flex;
		border-top: 1px solid #d5e0ea;
		background: #f4f7fa;
	}

	.pg-tab {
		flex: 1;
		padding: 0.5rem 0.4rem;
		font-family: var(--font-typewriter);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #4f6580;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}

	.pg-tab:hover {
		background: #eaf0f7;
	}

	.pg-tab-active {
		color: #016aa5;
		border-bottom-color: #016aa5;
		background: #fff;
	}

	.playgroups-grid {
		display: grid;
		gap: 0;
	}

	.panel {
		border-top: 1px solid #d5e0ea;
		padding: 0.62rem 0.82rem;
		background: #ffffff;
	}

	.panel-head h3 {
		margin: 0;
		font-family: var(--font-ui);
		font-size: clamp(1.28rem, 5.8vw, 1.8rem);
		font-weight: 400;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		line-height: 1.02;
	}

	.panel-note {
		margin: 0.2rem 0 0;
		font-size: 0.68rem;
		color: #4f6681;
	}

	.empty-line {
		margin-top: 0.5rem;
		font-size: 0.66rem;
		color: #627890;
	}

	.dog-card-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.52rem;
	}

	.dog-card {
		border: 1px solid #c9d5e3;
		border-radius: 0.3rem;
		padding: 0.6rem 0.7rem;
	}

	.dog-card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dog-card-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.3rem;
		font-size: 0.72rem;
		color: #4f6681;
	}

	.dog-card-guidance {
		margin: 0.3rem 0 0;
		font-size: 0.72rem;
		color: #3a5069;
	}

	.list-wrap {
		display: none;
		margin-top: 0.52rem;
		overflow-x: auto;
	}

	@media (min-width: 700px) {
		.dog-card-list { display: none; }
		.list-wrap { display: block; }
	}

	.dog-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.78rem;
	}

	.dog-table th {
		text-align: left;
		padding: 0.42rem;
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #4a607a;
		border-bottom: 1px solid #c9d5e3;
	}

	.dog-table td {
		padding: 0.45rem 0.42rem;
		border-bottom: 1px solid #e3eaf2;
		vertical-align: top;
	}

	.dog-link {
		font-weight: 700;
		color: #1f3b5c;
		text-decoration: none;
	}

	.dog-link:hover {
		text-decoration: underline;
	}

	.table-meta {
		margin: 0.15rem 0 0;
		font-size: 0.54rem;
		color: #5f748d;
	}

	.readiness-pill {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.12rem 0.46rem;
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.readiness-ready {
		background: #e9f6ec;
		color: #256640;
		border: 1px solid #abd5b4;
	}

	.readiness-caution {
		background: #fff7e3;
		color: #816829;
		border: 1px solid #e2cd97;
	}

	.readiness-hold {
		background: #fff0f0;
		color: #8a3e3c;
		border: 1px solid #e6bbbb;
	}

	.readiness-eval {
		background: #fdf4e3;
		color: #7a5a1e;
		border: 1px solid #e8d49a;
	}

	.recommendation-grid {
		margin-top: 0.52rem;
		display: grid;
		gap: 0.48rem;
	}

	.recommendation-card {
		border: 1px solid #c6d4e4;
		background: #fbfdff;
		padding: 0.52rem;
	}

	.recommendation-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.recommendation-head h4 {
		margin: 0;
		font-size: 0.95rem;
		color: #223951;
	}

	.priority-chip {
		border: 1px solid #c3d2e3;
		border-radius: 999px;
		padding: 0.12rem 0.42rem;
		font-size: 0.56rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #3f5e80;
		background: #f4f9ff;
	}

	.dog-chip-row {
		margin-top: 0.36rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.26rem;
	}

	.dog-chip {
		border: 1px solid #b8cde5;
		border-radius: 999px;
		padding: 0.12rem 0.42rem;
		font-size: 0.66rem;
		font-weight: 700;
		text-decoration: none;
		color: #284c6f;
		background: #f2f8ff;
	}

	.size-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1em;
		height: 1.1em;
		border-radius: 50%;
		font-size: 0.55em;
		font-weight: 900;
		margin-left: 0.22em;
		vertical-align: middle;
		line-height: 1;
	}

	.size-badge-tiny {
		background: #fce8e8;
		color: #8a3e3c;
		border: 1px solid #e6b8b8;
	}

	.size-badge-small {
		background: #fdf3e3;
		color: #7a4f10;
		border: 1px solid #f0c87a;
	}

	.size-badge-medium {
		background: #e8f4fc;
		color: #016aa5;
		border: 1px solid #b0d4ee;
	}

	.size-badge-large {
		background: #ede8fc;
		color: #5a3a8a;
		border: 1px solid #c5b4e8;
	}

	.size-badge-unknown {
		background: #f0f2f5;
		color: #7a8fa6;
		border: 1px solid #c8d3df;
	}

	.size-unknown-note {
		margin: 0.3rem 0 0;
		font-size: 0.66rem;
		color: #816829;
	}

	.recommendation-reason {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		color: #334f6c;
	}

	.recommendation-log-btn {
		margin-top: 0.46rem;
		min-height: 1.95rem;
		border: 1px solid #d5e0ea;
		border-radius: 0.42rem;
		padding: 0.18rem 0.52rem;
		font-size: 0.58rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 700;
		background: #dff0ff;
		color: #1c3f63;
	}

	.recommendation-log-btn:disabled {
		opacity: 0.6;
	}

	.panel-history {
		display: grid;
		gap: 0.65rem;
	}

	.manual-form {
		background: #fbfdff;
		padding: 0.56rem 0 0;
	}

	.manual-grid {
		display: grid;
		gap: 0.36rem;
	}

	.form-field {
		display: grid;
		gap: 0.14rem;
	}

	.form-field span {
		font-size: 0.53rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #4a6079;
	}

	.form-field input,
	.form-field select,
	.form-field textarea {
		width: 100%;
		border: 1px solid #becbdd;
		border-radius: 0.42rem;
		padding: 0.34rem 0.44rem;
		font-size: 0.74rem;
		color: #24384f;
		background: #ffffff;
	}

	.form-field-wide {
		grid-column: 1 / -1;
	}

	.manual-dogs {
		margin-top: 0.45rem;
	}

	.manual-dogs p,
	.manual-dogs-label {
		margin: 0;
		font-size: 0.68rem;
		color: #4d637d;
	}

	.manual-dog-list {
		margin-top: 0.3rem;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.26rem;
	}

	.manual-dog-option {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
		font-size: 0.72rem;
		color: #304a66;
	}

	.manual-save-btn {
		margin-top: 0.5rem;
		min-height: 1.95rem;
		border: 1px solid #d5e0ea;
		border-radius: 0.42rem;
		padding: 0.2rem 0.52rem;
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 700;
		background: #d8f0de;
		color: #21563a;
	}

	.manual-save-btn:disabled {
		opacity: 0.6;
	}

	.panel-head-right {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.log-manual-btn {
		flex-shrink: 0;
		border: 1px solid #a9d4b3;
		border-radius: 0.42rem;
		padding: 0.22rem 0.6rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		background: #e9f6ec;
		color: #21563a;
		cursor: pointer;
	}

	.log-manual-btn:hover {
		background: #d5eedb;
	}

	.manual-modal-overlay {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		background: rgba(0, 0, 0, 0.38);
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.manual-modal {
		background: #fff;
		border: 1px solid #c8d5e4;
		border-radius: 0.42rem;
		width: 100%;
		max-width: 30rem;
		max-height: min(90vh, 90dvh);
		overflow-y: auto;
		padding: 0.82rem;
		padding-bottom: max(0.82rem, env(safe-area-inset-bottom));
	}

	.manual-modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.6rem;
	}

	.manual-modal-title {
		margin: 0;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #2e4a66;
	}

	.manual-modal-close {
		background: none;
		border: none;
		font-size: 1.1rem;
		line-height: 1;
		color: #7a8fa6;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.manual-modal-close:hover {
		color: #2e4a66;
	}

	.history-list {
		display: grid;
		gap: 0.42rem;
	}

	.history-card {
		border: 1px solid #c8d5e4;
		background: #ffffff;
		padding: 0.48rem;
	}

	.history-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.history-name {
		margin: 0;
		font-weight: 800;
		font-size: 0.86rem;
		color: #22384f;
	}

	.history-meta,
	.history-logger {
		margin: 0.2rem 0 0;
		font-size: 0.56rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #4f6580;
	}

	.history-dogs {
		margin: 0.24rem 0 0;
		font-size: 0.76rem;
		color: #2f4a66;
	}

	.history-notes {
		margin: 0.22rem 0 0;
		font-size: 0.76rem;
		color: #3b4f68;
	}

	.history-head-right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.btn-edit-session {
		background: none;
		border: 1px solid #b0c4d8;
		border-radius: 3px;
		padding: 0.1rem 0.36rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #4f6580;
		cursor: pointer;
	}
	.btn-edit-session:hover {
		background: #eaf0f7;
	}

	.btn-delete-session {
		background: none;
		border: 1px solid #e2b6b6;
		border-radius: 3px;
		padding: 0.1rem 0.36rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8a3e3c;
		cursor: pointer;
	}
	.btn-delete-session:hover {
		background: #fff0f0;
	}

	.history-edit-form {
		display: grid;
		gap: 0.4rem;
	}

	.history-edit-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}

	.history-edit-actions {
		display: flex;
		gap: 0.4rem;
	}

	.edit-dog-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.15rem 0.5rem;
		max-height: 140px;
		overflow-y: auto;
		border: 1px solid #d5e0ea;
		border-radius: 4px;
		padding: 0.4rem 0.5rem;
		background: #f7fbff;
	}

	.edit-dog-item {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.72rem;
		color: #2c3e50;
		cursor: pointer;
		white-space: nowrap;
	}

	.edit-dog-item-inactive {
		opacity: 0.6;
	}

	.edit-dog-left {
		font-size: 0.62rem;
		color: #7a8fa0;
		font-style: italic;
	}

	.btn-save-edit {
		background: #016aa5;
		color: #fff;
		border: none;
		border-radius: 3px;
		padding: 0.28rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 700;
		cursor: pointer;
	}
	.btn-save-edit:disabled {
		opacity: 0.6;
	}

	.btn-cancel-edit {
		background: none;
		border: 1px solid #b0c4d8;
		border-radius: 3px;
		padding: 0.28rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: #4f6580;
		cursor: pointer;
	}

	.outcome-pill {
		border-radius: 999px;
		padding: 0.13rem 0.44rem;
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border: 1px solid transparent;
	}

	.outcome-success {
		background: #e9f6ec;
		color: #256640;
		border-color: #abd5b4;
	}

	.outcome-mixed {
		background: #fff8e5;
		color: #7a652b;
		border-color: #e3cf98;
	}

	.outcome-incident {
		background: #fff1f1;
		color: #8d3a38;
		border-color: #e1b8b8;
	}

	.outcome-cancelled {
		background: #f2f4f7;
		color: #53657c;
		border-color: #c9d3df;
	}

	@media (min-width: 860px) {
		.playgroups-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.panel:nth-child(even) {
			border-left: 3px solid #016ba5;
		}

		.panel-history {
			grid-column: 1 / -1;
			border-left: none;
		}

		.manual-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	@media (max-width: 680px) {
		.manual-dog-list {
			grid-template-columns: 1fr;
		}
	}

	/* Slack import header button */
	.controls-top-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.header-actions {
		display: flex;
		gap: 0.4rem;
		margin-left: auto;
	}

	.slack-toggle-btn {
		border: 1px solid #016aa5;
		border-radius: 0.42rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.58rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 700;
		background: #e8f4fc;
		color: #016aa5;
		cursor: pointer;
	}

	.slack-toggle-btn:hover {
		background: #d0eaf8;
	}

	/* Pending banner */
	.slack-pending-bar {
		border-top: 1px solid #d5e0ea;
		background: #fffbea;
		border-left: 4px solid #e6a800;
		padding: 0.6rem 0.82rem;
	}

	.slack-pending-label {
		display: block;
		font-size: 0.58rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #6b4f00;
		margin-bottom: 0.4rem;
	}

	.slack-pending-list {
		display: grid;
		gap: 0.32rem;
	}

	.slack-pending-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		background: #fff8d6;
		border: 1px solid #e6cc7a;
		border-radius: 0.42rem;
		padding: 0.38rem 0.52rem;
	}

	.slack-pending-dogs {
		font-size: 0.76rem;
		color: #3a2e00;
		flex: 1;
		min-width: 0;
	}

	.slack-pending-actions {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.slack-pending-btn {
		border: 1px solid #016aa5;
		border-radius: 0.42rem;
		padding: 0.22rem 0.52rem;
		font-size: 0.56rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 700;
		background: #e8f4fc;
		color: #016aa5;
		cursor: pointer;
	}

	.slack-pending-dismiss {
		border: 1px solid #c8d0db;
		border-radius: 0.42rem;
		padding: 0.22rem 0.52rem;
		font-size: 0.56rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 700;
		background: #f4f6f9;
		color: #4f6681;
		cursor: pointer;
	}

	/* Paste import panel */
	.slack-import-panel,
	.slack-confirm-panel {
		border-top: 1px solid #d5e0ea;
		background: #f8fbff;
		padding: 0.7rem 0.82rem;
	}

	.slack-paste-area {
		width: 100%;
		border: 1px solid #becbdd;
		border-radius: 0.42rem;
		padding: 0.44rem 0.52rem;
		font-size: 0.76rem;
		font-family: var(--font-typewriter);
		color: #22384f;
		resize: vertical;
		background: #fff;
	}

	.slack-parse-btn {
		margin-top: 0.4rem;
		border: 1px solid #016aa5;
		border-radius: 0.42rem;
		padding: 0.3rem 0.9rem;
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 700;
		background: #016aa5;
		color: #fff;
		cursor: pointer;
	}

	.slack-parse-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.slack-confirm-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.slack-confirm-title {
		margin: 0;
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #4a607a;
	}

	.slack-back-btn {
		border: 1px solid #c8d3e0;
		border-radius: 0.42rem;
		padding: 0.18rem 0.46rem;
		font-size: 0.54rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		background: #f0f5fb;
		color: #4a607a;
		cursor: pointer;
	}

	.slack-dog-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-bottom: 0.4rem;
	}

	.slack-dog-pill {
		border-radius: 999px;
		padding: 0.14rem 0.5rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		cursor: pointer;
		font-family: inherit;
	}

	.pill-matched {
		background: #e9f6ec;
		color: #256640;
		border: 1px solid #abd5b4;
	}

	.pill-archived {
		background: #fef3e2;
		color: #7a4f10;
		border: 1px solid #f0c87a;
	}

	.pill-unmatched {
		background: #f0f2f5;
		color: #7a8fa6;
		border: 1px solid #c8d3df;
	}

	.pill-excluded {
		background: #f5f5f5;
		color: #b0b0b0;
		border: 1px solid #d4d4d4;
		text-decoration: line-through;
		opacity: 0.6;
	}

	.slack-unmatched-note {
		margin: 0 0 0.4rem;
		font-size: 0.68rem;
		color: #7a6530;
	}

	.slack-confirm-fields {
		display: grid;
		gap: 0.36rem;
		margin-bottom: 0.5rem;
	}

	@media (min-width: 620px) {
		.slack-confirm-fields {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.slack-confirm-raw {
		margin-bottom: 0.5rem;
	}

	.slack-confirm-raw p {
		margin: 0 0 0.2rem;
		font-size: 0.54rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #617990;
	}

	.slack-raw-text {
		margin: 0;
		padding: 0.44rem 0.52rem;
		background: #f2f5f9;
		border: 1px solid #cdd8e6;
		border-radius: 0.42rem;
		font-size: 0.72rem;
		color: #2b3f57;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 10rem;
		overflow-y: auto;
	}

	.slack-save-btn {
		border: 1px solid #3aaf2a;
		border-radius: 0.42rem;
		padding: 0.3rem 0.9rem;
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 700;
		background: #3aaf2a;
		color: #fff;
		cursor: pointer;
	}

	.slack-save-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.unknown-weight-section {
		margin-top: 1rem;
		border-top: 1px solid #d5e0ea;
		padding-top: 0.6rem;
	}

	.unknown-weight-title {
		margin: 0 0 0.4rem;
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7a8fa6;
	}

	.unknown-weight-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.28rem;
	}

	.unknown-weight-chip {
		border: 1px solid #c8d3df;
		border-radius: 999px;
		padding: 0.12rem 0.42rem;
		font-size: 0.66rem;
		font-weight: 700;
		text-decoration: none;
		color: #7a8fa6;
		background: #f0f2f5;
	}

	.unknown-weight-chip:hover {
		background: #e4e8ed;
	}

	.test-section {
		margin-top: 1.2rem;
		border-top: 1px solid #d5e0ea;
		padding-top: 0.8rem;
	}

	.test-section-head {
		margin-bottom: 0.52rem;
	}

	.test-section-title {
		margin: 0 0 0.18rem;
		font-size: 0.9rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #816829;
	}

	.test-section-note {
		margin: 0;
		font-size: 0.68rem;
		color: #4f6681;
	}

	.test-grid {
		display: grid;
		gap: 0.42rem;
	}

	.test-card {
		border: 1px solid #e3cf97;
		background: #fffdf0;
		border-radius: 0.3rem;
		padding: 0.52rem;
	}

	.test-card-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.24rem;
	}

	.test-reason {
		margin: 0 0 0.2rem;
		font-size: 0.74rem;
		color: #3a5069;
	}

	.test-suggested {
		margin: 0;
		font-size: 0.72rem;
		color: #5a6e84;
	}

	.test-suggested strong {
		color: #22384f;
	}

	@media (min-width: 620px) {
		.test-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
