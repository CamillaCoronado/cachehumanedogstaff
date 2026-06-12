<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart, BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, BarController, LineController } from 'chart.js';
	import type { DayTripLog, Dog } from '$lib/types';
	import { toDate } from '$lib/utils/dates';
	import { durationHours, formatDuration } from '$lib/utils/daytrips';

	Chart.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, BarController, LineController);

	export let logs: DayTripLog[] = [];
	export let dogs: Dog[] = [];
	export let activeDogs: Dog[] = [];

	const now = new Date();

	// ── Sheet stats state (2024/2025/2026 Day Trip Data Chart tabs) ──
	interface MonthStat { name: string; hours: number; trips: number; }
	interface YearStat { year: number; months: MonthStat[]; totalHours: number; totalTrips: number; error: string | null; }

	let sheetStatsData: YearStat[] = [];
	let sheetStatsLoading = false;
	let sheetStatsError = '';
	let sheetStatsLoaded = false;
	let statsYearFilter = new Date().getFullYear();

	async function loadSheetStats() {
		if (sheetStatsLoaded || sheetStatsLoading) return;
		sheetStatsLoading = true;
		sheetStatsError = '';
		try {
			const res = await fetch('/api/sheets/stats');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			sheetStatsData = await res.json();
			sheetStatsLoaded = true;
		} catch (e) {
			sheetStatsError = e instanceof Error ? e.message : String(e);
		} finally {
			sheetStatsLoading = false;
		}
	}


	onMount(() => {
		void loadSheetStats();
	});

	$: selectedYearStat = sheetStatsData.find((y) => y.year === statsYearFilter) ?? null;


	let statsCanvas: HTMLCanvasElement | null = null;
	let statsChart: Chart | null = null;
	let cumulativeCanvas: HTMLCanvasElement | null = null;
	let cumulativeChart: Chart | null = null;
	let weekdayCanvas: HTMLCanvasElement | null = null;
	let weekdayChart: Chart | null = null;
	let topDogsCanvas: HTMLCanvasElement | null = null;
	let topDogsChart: Chart | null = null;

	function buildMonthlyChart() {
		if (!statsCanvas || !selectedYearStat) return;
		statsChart?.destroy();
		const labels = selectedYearStat.months.map((m) => m.name.slice(0, 3));
		const trips   = selectedYearStat.months.map((m) => m.trips);
		const hours   = selectedYearStat.months.map((m) => Math.round(m.hours));
		statsChart = new Chart(statsCanvas, {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Trips',
						data: trips,
						backgroundColor: 'rgba(1, 106, 165, 0.8)',
						borderRadius: 4
					},
					{
						label: 'Hours',
						data: hours,
						backgroundColor: 'rgba(58, 175, 42, 0.75)',
						borderRadius: 4
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { position: 'top', labels: { font: { size: 12 }, boxWidth: 14 } },
					tooltip: {
						callbacks: {
							title: (items) => selectedYearStat.months[items[0]?.dataIndex ?? 0]?.name ?? '',
							label: (ctx) => ctx.dataset.label === 'Hours'
								? ` ${ctx.parsed.y}h`
								: ` ${ctx.parsed.y} trips`
						}
					}
				},
				scales: {
					y: { beginAtZero: true, ticks: { precision: 0 } }
				}
			}
		});
	}

	function buildCumulativeChart() {
		if (!cumulativeCanvas || !selectedYearStat) return;
		cumulativeChart?.destroy();
		const labels = selectedYearStat.months.map((m) => m.name.slice(0, 3));
		let runningTrips = 0;
		let runningHours = 0;
		const cumulativeTrips = selectedYearStat.months.map((m) => runningTrips += m.trips);
		const cumulativeHours = selectedYearStat.months.map((m) => Math.round(runningHours += m.hours));
		cumulativeChart = new Chart(cumulativeCanvas, {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'Trips to date',
						data: cumulativeTrips,
						borderColor: 'rgba(1, 106, 165, 0.9)',
						backgroundColor: 'rgba(1, 106, 165, 0.14)',
						tension: 0.25,
						fill: true
					},
					{
						label: 'Hours to date',
						data: cumulativeHours,
						borderColor: 'rgba(58, 175, 42, 0.9)',
						backgroundColor: 'rgba(58, 175, 42, 0.12)',
						tension: 0.25,
						fill: false
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { position: 'top', labels: { font: { size: 12 }, boxWidth: 14 } },
					tooltip: { callbacks: {
						label: (ctx) => ctx.dataset.label === 'Hours'
							? ` ${ctx.parsed.y}h`
							: ` ${ctx.parsed.y}`
					}}
				},
				scales: {
					y: { beginAtZero: true, ticks: { precision: 0 } }
				}
			}
		});
	}

	function buildWeekdayChart() {
		if (!weekdayCanvas) return;
		weekdayChart?.destroy();
		const labels = weekdayStats.map((d) => d.name);
		const data = weekdayStats.map((d) => d.trips);
		weekdayChart = new Chart(weekdayCanvas, {
			type: 'bar',
			data: {
				labels,
				datasets: [{
					label: 'Trips',
					data,
					backgroundColor: 'rgba(249, 171, 0, 0.78)',
					borderRadius: 4
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: false },
					tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y} trips` } }
				},
				scales: {
					y: { beginAtZero: true, ticks: { precision: 0 } }
				}
			}
		});
	}

	function buildTopDogsChart() {
		if (!topDogsCanvas) return;
		topDogsChart?.destroy();
		const rows = topDogRows.slice(0, 8);
		topDogsChart = new Chart(topDogsCanvas, {
			type: 'bar',
			data: {
				labels: rows.map((r) => r.name),
				datasets: [{
					label: 'Trips',
					data: rows.map((r) => r.trips),
					backgroundColor: 'rgba(1, 106, 165, 0.8)',
					borderRadius: 4
				}]
			},
			options: {
				indexAxis: 'y',
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: false },
					tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.x} trips` } }
				},
				scales: {
					x: { beginAtZero: true, ticks: { precision: 0 } }
				}
			}
		});
	}

	$: if (statsCanvas && selectedYearStat) buildMonthlyChart();
	$: if (cumulativeCanvas && selectedYearStat) buildCumulativeChart();
	$: if (weekdayCanvas) {
		weekdayStats;
		buildWeekdayChart();
	}
	$: if (topDogsCanvas) {
		topDogRows;
		buildTopDogsChart();
	}


	onDestroy(() => {
		statsChart?.destroy();
		cumulativeChart?.destroy();
		weekdayChart?.destroy();
		topDogsChart?.destroy();
	});


	$: statsYearLogs = logs.filter((log) => {
		const d = toDate(log.startedAt);
		return d ? d.getFullYear() === statsYearFilter && Boolean(log.endedAt) : false;
	});

	$: mostTripsInOneDay = (() => {
		const byDate = new Map<string, number>();
		for (const log of statsYearLogs) {
			const d = toDate(log.startedAt);
			if (!d) continue;
			const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
			byDate.set(key, (byDate.get(key) ?? 0) + 1);
		}
		if (byDate.size === 0) return null;
		let maxCount = 0;
		let maxKey = '';
		for (const [key, count] of byDate) {
			if (count > maxCount) { maxCount = count; maxKey = key; }
		}
		const [y, m, day] = maxKey.split('-').map(Number);
		const date = new Date(y, m, day);
		return { count: maxCount, label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
	})();

	$: thisVsLastMonth = (() => {
		const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
		const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const thisCount = logs.filter(l => { const d = toDate(l.startedAt); return d && l.endedAt && d >= thisMonthStart; }).length;
		const lastCount = logs.filter(l => { const d = toDate(l.startedAt); return d && l.endedAt && d >= lastMonthStart && d < thisMonthStart; }).length;
		return { thisCount, lastCount, diff: thisCount - lastCount };
	})();

	$: longestTrip = (() => {
		let best: DayTripLog | null = null;
		let bestHours = 0;
		for (const log of statsYearLogs) {
			const h = durationHours(log);
			if (h > bestHours) { bestHours = h; best = log; }
		}
		if (!best) return null;
		const dog = dogs.find(d => d.id === best!.dogId);
		return { hours: bestHours, dogName: dog?.name ?? '?' };
	})();

	$: mostFrequentActiveDog = (() => {
		const activeDogIds = new Set(activeDogs.map(d => d.id));
		const counts = new Map<string, number>();
		for (const log of statsYearLogs) {
			if (!activeDogIds.has(log.dogId)) continue;
			counts.set(log.dogId, (counts.get(log.dogId) ?? 0) + 1);
		}
		if (counts.size === 0) return null;
		let maxId = '';
		let maxCount = 0;
		for (const [id, count] of counts) {
			if (count > maxCount) { maxCount = count; maxId = id; }
		}
		const dog = dogs.find(d => d.id === maxId);
		return { name: dog?.name ?? '?', trips: maxCount };
	})();

	$: busiestMonth = selectedYearStat?.months.reduce<MonthStat | null>((best, month) => {
		if (!best || month.trips > best.trips) return month;
		return best;
	}, null) ?? null;

	$: weekdayStats = (() => {
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => ({ name, trips: 0, hours: 0 }));
		for (const log of statsYearLogs) {
			const d = toDate(log.startedAt);
			if (!d) continue;
			days[d.getDay()].trips += 1;
			days[d.getDay()].hours += durationHours(log);
		}
		return days;
	})();

	$: busiestWeekday = weekdayStats.reduce<{ name: string; trips: number; hours: number } | null>((best, day) => {
		if (!best || day.trips > best.trips) return day;
		return best;
	}, null);

	$: topDogRows = (() => {
		const rows = new Map<string, { name: string; trips: number; hours: number }>();
		for (const log of statsYearLogs) {
			const dog = dogs.find((d) => d.id === log.dogId);
			const name = dog?.name ?? 'Unknown';
			const existing = rows.get(log.dogId) ?? { name, trips: 0, hours: 0 };
			existing.trips += 1;
			existing.hours += durationHours(log);
			rows.set(log.dogId, existing);
		}
		return [...rows.values()]
			.sort((a, b) => b.trips - a.trips || b.hours - a.hours || a.name.localeCompare(b.name))
			.slice(0, 8);
	})();

	$: topVolunteerRows = (() => {
		const rows = new Map<string, { name: string; trips: number; hours: number }>();
		for (const log of statsYearLogs) {
			const name = log.volunteerName?.trim() || 'Unassigned';
			const existing = rows.get(name) ?? { name, trips: 0, hours: 0 };
			existing.trips += 1;
			existing.hours += durationHours(log);
			rows.set(name, existing);
		}
		return [...rows.values()]
			.sort((a, b) => b.trips - a.trips || b.hours - a.hours || a.name.localeCompare(b.name))
			.slice(0, 8);
	})();

</script>

		{#if sheetStatsLoading}
				<p class="dt-loading">Loading stats from spreadsheet…</p>
			{:else if sheetStatsError}
				<p class="dt-import-error">{sheetStatsError}</p>
			{:else if selectedYearStat}
				<!-- Year selector + summary -->
				<div class="dt-stats-header">
					<div class="dt-stats-year-pills">
						{#each sheetStatsData as y}
							<button
								class="dt-stats-year-btn"
								class:dt-stats-year-active={statsYearFilter === y.year}
								on:click={() => statsYearFilter = y.year}
							>{y.year}</button>
						{/each}
					</div>
					<div class="dt-stats-totals">
						<span class="dt-stats-total-num">{selectedYearStat.totalTrips}</span>
						<span class="dt-stats-total-label">trips</span>
						<span class="dt-stats-total-sep">·</span>
						<span class="dt-stats-total-num">{Math.round(selectedYearStat.totalHours)}h</span>
						<span class="dt-stats-total-label">total</span>
						{#if selectedYearStat.totalTrips > 0}
							<span class="dt-stats-total-sep">·</span>
							<span class="dt-stats-total-num">{formatDuration(selectedYearStat.totalHours / selectedYearStat.totalTrips)}</span>
							<span class="dt-stats-total-label">avg per trip</span>
						{/if}
					</div>
				</div>

				<div class="dt-stats-kpi-grid">
					<div class="dt-stats-kpi">
						<span class="dt-stats-kpi-label">Busiest month</span>
						<span class="dt-stats-kpi-value">{busiestMonth?.name ?? '—'}</span>
						<span class="dt-stats-kpi-sub">{busiestMonth ? `${busiestMonth.trips} trips · ${Math.round(busiestMonth.hours)}h` : 'No trips'}</span>
					</div>
					<div class="dt-stats-kpi">
						<span class="dt-stats-kpi-label">Busiest weekday</span>
						<span class="dt-stats-kpi-value">{busiestWeekday?.name ?? '—'}</span>
						<span class="dt-stats-kpi-sub">{busiestWeekday ? `${busiestWeekday.trips} logged trips` : 'No logged trips'}</span>
					</div>
					<div class="dt-stats-kpi">
						<span class="dt-stats-kpi-label">Most trips in a day</span>
						<span class="dt-stats-kpi-value">{mostTripsInOneDay?.count ?? '—'}</span>
						<span class="dt-stats-kpi-sub">{mostTripsInOneDay ? mostTripsInOneDay.label : 'No trips logged'}</span>
					</div>
					<div class="dt-stats-kpi">
						<span class="dt-stats-kpi-label">This month vs last</span>
						<span class="dt-stats-kpi-value">{thisVsLastMonth.thisCount} <span class="dt-stats-kpi-trend" class:kpi-up={thisVsLastMonth.diff > 0} class:kpi-down={thisVsLastMonth.diff < 0}>{thisVsLastMonth.diff > 0 ? `+${thisVsLastMonth.diff}` : thisVsLastMonth.diff < 0 ? `${thisVsLastMonth.diff}` : '='}</span></span>
						<span class="dt-stats-kpi-sub">{thisVsLastMonth.lastCount} trips last month</span>
					</div>
					<div class="dt-stats-kpi">
						<span class="dt-stats-kpi-label">Longest trip {statsYearFilter}</span>
						<span class="dt-stats-kpi-value">{longestTrip ? formatDuration(longestTrip.hours) : '—'}</span>
						<span class="dt-stats-kpi-sub">{longestTrip ? longestTrip.dogName : 'No trips logged'}</span>
					</div>
					<div class="dt-stats-kpi">
						<span class="dt-stats-kpi-label">Most frequent dog</span>
						<span class="dt-stats-kpi-value">{mostFrequentActiveDog?.name ?? '—'}</span>
						<span class="dt-stats-kpi-sub">{mostFrequentActiveDog ? `${mostFrequentActiveDog.trips} trips this year` : 'No active dog logs'}</span>
					</div>
				</div>

				<div class="dt-stats-grid">
					<div class="dt-panel dt-stats-chart-panel">
						<div class="dt-stats-panel-head">
							<p class="dt-panel-title">Monthly volume</p>
							<p class="dt-panel-sub">Trips and hours from the spreadsheet</p>
						</div>
						<div class="dt-stats-canvas-wrap">
							<canvas bind:this={statsCanvas}></canvas>
						</div>
					</div>

					<div class="dt-panel dt-stats-chart-panel">
						<div class="dt-stats-panel-head">
							<p class="dt-panel-title">Year progress</p>
							<p class="dt-panel-sub">Cumulative trips and hours</p>
						</div>
						<div class="dt-stats-canvas-wrap">
							<canvas bind:this={cumulativeCanvas}></canvas>
						</div>
					</div>
				</div>

				<div class="dt-stats-grid">
					<div class="dt-panel dt-stats-chart-panel">
						<div class="dt-stats-panel-head">
							<p class="dt-panel-title">Trips by weekday</p>
							<p class="dt-panel-sub">Based on app trip logs for {statsYearFilter}</p>
						</div>
						<div class="dt-stats-canvas-wrap dt-stats-canvas-sm">
							<canvas bind:this={weekdayCanvas}></canvas>
						</div>
					</div>

					<div class="dt-panel dt-stats-chart-panel">
						<div class="dt-stats-panel-head">
							<p class="dt-panel-title">Most frequent dogs</p>
							<p class="dt-panel-sub">Based on app trip logs for {statsYearFilter}</p>
						</div>
						{#if topDogRows.length > 0}
							<div class="dt-stats-canvas-wrap dt-stats-canvas-sm">
								<canvas bind:this={topDogsCanvas}></canvas>
							</div>
						{:else}
							<p class="dt-panel-empty">No dog-level logs for {statsYearFilter}.</p>
						{/if}
					</div>
				</div>

				<div class="dt-stats-grid">
					<div class="dt-panel dt-stats-list-panel">
						<div class="dt-stats-panel-head">
							<p class="dt-panel-title">Top dogs</p>
							<p class="dt-panel-sub">Repeat trip volume for the selected year</p>
						</div>
						{#if topDogRows.length > 0}
							<div class="dt-stats-rank-list">
								{#each topDogRows as row, i}
									<div class="dt-stats-rank-row">
										<span class="dt-stats-rank-num">{i + 1}</span>
										<span class="dt-stats-rank-name">{row.name}</span>
										<span class="dt-stats-rank-value">{row.trips} trips · {formatDuration(row.hours)}</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="dt-panel-empty">No dog-level logs for {statsYearFilter}.</p>
						{/if}
					</div>

					<div class="dt-panel dt-stats-list-panel">
						<div class="dt-stats-panel-head">
							<p class="dt-panel-title">Volunteer activity</p>
							<p class="dt-panel-sub">Who logged completed trips this year</p>
						</div>
						{#if topVolunteerRows.length > 0}
							<div class="dt-stats-rank-list">
								{#each topVolunteerRows as row, i}
									<div class="dt-stats-rank-row">
										<span class="dt-stats-rank-num">{i + 1}</span>
										<span class="dt-stats-rank-name">{row.name}</span>
										<span class="dt-stats-rank-value">{row.trips} trips · {formatDuration(row.hours)}</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="dt-panel-empty">No volunteer logs for {statsYearFilter}.</p>
						{/if}
					</div>
				</div>

				<div class="dt-panel dt-stats-list-panel">
					<div class="dt-stats-panel-head">
						<p class="dt-panel-title">Monthly detail</p>
						<p class="dt-panel-sub">Exact spreadsheet values by month</p>
					</div>
					<div class="dt-table-wrap">
						<table class="dt-table">
							<thead>
								<tr>
									<th>Month</th>
									<th class="th-center">Trips</th>
									<th class="th-center">Hours</th>
									<th class="th-center">Avg</th>
								</tr>
							</thead>
							<tbody>
								{#each selectedYearStat.months as month}
									<tr>
										<td class="td-name">{month.name}</td>
										<td class="td-center td-strong">{month.trips}</td>
										<td class="td-center td-muted">{Math.round(month.hours)}</td>
										<td class="td-center td-muted">{month.trips > 0 ? formatDuration(month.hours / month.trips) : '—'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{:else if sheetStatsLoaded}
				<p class="dt-panel-empty">No stats found for {statsYearFilter}.</p>
			{/if}

<style>


	/* ── Loading ── */
	.dt-loading {
		padding: 1.5rem;
		color: #5f6368;
		font-size: 0.88rem;
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






	.dt-import-error  { font-size: 0.74rem; font-weight: 600; color: #d93025; }


	/* ── Stats ── */
	.dt-stats-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
	}


	.dt-stats-totals {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: #5f6368;
	}


	.dt-stats-total-num {
		font-size: 1rem;
		font-weight: 700;
		color: #202124;
	}


	.dt-stats-total-label { font-size: 0.72rem; color: #5f6368; }

	.dt-stats-total-sep { color: #bdc1c6; }


	.dt-stats-kpi-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.7rem;
	}


	.dt-stats-kpi {
		display: grid;
		gap: 0.2rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid #dadce0;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 1px 3px rgba(60,64,67,.08);
		min-width: 0;
	}


	.dt-stats-kpi-label {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #5f6368;
	}


	.dt-stats-kpi-value {
		font-size: 1.2rem;
		font-weight: 800;
		color: #202124;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	.dt-stats-kpi-sub {
		font-size: 0.72rem;
		color: #5f6368;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	.dt-stats-kpi-trend {
		font-size: 0.85rem;
		font-weight: 700;
	}

	.kpi-up { color: #1e7e34; }

	.kpi-down { color: #cf4b4b; }


	.dt-stats-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
	}


	.dt-stats-chart-panel,
	.dt-stats-list-panel {
		padding: 1rem;
		align-content: start;
	}


	.dt-stats-panel-head {
		display: grid;
		gap: 0.15rem;
	}


	.dt-stats-canvas-wrap {
		position: relative;
		height: 280px;
	}


	.dt-stats-canvas-sm { height: 240px; }


	.dt-stats-rank-list {
		display: grid;
		gap: 0.35rem;
	}


	.dt-stats-rank-row {
		display: grid;
		grid-template-columns: 1.8rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.55rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid #f1f3f4;
	}


	.dt-stats-rank-row:last-child { border-bottom: none; }


	.dt-stats-rank-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 999px;
		background: #e8f0fe;
		color: #1a73e8;
		font-size: 0.68rem;
		font-weight: 800;
	}


	.dt-stats-rank-name {
		font-size: 0.82rem;
		font-weight: 600;
		color: #202124;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	.dt-stats-rank-value {
		font-size: 0.74rem;
		font-weight: 600;
		color: #5f6368;
		white-space: nowrap;
	}


	.dt-stats-year-pills {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}


	.dt-stats-year-btn {
		padding: 0.25rem 0.9rem;
		border-radius: 999px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.78rem;
		font-weight: 600;
		color: #5f6368;
		cursor: pointer;
	}


	.dt-stats-year-btn:hover { background: #f1f3f4; color: #202124; }


	.dt-stats-year-active {
		background: #016aa5;
		border-color: #016aa5;
		color: #fff;
	}


	.dt-stats-year-active:hover { background: #015a8e; }


	/* ── Responsive ── */
	@media (max-width: 640px) {
		.dt-stats-header {
			align-items: stretch;
			flex-direction: column;
		}

		.dt-stats-totals { flex-wrap: wrap; }
		.dt-stats-kpi-grid,
		.dt-stats-grid {
			grid-template-columns: 1fr;
		}

		.dt-stats-canvas-wrap { height: 240px; }

		.dt-stats-rank-row {
			grid-template-columns: 1.8rem minmax(0, 1fr);
		}

		.dt-stats-rank-value {
			grid-column: 2;
		}
	}


	@media (min-width: 768px) {
		.dt-panel { padding: 1.2rem; }
	}
</style>
