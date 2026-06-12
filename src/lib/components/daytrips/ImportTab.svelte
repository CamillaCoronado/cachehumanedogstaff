<script lang="ts">
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { createDog, clearDayTripLogs, importHistoricalDayTrip, updateDog } from '$lib/data/dogs';
	import { matchDogByName } from '$lib/utils/dogs';
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
	}

	async function runImport() {
		if (!importDryRunDone) return;
		importing = true;
		importLog = [];

		let totalCreated = 0;
		let totalSkipped = 0;

		const previewMap = Object.fromEntries(importPreview.map((r) => [r.sheetName, r]));
		let totalNewDogs = 0;

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
					dayTripManagerOnly: false,
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

			// Wipe existing logs — spreadsheet is source of truth
			await clearDayTripLogs(dog.id);

			for (const dateStr of sortedDates) {
				const parts = dateStr.split('-').map(Number);
				const tripDate = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0);
				await importHistoricalDayTrip(dog.id, tripDate, $authProfile);
				totalCreated++;
			}

			// Update lastDayTripDate to the most recent imported date
			const lastDateStr = sortedDates[sortedDates.length - 1];
			const lp = lastDateStr.split('-').map(Number);
			const lastDate = new Date(lp[0], lp[1] - 1, lp[2], 0, 0, 0);
			await updateDog(dog.id, {
				lastDayTripDate: lastDate,
				isOutOnDayTrip: false,
				currentDayTripStartedAt: null
			});

			importLog = [...importLog, `✓ ${dog.name} — ${row.dates.length} trip${row.dates.length === 1 ? '' : 's'} imported (${sortedDates.join(', ')})`];
		}

		importLog = [...importLog, ``, `Done: ${totalCreated} trips created, ${totalNewDogs} new dogs added, ${totalSkipped} skipped.`];
		importing = false;
		importDone = true;
		await refresh();
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
														on:change={() => importPreview = [...importPreview]}>
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
