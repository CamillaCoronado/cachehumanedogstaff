<script lang="ts">
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { deleteDayTripLog } from '$lib/data/dogs';
	import TripLogForm from '$lib/components/daytrips/TripLogForm.svelte';
	import type { DayTripLog, Dog } from '$lib/types';
	import { toDate } from '$lib/utils/dates';
	import { durationHours, formatDuration, formatTime, formatShortDate } from '$lib/utils/daytrips';

	export let dogs: Dog[] = [];
	export let logs: DayTripLog[] = [];
	export let monthlyLogs: DayTripLog[] = [];
	export let monthLabel = '';
	export let monthlyHourTotal = 0;
	export let outNowCount = 0;
	export let dogsEligible: Dog[] = [];
	export let dtvNames: string[] = [];
	export let canEditDayTrips = false;
	export let monthFilter = '';
	export let refresh: () => Promise<void>;

	let tripCopyText = '';
	let showAllLogs = false;
	let deletingTripId = '';
	let formOpen = false;
	let tripSaved = false;

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success('Copied!');
		} catch {
			toast.error('Copy failed — select and copy manually.');
		}
	}


	$: sortedMonthlyLogs = [...monthlyLogs]
		.filter((log) => Boolean(log.endedAt))
		.sort((a, b) => {
			const aTime = toDate(a.startedAt)?.getTime() ?? 0;
			const bTime = toDate(b.startedAt)?.getTime() ?? 0;
			return bTime - aTime;
		});

	$: visibleLogs = showAllLogs
		? [...logs].filter(l => Boolean(l.endedAt)).sort((a, b) => (toDate(b.startedAt)?.getTime() ?? 0) - (toDate(a.startedAt)?.getTime() ?? 0))
		: sortedMonthlyLogs;


	async function handleDeleteTrip(log: DayTripLog) {
		if (!confirm(`Delete this trip for ${dogs.find(d => d.id === log.dogId)?.name ?? 'this dog'}? This cannot be undone.`)) return;
		deletingTripId = log.id;
		try {
			await deleteDayTripLog(log.dogId, log.id);
			await refresh();
		} catch {
			toast.error('Failed to delete trip.');
		} finally {
			deletingTripId = '';
		}
	}

</script>

			<!-- Collapsible log form (coordinators only) -->
			{#if canEditDayTrips}
			<div class="dt-panel dt-logform-panel">
				<button class="dt-logform-toggle" on:click={() => { formOpen = !formOpen; tripSaved = false; tripCopyText = ''; }}>
					<span class="dt-logform-toggle-label">Log a trip</span>
					<span class="dt-logform-toggle-icon">{formOpen ? '▲' : '▼'}</span>
				</button>

				{#if formOpen}
					{#if tripSaved && tripCopyText}
						<div class="trip-copy-block">
							<p class="trip-copy-label">Saved — copy for ASM:</p>
							<pre class="trip-copy-pre">{tripCopyText}</pre>
							<div class="trip-copy-actions">
								<button class="dt-import-btn dt-import-btn-go" on:click={() => copyToClipboard(tripCopyText)}>Copy</button>
								<button class="dt-import-btn" on:click={() => { tripSaved = false; tripCopyText = ''; }}>Log another</button>
							</div>
						</div>
					{:else}
						<div class="trip-form-wrap">
							<TripLogForm
								dogs={dogsEligible}
								source="staff"
								profile={$authProfile}
								volunteerNames={dtvNames}
								on:submitted={async (e) => {
									tripCopyText = e.detail.copyText;
									tripSaved = true;
									await refresh();
								}}
							/>
						</div>
					{/if}
				{/if}
			</div>
			{/if}

			<div class="dt-panel">
				<div class="dt-panel-head">
					<div>
						<p class="dt-panel-title">{showAllLogs ? 'All trips' : monthLabel}</p>
						<p class="dt-panel-sub">{visibleLogs.length} completed trip{visibleLogs.length === 1 ? '' : 's'}{!showAllLogs ? ` · ${monthlyHourTotal.toFixed(1)} total hrs` : ''}
						{outNowCount > 0 ? ` · ${outNowCount} in progress` : ''}</p>
					</div>
					<div class="dt-log-controls">
						{#if !showAllLogs}
							<input class="dt-month-input" type="month" bind:value={monthFilter} />
						{/if}
						<button class="dt-toggle-btn" class:active={showAllLogs} on:click={() => showAllLogs = !showAllLogs}>
							{showAllLogs ? 'Show month' : 'All time'}
						</button>
					</div>
				</div>

				{#if visibleLogs.length === 0}
					<p class="dt-panel-empty">No completed trips logged{showAllLogs ? '.' : ` for ${monthLabel}.`}</p>
				{:else}
					<div class="dt-table-wrap">
						<table class="dt-table">
							<thead>
								<tr>
									<th>Date</th>
									<th>Dog</th>
									<th>Volunteer</th>
									<th>Time Out</th>
									<th>Time In</th>
									<th>Duration</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each visibleLogs as log}
									{@const startDate = toDate(log.startedAt)}
									{@const endDate = toDate(log.endedAt)}
									{@const dog = dogs.find(d => d.id === log.dogId)}
									<tr class:deleting={deletingTripId === log.id}>
										<td class="td-muted">{formatShortDate(startDate)}</td>
										<td class="td-name">
											{#if dog}
												<a href="/dogs/{dog.id}" class="dt-name-link">{dog.name}</a>
											{:else}
												<span class="td-muted">Unknown</span>
											{/if}
										</td>
										<td class="td-muted">{log.volunteerName || '—'}</td>
										<td class="td-muted">{formatTime(startDate)}</td>
										<td class="td-muted">{formatTime(endDate)}</td>
										<td class="td-strong">{formatDuration(durationHours(log))}</td>
										<td class="td-delete">
											<button class="dt-delete-btn" on:click={() => handleDeleteTrip(log)} disabled={deletingTripId === log.id} title="Delete trip">✕</button>
										</td>
									</tr>
									{#if log.tripNotes?.trim()}
										<tr class="tr-notes" class:deleting={deletingTripId === log.id}>
											<td colspan="7" class="td-notes">{log.tripNotes.trim()}</td>
										</tr>
									{/if}
								{/each}
							</tbody>
							{#if !showAllLogs}
							<tfoot>
								<tr class="dt-table-foot">
									<td colspan="5" class="td-foot-label">Total</td>
									<td class="td-strong">{formatDuration(monthlyHourTotal)}</td>
									<td></td>
								</tr>
							</tfoot>
							{/if}
						</table>
					</div>
				{/if}
			</div>

<style>



	.dt-month-input {
		height: 2rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0 0.5rem;
		font-size: 0.82rem;
		color: #202124;
		background: #fff;
	}



	/* ── Panel (Log / Dogs / Stats / Import) ── */
	.dt-panel {
		border: 1px solid #dadce0;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 1px 3px rgba(60,64,67,.08);
		padding: 1rem;
		display: grid;
		gap: 0.8rem;
	}



	.dt-panel-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}



	.dt-panel-title {
		font-size: 1rem;
		font-weight: 600;
		color: #202124;
		margin: 0 0 0.15rem;
	}



	.dt-panel-sub {
		font-size: 0.72rem;
		color: #5f6368;
		margin: 0;
	}



	.dt-logform-panel { padding: 0; overflow: hidden; }



	.dt-logform-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.75rem 1rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}



	.dt-logform-toggle:hover { background: #f8f9fa; }



	.dt-logform-toggle-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: #016aa5;
	}



	.dt-logform-toggle-icon {
		font-size: 0.65rem;
		color: #9aa0a6;
	}



	.trip-form-wrap { padding: 0 20px 20px; }


	.trip-copy-block { padding: 0 1rem 1rem; }



	.dt-log-controls {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}



	.dt-toggle-btn {
		padding: 0.28rem 0.7rem;
		border-radius: 4px;
		font-size: 0.72rem;
		font-weight: 500;
		border: 1px solid #dadce0;
		background: #fff;
		color: #3c4043;
		cursor: pointer;
		white-space: nowrap;
	}



	.dt-toggle-btn:hover { background: #f8f9fa; }


	.dt-toggle-btn.active { background: #e8f0fe; border-color: #aecbfa; color: #1a73e8; }



	.td-delete { width: 2rem; text-align: center; }



	.dt-delete-btn {
		background: none;
		border: none;
		color: #bdc1c6;
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		line-height: 1;
	}



	.dt-delete-btn:hover { color: #cf4b4b; background: #fce8e6; }


	.dt-delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }



	tr.deleting { opacity: 0.4; pointer-events: none; }



	.tr-notes { background: #fafbfc; }


	.td-notes {
		padding: 0.3rem 0.75rem 0.55rem 0.75rem;
		font-size: 0.78rem;
		color: #5f6368;
		font-style: italic;
		border-top: none;
	}



	.dt-panel-empty {
		font-size: 0.82rem;
		color: #9aa0a6;
	}



	/* ── Table ── */
	.dt-table-wrap {
		overflow-x: auto;
		border: 1px solid #dadce0;
		border-radius: 6px;
	}



	.dt-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		min-width: 400px;
	}



	.dt-table th {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5f6368;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #dadce0;
		background: #f8f9fa;
		white-space: nowrap;
	}



	.dt-table td {
		padding: 0.55rem 0.75rem;
		border-top: 1px solid #f1f3f4;
		vertical-align: middle;
		font-size: 0.82rem;
	}



	.dt-table tbody tr:first-child td { border-top: none; }


	.dt-table tbody tr:hover td { background: #f8f9fa; }



	.td-name { font-weight: 600; color: #202124; }


	.td-muted { color: #5f6368; }


	.td-strong { font-weight: 600; color: #202124; }









	.dt-name-link { color: inherit; text-decoration: none; }


	.dt-name-link:hover { color: #1a73e8; text-decoration: underline; }



	.dt-table-foot td {
		border-top: 2px solid #dadce0;
		background: #f8f9fa;
	}



	.td-foot-label {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5f6368;
	}



	.dt-import-btn {
		display: inline-flex;
		align-items: center;
		height: 2rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0 0.9rem;
		background: #fff;
		font-size: 0.78rem;
		font-weight: 500;
		color: #3c4043;
		cursor: pointer;
	}



	.dt-import-btn:hover:not(:disabled) { background: #f8f9fa; }


	.dt-import-btn:disabled { opacity: 0.5; cursor: not-allowed; }



	.dt-import-btn-go {
		border-color: #a8d5a2;
		background: #e6f4ea;
		color: #1e7e34;
	}



	.dt-import-btn-go:hover:not(:disabled) { background: #ceead6; }



	/* ── Trip log form ── */
	.dt-logform-panel { display: grid; gap: 0.9rem; }



	.trip-copy-block { display: grid; gap: 0.5rem; }



	.trip-copy-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: #1e7e34;
	}



	.trip-copy-pre {
		margin: 0;
		padding: 0.75rem 1rem;
		background: #f8f9fa;
		border: 1px solid #dadce0;
		border-radius: 6px;
		font-size: 0.8rem;
		line-height: 1.6;
		white-space: pre-wrap;
		color: #202124;
	}



	.trip-copy-actions { display: flex; gap: 0.5rem; }



	@media (min-width: 768px) {
		.dt-panel { padding: 1.2rem; }
	}
</style>
