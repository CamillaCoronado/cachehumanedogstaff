<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { logManualTrip } from '$lib/data/dogs';
	import { authProfile } from '$lib/stores/auth';
	import type { BehaviorRating, Dog, UserProfile } from '$lib/types';

	export let dogs: Dog[] = [];
	export let source: 'qr' | 'staff' = 'qr';
	export let profile: UserProfile | null = null;
	export let volunteerNames: string[] = [];

	let nameSearch = '';
	let showSuggestions = false;
	$: suggestions = volunteerNames.length > 0 && nameSearch.trim().length > 0
		? volunteerNames.filter(n => n.toLowerCase().includes(nameSearch.toLowerCase()))
		: volunteerNames.length > 0 ? volunteerNames : [];

	function pickSuggestion(name: string) {
		volunteerName = name;
		nameSearch = name;
		showSuggestions = false;
	}

	function onNameInput() {
		volunteerName = '';
		showSuggestions = true;
	}

	function onNameBlur() {
		setTimeout(() => { showSuggestions = false; }, 150);
	}

	const dispatch = createEventDispatcher<{ submitted: { copyText: string } }>();

	const now = new Date();
	const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

	let dogId = '';
	let volunteerName = '';
	let date = todayStr;
	let timeOut = '';
	let timeBack = '';
	let behaviorRatings: Record<string, BehaviorRating | ''> = {
		kids_rating: '', dogs_rating: '', cats_rating: '', strangers_rating: '',
		leash_rating: '', car_rating: '', toys_rating: ''
	};
	let notes = '';
	let submitting = false;
	let error = '';

	const ratings: { value: BehaviorRating; label: string }[] = [
		{ value: 'friendly', label: 'Friendly' },
		{ value: 'neutral', label: 'Neutral' },
		{ value: 'nervous', label: 'Nervous' },
		{ value: 'excited', label: 'Excited' },
		{ value: 'reactive', label: 'Reactive' },
		{ value: 'na', label: 'N/A' }
	];

	const behaviorRows: { label: string; key: string }[] = [
		{ label: 'Children', key: 'kids_rating' },
		{ label: 'Dogs', key: 'dogs_rating' },
		{ label: 'Cats', key: 'cats_rating' },
		{ label: 'Strangers', key: 'strangers_rating' },
		{ label: 'Walking on Leash', key: 'leash_rating' },
		{ label: 'Car Rides', key: 'car_rating' },
		{ label: 'Playing with Toys', key: 'toys_rating' },
	];

	function setRating(key: string, value: BehaviorRating) {
		behaviorRatings = { ...behaviorRatings, [key]: behaviorRatings[key] === value ? '' : value };
	}

	function buildDateTime(dateStr: string, timeStr: string): Date | null {
		if (!dateStr) return null;
		const [y, m, d] = dateStr.split('-').map(Number);
		if (!timeStr) return new Date(y, m - 1, d, 0, 0, 0);
		const [h, min] = timeStr.split(':').map(Number);
		return new Date(y, m - 1, d, h, min, 0);
	}

	function buildCopy(): string {
		const dog = dogs.find((d) => d.id === dogId);
		if (!dog) return '';
		const dateObj = buildDateTime(date, '');
		const dateLabel = dateObj
			? dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
			: date;
		const r = (v: BehaviorRating | '') => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';
		const b = behaviorRatings;
		const lines = [
			`Day Trip — ${dog.name} — ${dateLabel}`,
			`Volunteer: ${volunteerName || '—'}`,
			`Time out: ${timeOut || '—'} | Time back: ${timeBack || '—'}`,
			``,
			`Behavior:`,
			`• Children: ${r(b.kids_rating)}`,
			`• Dogs: ${r(b.dogs_rating)}`,
			`• Cats: ${r(b.cats_rating)}`,
			`• Strangers: ${r(b.strangers_rating)}`,
			`• Walking on Leash: ${r(b.leash_rating)}`,
			`• Car Rides: ${r(b.car_rating)}`,
			`• Playing with Toys: ${r(b.toys_rating)}`,
		];
		if (notes.trim()) lines.push(``, `Notes: ${notes.trim()}`);
		return lines.join('\n');
	}

	export async function submit() {
		if (!dogId) { error = 'Please select a dog.'; return; }
		if (!volunteerName.trim()) { error = 'Please enter your name.'; return; }
		error = '';
		submitting = true;
		try {
			const startedAt = buildDateTime(date, timeOut) ?? new Date();
			// Always a completed log — out-status is tracked separately by the visual toggle,
			// so a trip log is never left "open". No time back → end equals start.
			const endedAt = (timeBack ? buildDateTime(date, timeBack) : null) ?? startedAt;
			await logManualTrip(dogId, {
				startedAt,
				endedAt,
				volunteerName: volunteerName.trim(),
				reactionToDogs: (behaviorRatings.dogs_rating as BehaviorRating) || null,
				reactionToStrangers: (behaviorRatings.strangers_rating as BehaviorRating) || null,
				reactionToCats: (behaviorRatings.cats_rating as BehaviorRating) || null,
				reactionToKids: (behaviorRatings.kids_rating as BehaviorRating) || null,
				reactionToLeash: (behaviorRatings.leash_rating as BehaviorRating) || null,
				reactionToCarRides: (behaviorRatings.car_rating as BehaviorRating) || null,
				reactionToToys: (behaviorRatings.toys_rating as BehaviorRating) || null,
				tripNotes: notes,
				source
			}, profile);
			dispatch('submitted', { copyText: buildCopy() });
			reset();
		} catch (e) {
			error = 'Something went wrong — please try again.';
			console.error(e);
		} finally {
			submitting = false;
		}
	}

	export function reset() {
		dogId = ''; volunteerName = ''; nameSearch = ''; date = todayStr;
		timeOut = ''; timeBack = ''; notes = ''; error = '';
		behaviorRatings = {
			kids_rating: '', dogs_rating: '', cats_rating: '', strangers_rating: '',
			leash_rating: '', car_rating: '', toys_rating: ''
		};
	}
</script>

<form class="tlf" on:submit|preventDefault={submit}>

	<div class="tlf-field">
		<label class="tlf-label" for="tlf-name">Volunteer</label>
		{#if volunteerNames.length > 0}
			<div class="tlf-ac">
				<input
					id="tlf-name"
					class="tlf-input"
					type="text"
					autocomplete="off"
					placeholder="Search volunteers…"
					bind:value={nameSearch}
					on:input={onNameInput}
					on:focus={() => { showSuggestions = true; }}
					on:blur={onNameBlur}
					required={!volunteerName}
				/>
				{#if showSuggestions && suggestions.length > 0}
					<ul class="tlf-suggestions">
						{#each suggestions as name}
							<li>
								<button type="button" class="tlf-suggestion" on:mousedown={() => pickSuggestion(name)}>{name}</button>
							</li>
						{/each}
					</ul>
				{/if}
				{#if !volunteerName && nameSearch.trim()}
					<p class="tlf-hint">Select a name from the list</p>
				{/if}
			</div>
		{:else}
			<input id="tlf-name" class="tlf-input" type="text" placeholder="First and last name" bind:value={volunteerName} required />
		{/if}
	</div>

	<div class="tlf-field">
		<label class="tlf-label" for="tlf-dog">Dog</label>
		<select id="tlf-dog" class="tlf-input" bind:value={dogId} required>
			<option value="">Select a dog…</option>
			{#each dogs as dog}
				<option value={dog.id}>{dog.name}</option>
			{/each}
		</select>
	</div>

	<div class="tlf-row">
		<div class="tlf-field">
			<label class="tlf-label" for="tlf-date">Date</label>
			<input id="tlf-date" class="tlf-input" type="date" bind:value={date} required />
		</div>
		<div class="tlf-field">
			<label class="tlf-label" for="tlf-out">Time out</label>
			<input id="tlf-out" class="tlf-input" type="time" bind:value={timeOut} />
		</div>
		<div class="tlf-field">
			<label class="tlf-label" for="tlf-back">Time back</label>
			<input id="tlf-back" class="tlf-input" type="time" bind:value={timeBack} />
		</div>
	</div>

	<div class="tlf-behavior">
		<p class="tlf-behavior-label">How did the dog do?</p>
		{#each behaviorRows as row}
			<div class="tlf-brow">
				<span class="tlf-brow-name">{row.label}</span>
				<div class="tlf-chips">
					{#each ratings as r}
						<button
							type="button"
							class="tlf-chip tlf-chip-{r.value}"
							class:active={behaviorRatings[row.key] === r.value}
							on:click={() => setRating(row.key, r.value)}
						>{r.label}</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<div class="tlf-field">
		<label class="tlf-label" for="tlf-notes">Notes</label>
		<textarea id="tlf-notes" class="tlf-input tlf-textarea" placeholder="Anything noteworthy…" bind:value={notes} rows="3"></textarea>
	</div>

	{#if error}<p class="tlf-error">{error}</p>{/if}

	<button class="tlf-submit" type="submit" disabled={submitting}>
		{submitting ? 'Saving…' : 'Save trip log'}
	</button>

</form>

<style>
	/* ── Duolingo-inspired: 12px radius everywhere, bottom-shadow depth, bold weights ── */

	.tlf { display: flex; flex-direction: column; gap: 16px; }

	.tlf-field { display: flex; flex-direction: column; gap: 6px; }

	.tlf-label {
		font-size: 13px;
		font-weight: 700;
		color: #777777;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tlf-input {
		width: 100%;
		height: 52px;
		padding: 0 16px;
		border: 2px solid #e5e5e5;
		border-radius: 12px;
		font-size: 15px;
		font-weight: 500;
		color: #3c3c3c;
		background: #fff;
		box-shadow: 0 4px 0 #e5e5e5;
		transition: border-color 0.15s, box-shadow 0.15s;
		-webkit-appearance: none;
		box-sizing: border-box;
	}

	.tlf-input:focus {
		outline: none;
		border-color: #016aa5;
		box-shadow: 0 4px 0 #014f7a;
	}

	.tlf-textarea {
		height: auto;
		padding: 14px 16px;
		resize: vertical;
		font-family: inherit;
		line-height: 1.5;
	}

	.tlf-row {
		display: grid;
		grid-template-columns: 1.3fr 1fr 1fr;
		gap: 8px;
	}

	/* ── Behavior ── */
	.tlf-behavior {
		border: 2px solid #e5e5e5;
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 4px 0 #e5e5e5;
	}

	.tlf-behavior-label {
		margin: 0;
		padding: 12px 16px 10px;
		font-size: 13px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777777;
		background: #fafafa;
		border-bottom: 2px solid #e5e5e5;
	}

	.tlf-brow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid #f0f0f0;
	}

	.tlf-brow:last-child { border-bottom: none; }

	.tlf-brow-name {
		font-size: 14px;
		font-weight: 600;
		color: #4b4b4b;
		min-width: 120px;
		flex-shrink: 0;
	}

	.tlf-chips { display: flex; gap: 6px; flex-wrap: wrap; }

	.tlf-chip {
		height: 34px;
		padding: 0 12px;
		border-radius: 8px;
		border: 2px solid #e5e5e5;
		background: #fff;
		font-size: 13px;
		font-weight: 700;
		color: #777777;
		cursor: pointer;
		box-shadow: 0 3px 0 #e5e5e5;
		transition: transform 0.1s, box-shadow 0.1s;
		white-space: nowrap;
	}

	.tlf-chip:hover { background: #f7f7f7; }

	.tlf-chip:active {
		transform: translateY(3px);
		box-shadow: none;
	}

	/* Selected — solid fill + matching bottom shadow */
	.tlf-chip-friendly.active  { background: #58cc02; border-color: #58cc02; color: #fff; box-shadow: 0 3px 0 #3f8f01; }
	.tlf-chip-neutral.active   { background: #afafaf; border-color: #afafaf; color: #fff; box-shadow: 0 3px 0 #7a7a7a; }
	.tlf-chip-nervous.active   { background: #a570ff; border-color: #a570ff; color: #fff; box-shadow: 0 3px 0 #7a4ac9; }
	.tlf-chip-excited.active   { background: #ffc700; border-color: #ffc700; color: #3c3c3c; box-shadow: 0 3px 0 #b39000; }
	.tlf-chip-reactive.active  { background: #cc3333; border-color: #cc3333; color: #fff; box-shadow: 0 3px 0 #8f1f1f; }
	.tlf-chip-na.active        { background: #1cb0f6; border-color: #1cb0f6; color: #fff; box-shadow: 0 3px 0 #0e85b8; }

	/* Press effect for active chips too */
	.tlf-chip.active:active {
		transform: translateY(3px);
		box-shadow: none;
	}

	/* ── Submit ── */
	.tlf-submit {
		width: 100%;
		height: 52px;
		border-radius: 12px;
		font-size: 15px;
		font-weight: 800;
		border: none;
		cursor: pointer;
		background: #933980;
		color: #fff;
		letter-spacing: 0.03em;
		box-shadow: 0 4px 0 #6b2a5e;
		transition: transform 0.1s, box-shadow 0.1s;
		text-transform: uppercase;
	}

	.tlf-submit:hover:not(:disabled) { background: #a8449a; }

	.tlf-submit:active:not(:disabled) {
		transform: translateY(4px);
		box-shadow: none;
	}

	.tlf-submit:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

	/* ── Autocomplete ── */
	.tlf-ac { position: relative; }

	.tlf-suggestions {
		position: absolute;
		top: calc(100% + 6px);
		left: 0; right: 0;
		background: #fff;
		border: 2px solid #e5e5e5;
		border-radius: 12px;
		box-shadow: 0 4px 0 #e5e5e5, 0 8px 20px rgba(0,0,0,.08);
		max-height: 200px;
		overflow-y: auto;
		z-index: 20;
		list-style: none;
		margin: 0;
		padding: 6px 0;
	}

	.tlf-suggestion {
		display: block;
		width: 100%;
		padding: 10px 16px;
		text-align: left;
		background: none;
		border: none;
		font-size: 15px;
		font-weight: 500;
		color: #3c3c3c;
		cursor: pointer;
	}

	.tlf-suggestion:hover { background: #f7f7f7; }

	.tlf-hint { font-size: 12px; color: #afafaf; margin: 4px 0 0 2px; }

	.tlf-error {
		font-size: 13px;
		font-weight: 700;
		color: #cc3333;
		margin: 0;
		padding: 12px 16px;
		background: #fff0f0;
		border-radius: 12px;
		border: 2px solid #ffb3b3;
	}
</style>
