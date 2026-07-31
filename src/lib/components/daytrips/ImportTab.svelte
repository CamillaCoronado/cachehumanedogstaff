<script lang="ts">
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { createDog, importHistoricalDayTrip, listDayTripLogs } from '$lib/data/dogs';
	import { matchDogByName } from '$lib/utils/dogs';
	import { toDate } from '$lib/utils/dates';
	import type { Dog } from '$lib/types';

	export let dogs: Dog[] = [];
	export let refresh: () => Promise<void>;

	// ── Import state ──
	let sheetData: { name: string; dates: string[] }[] = [];
	let sheetLoading = false;
	let sheetError = '';

	async function loadFromSheet() {
		sheetLoading = true;
		sheetError = '';
		importDryRunDone = false;
		importDone = false;
		importPreview = [];
		importLog = [];
		try {
			const res = await fetch('/api/sheets/daytrips');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			sheetData = await res.json();
		} catch (e) {
			sheetError = e instanceof Error ? e.message : String(e);
		} finally {
			sheetLoading = false;
		}
	}

	interface ImportPreviewRow {
		sheetName: string;
		dogId: string | null;
		dogName: string | null;
		dates: string[];
		tripCount: number;
		matched: boolean;
		willCreate: boolean;
		asmStatus?: string;  // status found in ASM for unmatched dogs
		overrideId?: string;
		newCount?: number;       // sheet dates not yet logged for the resolved dog
		existingCount?: number;  // sheet dates already logged (will be kept, not overwritten)
	}

	// How many of a row's sheet dates are new vs already logged for the resolved dog.
	// A will-create / unmatched dog has no logs yet, so every date is new.
	async function computeRowCounts(row: ImportPreviewRow): Promise<{ newCount: number; existingCount: number }> {
		const effectiveDogId = row.overrideId || row.dogId;
		if (!effectiveDogId) return { newCount: row.tripCount, existingCount: 0 };

		const logs = await listDayTripLogs(effectiveDogId);
		const existingDays = new Set(
			logs.map((l) => toDate(l.startedAt)?.toDateString()).filter((d): d is string => Boolean(d))
		);
		let newCount = 0;
		for (const dateStr of row.dates) {
			const parts = dateStr.split('-').map(Number);
			const day = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0).toDateString();
			if (!existingDays.has(day)) newCount++;
		}
		return { newCount, existingCount: row.tripCount - newCount };
	}

	async function recomputeRow(i: number) {
		const { newCount, existingCount } = await computeRowCounts(importPreview[i]);
		importPreview[i] = { ...importPreview[i], newCount, existingCount };
		importPreview = [...importPreview];
	}

	let importPreview: ImportPreviewRow[] = [];
	let importDryRunDone = false;
	let importing = false;
	let importDone = false;
	let importLog: string[] = [];


	async function runDryRun() {
		importPreview = sheetData.map((row) => {
			const matched = matchDogByName(row.name, dogs);
			return {
				sheetName: row.name,
				dogId: matched?.id ?? null,
				dogName: matched?.name ?? null,
				dates: row.dates,
				tripCount: row.dates.length,
				matched: Boolean(matched),
				willCreate: !matched
			};
		});
		importDryRunDone = true;
		importDone = false;
		importLog = [];

		// Look up unmatched dogs in ASM to show their status
		const unmatched = importPreview.filter((r) => r.willCreate);
		await Promise.all(
			unmatched.map(async (row) => {
				try {
					const res = await fetch(`/api/asm/search?q=${encodeURIComponent(row.sheetName)}`);
					if (!res.ok) return;
					const results: { name: string; status: string }[] = await res.json();
					const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
					const hit = results.find((a) =>
						norm(a.name).includes(norm(row.sheetName)) ||
						norm(row.sheetName).includes(norm(a.name))
					);
					if (hit) {
						importPreview = importPreview.map((r) =>
							r.sheetName === row.sheetName ? { ...r, asmStatus: hit.status } : r
						);
					}
				} catch {
					// silently ignore ASM lookup failures
				}
			})
		);

		// Compute new-vs-already-logged counts for every row (in parallel).
		const counts = await Promise.all(importPreview.map((row) => computeRowCounts(row)));
		importPreview = importPreview.map((row, i) => ({ ...row, ...counts[i] }));
	}

	async function runImport() {
		console.log('[runImport] called, importDryRunDone=', importDryRunDone);
		if (!importDryRunDone) return;
		importing = true;
		importLog = [];

		let totalCreated = 0;
		let totalExisting = 0;
		let totalSkipped = 0;
		let totalNewDogs = 0;

		try {
			console.log('[runImport] starting try block, sheetData.length=', sheetData.length);
			const previewMap = Object.fromEntries(importPreview.map((r) => [r.sheetName, r]));

			for (const row of sheetData) {
				const preview = previewMap[row.name];
				const overrideDog = preview?.overrideId ? dogs.find((d) => d.id === preview.overrideId) : undefined;
				let dog = overrideDog ?? matchDogByName(row.name, dogs);

				if (!dog) {
					// Create a minimal record flagged as adopted (not in system)
					const newDog = await createDog({
						name: row.name,
						breed: '',
						sex: 'unknown',
						intakeDate: null,
						originalIntakeDate: null,
						reentryDates: [],
						dateOfBirth: null,
						weightLbs: null,
						foodType: '',
						foodAmount: '',
						dietaryNotes: '',
						origin: '',
						pottyTrained: 'unknown',
						goodWithDogs: 'unknown',
						goodWithCats: 'unknown',
						goodWithKids: 'unknown',
						idealHome: '',
						energyLevel: 'unknown',
						outdoorKennelAssignment: '',
						insideKennelAssignment: '',
						lastBathDate: null,
						lastBathBy: null,
						lastDayTripDate: null,
						isOutOnDayTrip: false,
						currentDayTripStartedAt: null,
						surgeryDate: null,
						surgeryRestDays: null,
						lastSurgeryDate: null,
						fortifloraDate: null,
						fortifloraDays: null,
						fortifloraTime: null,
						isMicrochipped: false,
						isFixed: false,
						fixedDate: null,
						isVaccinated: false,
						vaccineCount: 0,
						vaccinatedDate: null,
						dayTripStatus: 'eligible',
						dayTripNotes: null,
						handlingLevel: 'volunteer',
						inFoster: false,
						isolationStatus: 'none',
						isolationReason: null,
						isolationUntilDate: null,
						status: 'adopted',
						hiddenComments: 'Auto-created during day trip import — not found in system'
					});
					if (!newDog) {
						importLog = [...importLog, `⚠ Skipped "${row.name}" — could not create dog record`];
						totalSkipped++;
						continue;
					}
					dog = newDog;
					totalNewDogs++;
					importLog = [...importLog, `+ Created "${row.name}" as adopted (not in system)`];
				}

				const sortedDates = [...row.dates].sort();
				if (sortedDates.length === 0) {
					importLog = [...importLog, `⚠ Skipped "${row.name}" — no valid dates`];
					totalSkipped++;
					continue;
				}

				// Additive import: only add dates that don't already have a log.
				// Never wipe — preserve manually logged trips, notes, and ratings.
				// (importHistoricalDayTrip recomputes lastDayTripDate from all logs.)
				const existingLogs = await listDayTripLogs(dog.id);
				const existingDays = new Set(
					existingLogs
						.map((l) => toDate(l.startedAt)?.toDateString())
						.filter((d): d is string => Boolean(d))
				);

				const added: string[] = [];
				for (const dateStr of sortedDates) {
					const parts = dateStr.split('-').map(Number);
					const tripDate = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0);
					if (existingDays.has(tripDate.toDateString())) continue; // already logged — leave it
					await importHistoricalDayTrip(dog.id, tripDate, $authProfile);
					added.push(dateStr);
					totalCreated++;
				}

				const skippedExisting = sortedDates.length - added.length;
				totalExisting += skippedExisting;
				if (added.length === 0) {
					importLog = [...importLog, `• ${dog.name} — no new trips (${sortedDates.length} already logged)`];
				} else {
					importLog = [...importLog, `✓ ${dog.name} — ${added.length} new trip${added.length === 1 ? '' : 's'} added${skippedExisting ? `, ${skippedExisting} already logged` : ''} (${added.join(', ')})`];
				}
			}

			console.log('[runImport] loop done, totalCreated=', totalCreated, 'totalExisting=', totalExisting, 'totalSkipped=', totalSkipped, 'totalNewDogs=', totalNewDogs);
			importLog = [...importLog, ``, `Done: ${totalCreated} new trips added, ${totalExisting} already logged (kept), ${totalNewDogs} new dogs added, ${totalSkipped} skipped.`];
			importDone = true;
			console.log('[runImport] importDone set to true, calling toast + refresh');
			toast.success(`Import complete: ${totalCreated} new trips, ${totalNewDogs} new dogs.`);
			await refresh();
			console.log('[runImport] refresh done');
		} catch (e) {
			console.error('[runImport] caught error:', e);
			const msg = e instanceof Error ? e.message : String(e);
			importLog = [...importLog, ``, `✗ Import failed: ${msg}`];
			toast.error(`Import failed: ${msg}`);
		} finally {
			console.log('[runImport] finally block, setting importing=false');
			importing = false;
		}
	}

</script>

			<div class="dt-panel dt-import-panel">
				<div class="dt-panel-head">
					<div>
						<p class="dt-panel-title">Import Day Trip Data</p>
						<p class="dt-panel-sub typewriter">Load from the DT Numbers spreadsheet, then preview and import.</p>
					</div>
				</div>

				<div class="dt-import-actions">
					<button class="dt-import-btn" on:click={loadFromSheet} disabled={sheetLoading || importing}>
						{sheetLoading ? 'Loading…' : 'Load from Sheet'}
					</button>
					{#if sheetError}
						<span class="dt-import-error typewriter">{sheetError}</span>
					{/if}
					{#if sheetData.length > 0 && !sheetLoading}
						<span class="dt-import-loaded typewriter">{sheetData.length} dogs loaded</span>
						<button class="dt-import-btn" on:click={runDryRun} disabled={importing}>
							Dry Run
						</button>
					{/if}
					{#if importDryRunDone && !importDone}
						<button class="dt-import-btn dt-import-btn-go" on:click={runImport} disabled={importing}>
							{importing ? 'Importing…' : 'Import Now'}
						</button>
					{/if}
					{#if importDone}
						<span class="dt-import-done typewriter">Import complete!</span>
					{/if}
				</div>

				{#if importDryRunDone}
					<div class="dt-import-preview">
						<p class="dt-import-section-label typewriter">Preview</p>
						<div class="dt-table-wrap">
							<table class="dt-table dt-import-table">
								<thead>
									<tr>
										<th>Spreadsheet Name</th>
										<th>Matched Dog</th>
										<th class="th-center">Trips</th>
										<th class="th-center">New</th>
										<th>Dates</th>
									</tr>
								</thead>
								<tbody>
									{#each importPreview as row, i}
										{@const resolved = row.overrideId ? dogs.find(d => d.id === row.overrideId) : null}
										{@const isResolved = row.matched || Boolean(resolved) || row.willCreate}
										<tr class:dt-import-row-miss={!row.matched && !resolved && !row.willCreate} class:dt-import-row-new={row.willCreate && !resolved}>
											<td class="typewriter">{row.sheetName}</td>
											<td>
												{#if row.matched}
													<span class="dt-import-match">{row.dogName}</span>
												{:else if row.willCreate && !row.overrideId}
													<span class="dt-import-create typewriter">will create{row.asmStatus ? ` · ASM: ${row.asmStatus}` : ''}</span>
													<select class="dt-import-override"
														bind:value={importPreview[i].overrideId}
														on:change={() => recomputeRow(i)}>
														<option value="">— create new —</option>
														{#each dogs.slice().sort((a,b) => a.name.localeCompare(b.name)) as dog}
															<option value={dog.id}>{dog.name}{dog.status !== 'active' ? ` (${dog.status})` : ''}</option>
														{/each}
													</select>
												{:else if resolved}
													<span class="dt-import-match">{resolved.name}</span>
												{/if}
											</td>
											<td class="td-center typewriter">{isResolved ? row.tripCount : '—'}</td>
											<td class="td-center typewriter">
												{#if !isResolved}
													—
												{:else if row.newCount === undefined}
													…
												{:else if row.newCount === 0}
													<span class="dt-import-allold">none</span>
												{:else}
													<span class="dt-import-new">{row.newCount}</span>
												{/if}
											</td>
											<td class="dt-import-dates typewriter">
												{#if isResolved}
													{row.dates.map(d => d.replace(/^\d{4}-0?/, '')).join(', ')}
												{:else}
													—
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
								<tfoot>
									<tr class="dt-table-foot">
										<td class="td-foot-label typewriter">Total</td>
										<td class="td-foot-label typewriter">{importPreview.filter(r => r.matched).length} matched</td>
										<td class="td-center typewriter">{importPreview.filter(r => r.matched).reduce((s, r) => s + r.tripCount, 0)}</td>
										<td class="td-center typewriter"><span class="dt-import-new">{importPreview.reduce((s, r) => s + (r.newCount ?? 0), 0)} new</span></td>
										<td></td>
									</tr>
								</tfoot>
							</table>
						</div>
					</div>
				{/if}

				{#if importLog.length > 0}
					<div class="dt-import-log">
						<p class="dt-import-section-label typewriter">Import Log</p>
						<pre class="dt-import-log-pre typewriter">{importLog.join('\n')}</pre>
					</div>
				{/if}

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


	.td-center { text-align: center; }


	.th-center { text-align: center; }



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



	/* ── Import Tab ── */
	.dt-import-panel { display: grid; gap: 0.9rem; }



	.dt-import-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
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



	.dt-import-done  { font-size: 0.74rem; font-weight: 600; color: #1e7e34; }


	.dt-import-loaded { font-size: 0.74rem; font-weight: 500; color: #1a73e8; }


	.dt-import-error  { font-size: 0.74rem; font-weight: 600; color: #d93025; }



	.dt-import-preview, .dt-import-log { display: grid; gap: 0.38rem; }



	.dt-import-section-label {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5f6368;
		margin: 0;
	}



	.dt-import-table td, .dt-import-table th { white-space: nowrap; }


	.dt-import-row-miss td { opacity: 0.5; }


	.dt-import-row-new td { background: #fffbf0; }



	.dt-import-create {
		font-size: 0.72rem;
		font-weight: 600;
		color: #b06000;
		display: block;
		margin-bottom: 0.2rem;
	}



	.dt-import-match { color: #1e7e34; font-weight: 600; font-size: 0.82rem; }





	.dt-import-override {
		font-size: 0.76rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		background: #fff;
		color: #202124;
		max-width: 14rem;
	}



	.dt-import-dates { font-size: 0.72rem; color: #5f6368; }



	.dt-import-new {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.4rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: #e6f4ea;
		color: #1e7e34;
		font-size: 0.74rem;
		font-weight: 700;
	}



	.dt-import-allold { font-size: 0.74rem; color: #9aa0a6; }



	.dt-import-log-pre {
		margin: 0;
		padding: 0.7rem 0.9rem;
		background: #f8f9fa;
		border: 1px solid #dadce0;
		border-radius: 6px;
		font-size: 0.75rem;
		line-height: 1.7;
		color: #202124;
		white-space: pre-wrap;
	}



	@media (min-width: 768px) {
		.dt-panel { padding: 1.2rem; }
	}
</style>
