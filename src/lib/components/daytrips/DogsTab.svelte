<script lang="ts">
	import type { Dog } from '$lib/types';
	import type { DayTripEligibility } from '$lib/utils/dates';
	import { daysSince } from '$lib/utils/dates';
	import { getDayTripGapDays, DAYTRIP_OVERDUE_DAYS } from '$lib/utils/attention';

	export let dogStatsRows: Dog[] = [];
	export let monthStart: Date = new Date();
	export let tripCountByDog: Record<string, number> = {};
	export let tripHoursByDog: Record<string, number> = {};
	export let allTimeTripsCountByDog: Record<string, number> = {};
	export let getEligibility: (dog: Dog) => DayTripEligibility;

	const now = new Date();

	function statusPillClass(status: Dog['dayTripStatus']) {
		if (status === 'eligible') return 'pill-green';
		if (status === 'difficult') return 'pill-yellow';
		return 'pill-red';
	}

</script>

			<div class="dt-panel">
				<div class="dt-panel-head">
					<div>
						<p class="dt-panel-title">All Dogs</p>
						<p class="dt-panel-sub">Sorted by most overdue · {monthStart.toLocaleDateString('en-US', { month: 'short' })} stats shown for monthly columns</p>
					</div>
				</div>

				<div class="dt-table-wrap">
					<table class="dt-table">
						<thead>
							<tr>
								<th>Dog</th>
								<th class="th-center">All-Time</th>
								<th>Last Trip</th>
								<th class="th-center">{monthStart.toLocaleDateString('en-US', { month: 'short' })} Trips</th>
								<th class="th-center">{monthStart.toLocaleDateString('en-US', { month: 'short' })} Hrs</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{#each dogStatsRows as dog}
								{@const sinceReturnDays = getDayTripGapDays(dog, now)}
								{@const daysAtShelter = daysSince(dog.shelterSince ?? dog.intakeDate) ?? 0}
								{@const overdue = sinceReturnDays !== null ? sinceReturnDays >= DAYTRIP_OVERDUE_DAYS : daysAtShelter >= DAYTRIP_OVERDUE_DAYS}
								{@const eligibility = getEligibility(dog)}
								{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
								<tr class:tr-overdue={overdue && eligibility.eligible && !dog.isOutOnDayTrip}>
									<td class="td-name">
										<a href="/dogs/{dog.id}" class="dt-name-link">{dog.name}</a>
										{#if dog.isOutOnDayTrip}
											<span class="dt-out-badge">out now</span>
										{/if}
									</td>
									<td class="td-center">
										<span class="dt-alltime-num">{allTime}</span>
									</td>
									<td class="td-muted">
										{#if sinceReturnDays !== null}
											{sinceReturnDays}d ago{#if overdue && eligibility.eligible && !dog.isOutOnDayTrip}&thinsp;<span class="dt-overdue-flag">overdue</span>{/if}
										{:else}
											never
										{/if}
									</td>
									<td class="td-center td-muted">{tripCountByDog[dog.id] ?? 0}</td>
									<td class="td-center td-muted">{(tripHoursByDog[dog.id] ?? 0).toFixed(1)}</td>
									<td>
										{#if dog.isOutOnDayTrip}
											<span class="dt-on-trip-tag">on trip</span>
										{:else}
											<span class={`pill pill-sm ${statusPillClass(eligibility.status)}`}>{eligibility.status === 'eligible' ? 'Eligible' : eligibility.status === 'difficult' ? 'Difficult' : 'Ineligible'}</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

<style>



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



	.td-delete { width: 2rem; text-align: center; }


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


	.td-center { text-align: center; }


	.th-center { text-align: center; }


	.td-month-name { font-weight: 600; color: #202124; }



	.dt-name-link { color: inherit; text-decoration: none; }


	.dt-name-link:hover { color: #1a73e8; text-decoration: underline; }





	.td-foot-label {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5f6368;
	}



	.tr-overdue td { background: #fffbf0; }



	/* ── Badges / Tags ── */
	.dt-out-badge {
		display: inline-block;
		margin-left: 0.3rem;
		padding: 0.06rem 0.35rem;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 600;
		background: #e8f0fe;
		color: #1a73e8;
		vertical-align: middle;
	}



	.dt-overdue-flag {
		display: inline-block;
		margin-left: 0.2rem;
		padding: 0.04rem 0.28rem;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 600;
		background: #fce8e6;
		color: #c5221f;
		vertical-align: middle;
	}



	.dt-on-trip-tag {
		display: inline-flex;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		font-size: 0.66rem;
		font-weight: 600;
		background: #e8f0fe;
		color: #1a73e8;
	}



	.dt-alltime-num {
		font-size: 0.88rem;
		font-weight: 700;
		color: #202124;
	}



	.pill-sm { font-size: 0.62rem; padding: 0.1rem 0.34rem; }



	@media (min-width: 768px) {
		.dt-panel { padding: 1.2rem; }
	}
</style>
