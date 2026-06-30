<script lang="ts">
	import type { Dog } from '$lib/types';
	import type { DayTripEligibility } from '$lib/utils/dates';
	import { daysSince, dogStripeColor, formatDateTime } from '$lib/utils/dates';
	import { getDayTripGapDays, DAYTRIP_OVERDUE_DAYS } from '$lib/utils/attention';

	export let dogsOut: Dog[] = [];
	export let dogsEligible: Dog[] = [];
	export let dogsIneligible: Dog[] = [];
	export let allTimeTripsCountByDog: Record<string, number> = {};
	export let sheetColors: Record<string, 'green' | 'yellow' | 'red'> = {};
	export let getEligibility: (dog: Dog) => DayTripEligibility;
	export let toggleOut: (dog: Dog) => Promise<void>;
	export let toggleAwaitingEval: (dog: Dog) => Promise<void>;

	const now = new Date();

	let boardColorFilter: 'green' | 'yellow' | null = null;
	let openEval: Record<string, boolean> = {};
	const toggleEvalMenu = (id: string) => (openEval = { ...openEval, [id]: !openEval[id] });
</script>

			<div class="cal-filters">
				<button class="cal-filter-pill" class:cal-filter-active={boardColorFilter === null} on:click={() => boardColorFilter = null}>All</button>
				<button class="cal-filter-pill cal-filter-green" class:cal-filter-active={boardColorFilter === 'green'} on:click={() => boardColorFilter = boardColorFilter === 'green' ? null : 'green'}>Green</button>
				<button class="cal-filter-pill cal-filter-yellow" class:cal-filter-active={boardColorFilter === 'yellow'} on:click={() => boardColorFilter = boardColorFilter === 'yellow' ? null : 'yellow'}>Yellow</button>
			</div>
			<div class="cal-board">

				<!-- Out Now -->
				<div class="cal-col">
					<div class="cal-col-head cal-col-head-blue">
						<span class="cal-col-title">Out Now</span>
						<span class="cal-col-badge cal-badge-blue">{dogsOut.length}</span>
					</div>
					{#if dogsOut.length === 0}
						<p class="cal-empty">None out right now</p>
					{:else}
						{#each dogsOut as dog}
							{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
							<div class="cal-event cal-event-blue">
								<p class="cal-event-name"><a class="dog-name-link" href="/dogs/{dog.id}">{dog.name}</a></p>
								<p class="cal-event-meta">Kennel {dog.outdoorKennelAssignment || '—'}</p>
								<p class="cal-event-meta">Out since {formatDateTime(dog.currentDayTripStartedAt)}</p>
								<p class="cal-event-count">{allTime} total trip{allTime !== 1 ? 's' : ''}</p>
								<button class="cal-btn cal-btn-blue" on:click={() => toggleOut(dog)}>Mark Returned</button>
							</div>
						{/each}
					{/if}
				</div>

				<!-- Eligible -->
				<div class="cal-col">
					<div class="cal-col-head cal-col-head-green">
						<span class="cal-col-title">Eligible</span>
						<span class="cal-col-badge cal-badge-green">{dogsEligible.length}</span>
					</div>
					{#if dogsEligible.length === 0}
						<p class="cal-empty">None ready</p>
					{:else}
						{#each dogsEligible.filter(d => !boardColorFilter || dogStripeColor(d, sheetColors) === boardColorFilter) as dog}
							{@const eligibility = getEligibility(dog)}
							{@const sinceReturnDays = getDayTripGapDays(dog, now)}
							{@const daysAtShelter = daysSince(dog.shelterSince ?? dog.intakeDate) ?? 0}
							{@const overdue = sinceReturnDays !== null ? sinceReturnDays >= DAYTRIP_OVERDUE_DAYS : daysAtShelter >= DAYTRIP_OVERDUE_DAYS}
							{@const stripe = dogStripeColor(dog, sheetColors)}
							{@const allTime = allTimeTripsCountByDog[dog.id] ?? 0}
							<div class="cal-event" class:cal-event-red={stripe === 'red'} class:cal-event-orange={stripe === 'yellow'} class:cal-event-green={stripe === 'green'}>
								<p class="cal-event-name"><a class="dog-name-link" href="/dogs/{dog.id}">{dog.name}</a></p>
								<p class="cal-event-meta">Kennel {dog.outdoorKennelAssignment || '—'} · {sinceReturnDays !== null ? `${sinceReturnDays}d ago` : 'No trips yet'}</p>
								<div class="cal-event-tags">
									{#if eligibility.status === 'difficult'}<span class="cal-tag cal-tag-yellow">Adults only</span>{/if}
									{#if overdue}<span class="cal-tag cal-tag-red">Overdue</span>{/if}
								</div>
								<p class="cal-event-count">{allTime} trip{allTime !== 1 ? 's' : ''} total</p>
								{#if eligibility.reasons.length > 0}
									<p class="cal-event-warning">{eligibility.reasons[0]}</p>
								{/if}
								<div class="cal-event-actions">
									<button class="cal-btn cal-btn-green" on:click={() => toggleOut(dog)}>Send Out</button>
									<button class="cal-caret" class:cal-caret-open={openEval[dog.id]} on:click={() => toggleEvalMenu(dog.id)} aria-label="More options" aria-expanded={Boolean(openEval[dog.id])}>⌄</button>
								</div>
								{#if openEval[dog.id]}
									<button class="cal-eval" class:cal-eval-on={dog.awaitingEvaluation} on:click={() => toggleAwaitingEval(dog)}>
										{dog.awaitingEvaluation ? 'Clear awaiting eval' : 'Mark awaiting eval'}
									</button>
								{/if}
							</div>
						{/each}
					{/if}
				</div>

				<!-- Not Eligible -->
				<div class="cal-col">
					<div class="cal-col-head">
						<span class="cal-col-title">Not Eligible</span>
						<span class="cal-col-badge">{dogsIneligible.length}</span>
					</div>
					{#if dogsIneligible.length === 0}
						<p class="cal-empty">None</p>
					{:else}
						{#each dogsIneligible.filter(d => !boardColorFilter || dogStripeColor(d, sheetColors) === boardColorFilter) as dog}
							{@const eligibility = getEligibility(dog)}
							{@const stripe = dogStripeColor(dog, sheetColors)}
							<div class="cal-event" class:cal-event-red={stripe === 'red'} class:cal-event-orange={stripe === 'yellow'} class:cal-event-green={stripe === 'green'}>
								<p class="cal-event-name"><a class="dog-name-link" href="/dogs/{dog.id}">{dog.name}</a></p>
								<div class="cal-event-actions">
									<p class="cal-event-meta cal-event-meta-grow">{eligibility.reasons[0] ?? `Kennel ${dog.outdoorKennelAssignment || '—'}`}</p>
									<button class="cal-caret" class:cal-caret-open={openEval[dog.id]} on:click={() => toggleEvalMenu(dog.id)} aria-label="More options" aria-expanded={Boolean(openEval[dog.id])}>⌄</button>
								</div>
								{#if openEval[dog.id]}
									<button class="cal-eval" class:cal-eval-on={dog.awaitingEvaluation} on:click={() => toggleAwaitingEval(dog)}>
										{dog.awaitingEvaluation ? 'Clear awaiting eval' : 'Mark awaiting eval'}
									</button>
								{/if}
							</div>
						{/each}
					{/if}
				</div>

			</div>

<style>



	/* ── Calendar Board ── */
	.cal-board {
		display: grid;
		gap: 0.75rem;
	}




	.cal-col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}




	.cal-col-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0.6rem;
		border-radius: 6px 6px 0 0;
		border-bottom: 2px solid #dadce0;
	}




	.cal-col-head-blue { border-bottom-color: #016aa5; }



	.cal-col-head-green { border-bottom-color: #3aaf2a; }




	.cal-col-title {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #3c4043;
	}




	.cal-col-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.35rem;
		height: 1.35rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		background: #f1f3f4;
		color: #5f6368;
	}




	.cal-badge-blue { background: #e8f0fe; color: #1a73e8; }



	.cal-badge-green { background: #e6f4ea; color: #1e7e34; }




	.cal-empty {
		font-size: 0.78rem;
		color: #9aa0a6;
		padding: 0.5rem 0.6rem;
	}




	/* ── Board filters ── */
	.cal-filters {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1rem 0;
	}



	.cal-filter-pill {
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.78rem;
		font-weight: 500;
		color: #5f6368;
		cursor: pointer;
	}



	.cal-filter-pill.cal-filter-active { border-color: #5f6368; background: #f1f3f4; color: #202124; }



	.cal-filter-green.cal-filter-active { border-color: #3aaf2a; background: #e8f5e9; color: #2a6248; }



	.cal-filter-yellow.cal-filter-active { border-color: #f29900; background: #fff8e1; color: #7a5100; }




	/* ── Event chips ── */
	.cal-event {
		background: #fff;
		border: 1px solid #dadce0;
		border-left-width: 4px;
		border-radius: 6px;
		padding: 0.6rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		box-shadow: 0 1px 2px rgba(60,64,67,.06);
	}




	.cal-event-blue  { border-left-color: #016aa5; }



	.cal-event-green { border-left-color: #3aaf2a; }



	.cal-event-orange { border-left-color: #f29900; }



	.cal-event-red   { border-left-color: #cf4b4b; }




	.cal-event-name {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 600;
		color: #202124;
		line-height: 1.2;
	}




	.cal-event-meta {
		margin: 0;
		font-size: 0.72rem;
		color: #5f6368;
	}




	.cal-event-count {
		margin: 0;
		font-size: 0.68rem;
		color: #9aa0a6;
	}




	.cal-event-warning {
		margin: 0;
		font-size: 0.72rem;
		color: #d93025;
	}




	.cal-event-tags {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}




	.cal-tag {
		display: inline-flex;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.03em;
	}




	.cal-tag-yellow { background: #fef7e0; color: #b06000; }



	.cal-tag-red    { background: #fce8e6; color: #c5221f; }




	.cal-btn {
		margin-top: 0.3rem;
		align-self: flex-start;
		padding: 0.28rem 0.7rem;
		border-radius: 4px;
		font-size: 0.72rem;
		font-weight: 500;
		border: 1px solid #dadce0;
		background: #fff;
		cursor: pointer;
		color: #3c4043;
	}




	.cal-btn:hover { background: #f8f9fa; }




	.cal-btn-blue  { border-color: #aecbfa; color: #1a73e8; background: #e8f0fe; }



	.cal-btn-blue:hover  { background: #d2e3fc; }



	.cal-event-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.3rem;
	}



	.cal-event-meta-grow { flex: 1; margin: 0; }



	.cal-caret {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border-radius: 4px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.8rem;
		line-height: 1;
		color: #5f6368;
		cursor: pointer;
		transition: transform 0.12s;
	}



	.cal-caret:hover { background: #f8f9fa; }



	.cal-caret-open { transform: rotate(180deg); }



	.cal-eval {
		align-self: flex-start;
		margin-top: 0.4rem;
		padding: 0.28rem 0.6rem;
		border-radius: 4px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.7rem;
		font-weight: 600;
		color: #5f6368;
		cursor: pointer;
		white-space: nowrap;
	}



	.cal-eval:hover { background: #f8f9fa; }



	.cal-eval-on {
		border-color: #d6b3ce;
		background: #f6e9f3;
		color: #933980;
	}



	.cal-btn-green { border-color: #a8d5a2; color: #1e7e34; background: #e6f4ea; }



	.cal-btn-green:hover { background: #ceead6; }




	@media (min-width: 640px) {
		.cal-board {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
