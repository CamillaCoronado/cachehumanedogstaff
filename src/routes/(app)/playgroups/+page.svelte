<script lang="ts">
	import { onMount } from 'svelte';
	import { format } from 'date-fns';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { listDogs } from '$lib/data/dogs';
	import { addPlaygroupSession, listPlaygroupSessions } from '$lib/data/playgroups';
	import { formatDateTime, toDate } from '$lib/utils/dates';
	import type { Dog, PlaygroupOutcome, PlaygroupSession } from '$lib/types';
	import { energyLabel, compatibilityLabel } from '$lib/utils/labels';

	type DogReadiness = 'ready' | 'caution' | 'hold';
	type RecommendationPriority = 'high' | 'medium';

	interface PlaygroupRecommendation {
		id: string;
		title: string;
		dogs: Dog[];
		dogIds: string[];
		reason: string;
		recommendationType: PlaygroupSession['recommendationType'];
		priority: RecommendationPriority;
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

	onMount(async () => {
		await refreshData();
	});

	$: activeDogs = dogs
		.filter((dog) => dog.status === 'active')
		.sort((a, b) => a.name.localeCompare(b.name));
	$: filteredDogs = activeDogs.filter((dog) => dog.name.toLowerCase().includes(search.toLowerCase()));
	$: readyDogs = activeDogs.filter((dog) => getReadiness(dog) === 'ready');
	$: cautionDogs = activeDogs.filter((dog) => getReadiness(dog) === 'caution');
	$: holdDogs = activeDogs.filter((dog) => getReadiness(dog) === 'hold');
	$: recommendations = buildRecommendations(readyDogs, cautionDogs);
	$: history = [...sessions].sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0));


	function getReadiness(dog: Dog): DogReadiness {
		if (dog.isolationStatus !== 'none' || dog.goodWithDogs === 'no') return 'hold';
		if (dog.goodWithDogs === 'yes') return 'ready';
		return 'caution';
	}

	function readinessLabel(readiness: DogReadiness) {
		if (readiness === 'ready') return 'Ready';
		if (readiness === 'caution') return 'Caution';
		return 'Hold';
	}

	function guidanceForDog(dog: Dog) {
		const readiness = getReadiness(dog);
		if (readiness === 'hold') {
			if (dog.isolationStatus !== 'none') return 'In isolation: do not schedule.';
			return 'Marked not dog-social: behavior team only.';
		}
		if (readiness === 'caution') return 'Unknown dog compatibility: do controlled intro with a stable dog.';
		return 'Eligible for standard playgroup rotation.';
	}

	function dateDayCount(value: Dog['intakeDate']) {
		const date = toDate(value);
		if (!date) return null;
		return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
	}

	function energyRank(value: Dog['energyLevel']) {
		if (value === 'low') return 1;
		if (value === 'medium') return 2;
		if (value === 'high') return 3;
		if (value === 'very_high') return 4;
		return 2;
	}

	function buildRecommendations(ready: Dog[], caution: Dog[]): PlaygroupRecommendation[] {
		const list: PlaygroupRecommendation[] = [];
		const sortedReady = [...ready].sort((a, b) => {
			const diff = energyRank(a.energyLevel) - energyRank(b.energyLevel);
			if (diff !== 0) return diff;
			return a.name.localeCompare(b.name);
		});

		for (let i = 0; i < sortedReady.length; i += 2) {
			const group = sortedReady.slice(i, i + 2);
			if (group.length < 2) continue;
			const number = Math.floor(i / 2) + 1;
			list.push({
				id: `ready-${group.map((dog) => dog.id).join('-')}`,
				title: `Ready Group ${number}`,
				dogs: group,
				dogIds: group.map((dog) => dog.id),
				reason: 'Both dogs are marked good with dogs and have compatible energy levels.',
				recommendationType: 'ready_group',
				priority: 'high'
			});
		}

		const usedAnchorIds = new Set<string>();
		for (const cautionDog of caution) {
			const anchor = sortedReady
				.filter((candidate) => !usedAnchorIds.has(candidate.id))
				.sort((a, b) => {
					const diffA = Math.abs(energyRank(a.energyLevel) - energyRank(cautionDog.energyLevel));
					const diffB = Math.abs(energyRank(b.energyLevel) - energyRank(cautionDog.energyLevel));
					if (diffA !== diffB) return diffA - diffB;
					return a.name.localeCompare(b.name);
				})[0];
			if (!anchor) continue;
			usedAnchorIds.add(anchor.id);
			list.push({
				id: `eval-${cautionDog.id}-${anchor.id}`,
				title: `Evaluation Pair: ${cautionDog.name} + ${anchor.name}`,
				dogs: [cautionDog, anchor],
				dogIds: [cautionDog.id, anchor.id],
				reason: `${cautionDog.name} has unknown compatibility, so pair with a stable ready dog for supervised intro.`,
				recommendationType: 'evaluation_group',
				priority: 'medium'
			});
		}

		return list.slice(0, 12);
	}

	function priorityLabel(priority: RecommendationPriority) {
		return priority === 'high' ? 'High priority' : 'Evaluation';
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

	async function refreshData() {
		loading = true;
		[dogs, sessions] = await Promise.all([listDogs(), listPlaygroupSessions()]);
		loading = false;
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
		if (!manualGroupName.trim()) {
			toast.error('Group name is required.');
			return;
		}
		const selectedDogs = activeDogs.filter((dog) => manualDogIds.includes(dog.id));
		if (selectedDogs.length < 2) {
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
					dogNames: selectedDogs.map((dog) => dog.name),
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
			manualDate = format(new Date(), 'yyyy-MM-dd');
			toast.success('Playgroup session saved.');
		} catch (error) {
			console.error(error);
			toast.error('Unable to save playgroup session.');
		} finally {
			savingManual = false;
		}
	}

	function outcomeClass(value: PlaygroupOutcome) {
		if (value === 'successful') return 'outcome-success';
		if (value === 'mixed') return 'outcome-mixed';
		if (value === 'incident') return 'outcome-incident';
		return 'outcome-cancelled';
	}
</script>

<section class="playgroups-board" aria-label="Playgroups board">
	<header class="playgroups-header">
		<div class="playgroups-controls">
			<input
				class="playgroups-search typewriter"
				placeholder="search dog name"
				bind:value={search}
			/>
			<div class="stats-row typewriter">
				<span class="stat-chip stat-ready">Ready: {readyDogs.length}</span>
				<span class="stat-chip stat-caution">Caution: {cautionDogs.length}</span>
				<span class="stat-chip stat-hold">Hold: {holdDogs.length}</span>
				<span class="stat-chip">History: {history.length}</span>
			</div>
		</div>
	</header>

	{#if loading}
		<p class="playgroups-state marker-line marker-muted">Loading playgroups...</p>
	{:else}
		<div class="playgroups-grid">
			<section class="panel">
				<div class="panel-head">
					<h3>Dog List</h3>
					<p class="panel-note typewriter">Use this as the source roster for group planning.</p>
				</div>
				{#if filteredDogs.length === 0}
					<p class="empty-line typewriter">No active dogs match search.</p>
				{:else}
					<!-- Mobile cards -->
					<div class="dog-card-list">
						{#each filteredDogs as dog}
							{@const readiness = getReadiness(dog)}
							<div class="dog-card">
								<div class="dog-card-top">
									<a href={`/dogs/${dog.id}`} class="dog-link">{dog.name}</a>
									<span class={`readiness-pill readiness-${readiness}`}>{readinessLabel(readiness)}</span>
								</div>
								<div class="dog-card-meta typewriter">
									<span>Energy: {energyLabel(dog.energyLevel)}</span>
									<span>Run: {dog.outdoorKennelAssignment || 'Unassigned'}</span>
									<span>{dateDayCount(dog.intakeDate) ?? '—'} days in</span>
								</div>
								{#if guidanceForDog(dog)}
									<p class="dog-card-guidance typewriter">{guidanceForDog(dog)}</p>
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
										<td><span class={`readiness-pill readiness-${readiness}`}>{readinessLabel(readiness)}</span></td>
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

			<section class="panel">
				<div class="panel-head">
					<h3>Recommended Playgroups</h3>
					<p class="panel-note typewriter">Auto-suggested from readiness + energy compatibility.</p>
				</div>
				{#if recommendations.length === 0}
					<p class="empty-line typewriter">No recommendations yet. Add more ready dogs for pairing.</p>
				{:else}
					<div class="recommendation-grid">
						{#each recommendations as recommendation}
							<article class="recommendation-card">
								<div class="recommendation-head">
									<h4>{recommendation.title}</h4>
									<span class="priority-chip">{priorityLabel(recommendation.priority)}</span>
								</div>
								<div class="dog-chip-row">
									{#each recommendation.dogs as dog}
										<a href={`/dogs/${dog.id}`} class="dog-chip">{dog.name}</a>
									{/each}
								</div>
								<p class="recommendation-reason">{recommendation.reason}</p>
								<button
									class="recommendation-log-btn typewriter"
									type="button"
									on:click={() => logRecommendation(recommendation)}
									disabled={loggingRecommendationId === recommendation.id}
								>
									{loggingRecommendationId === recommendation.id ? 'Saving...' : 'Log to history'}
								</button>
							</article>
						{/each}
					</div>
				{/if}
			</section>

			<section class="panel panel-history">
				<div class="panel-head">
					<h3>Playgroup History</h3>
					<p class="panel-note typewriter">All previously logged playgroups.</p>
				</div>

				<form class="manual-form" on:submit|preventDefault={saveManualSession}>
					<div class="manual-grid">
						<label class="form-field" for="manual-group-name">
							<span class="typewriter">Group name</span>
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
						<p class="typewriter">Select dogs for this session</p>
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

					<button class="manual-save-btn typewriter" type="submit" disabled={savingManual}>
						{savingManual ? 'Saving...' : 'Add to history'}
					</button>
				</form>

				{#if history.length === 0}
					<p class="empty-line typewriter">No previous playgroups logged yet.</p>
				{:else}
					<div class="history-list">
						{#each history as session}
							<article class="history-card">
								<div class="history-head">
									<p class="history-name">{session.groupName}</p>
									<span class={`outcome-pill ${outcomeClass(session.outcome)}`}>{session.outcome}</span>
								</div>
								<p class="history-meta typewriter">
									{formatDateTime(session.date)} • {session.dogNames.length} dog(s)
									{#if session.durationMinutes}
										• {session.durationMinutes} min
									{/if}
								</p>
								<p class="history-dogs">{session.dogNames.join(', ')}</p>
								{#if session.notes}
									<p class="history-notes">{session.notes}</p>
								{/if}
								<p class="history-logger typewriter">Logged by {session.loggedByName}</p>
							</article>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{/if}
</section>

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
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.stats-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.stat-chip {
		display: inline-flex;
		align-items: center;
		border: 1.5px solid #b8c7d9;
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
		font-size: 0.58rem;
		letter-spacing: 0.07em;
		text-transform: uppercase;
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
		border: 1.5px solid #c9d5e3;
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
		text-transform: uppercase;
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

	.recommendation-grid {
		margin-top: 0.52rem;
		display: grid;
		gap: 0.48rem;
	}

	.recommendation-card {
		border: 1.5px solid #c6d4e4;
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

	.recommendation-reason {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		color: #334f6c;
	}

	.recommendation-log-btn {
		margin-top: 0.46rem;
		min-height: 1.95rem;
		border: 1px solid #d5e0ea;
		border-radius: 0.2rem;
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
		border: 1.5px solid #cedae8;
		background: #fbfdff;
		padding: 0.56rem;
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
		border: 1.5px solid #becbdd;
		border-radius: 0.2rem;
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

	.manual-dogs p {
		margin: 0;
		font-size: 0.55rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
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
		border-radius: 0.2rem;
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

	.history-list {
		display: grid;
		gap: 0.42rem;
	}

	.history-card {
		border: 1.5px solid #c8d5e4;
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
</style>
