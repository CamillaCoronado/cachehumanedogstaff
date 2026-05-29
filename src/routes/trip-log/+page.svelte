<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '$lib/firebase/config';
	import { collection, doc, setDoc } from 'firebase/firestore';
	import { listDogs, logManualTrip } from '$lib/data/dogs';
	import type { BehaviorRating, Dog } from '$lib/types';

	let dogs: Dog[] = [];
	let loading = true;
	let submitted = false;
	let submitting = false;
	let error = '';
	let copyText = '';

	const now = new Date();
	const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

	let dogId = '';
	let volunteerName = '';
	let date = todayStr;
	let timeOut = '';
	let timeBack = '';
	let dogs_rating: BehaviorRating | '' = '';
	let strangers_rating: BehaviorRating | '' = '';
	let cats_rating: BehaviorRating | '' = '';
	let kids_rating: BehaviorRating | '' = '';
	let notes = '';

	onMount(async () => {
		try {
			const all = await listDogs();
			dogs = all
				.filter((d) => d.status === 'active' && !d.inFoster && d.isolationStatus === 'none')
				.sort((a, b) => a.name.localeCompare(b.name));
		} catch (e) {
			console.error(e);
		} finally {
			loading = false;
		}
	});

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
		const r = (v: BehaviorRating | '') =>
			v === 'good' ? 'Good' : v === 'neutral' ? 'Neutral' : v === 'reactive' ? 'Reactive' : v === 'na' ? 'N/A' : '—';
		const lines = [
			`Day Trip — ${dog.name} — ${dateLabel}`,
			`Volunteer: ${volunteerName || '—'}`,
			`Time out: ${timeOut || '—'} | Time back: ${timeBack || '—'}`,
			``,
			`Behavior:`,
			`• Around dogs: ${r(dogs_rating)}`,
			`• Around strangers: ${r(strangers_rating)}`,
			`• Around cats: ${r(cats_rating)}`,
			`• Around kids: ${r(kids_rating)}`,
		];
		if (notes.trim()) lines.push(``, `Notes: ${notes.trim()}`);
		return lines.join('\n');
	}

	async function submit() {
		if (!dogId) { error = 'Please select a dog.'; return; }
		if (!volunteerName.trim()) { error = 'Please enter your name.'; return; }
		error = '';
		submitting = true;
		try {
			const startedAt = buildDateTime(date, timeOut) ?? new Date();
			const endedAt = timeBack ? buildDateTime(date, timeBack) : null;
			await logManualTrip(dogId, {
				startedAt,
				endedAt,
				volunteerName: volunteerName.trim(),
				reactionToDogs: (dogs_rating as BehaviorRating) || null,
				reactionToStrangers: (strangers_rating as BehaviorRating) || null,
				reactionToCats: (cats_rating as BehaviorRating) || null,
				reactionToKids: (kids_rating as BehaviorRating) || null,
				tripNotes: notes,
				source: 'qr'
			});
			copyText = buildCopy();
			submitted = true;
		} catch (e) {
			error = 'Something went wrong — please try again.';
			console.error(e);
		} finally {
			submitting = false;
		}
	}

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(copyText);
		} catch {
			// ignore
		}
	}

	const ratings: { value: BehaviorRating; label: string }[] = [
		{ value: 'good', label: 'Good' },
		{ value: 'neutral', label: 'Neutral' },
		{ value: 'reactive', label: 'Reactive' },
		{ value: 'na', label: 'N/A' }
	];
</script>

<svelte:head>
	<title>Log a Day Trip — Cache Humane Society</title>
</svelte:head>

<div class="tl-page">
	<div class="tl-card">
		<div class="tl-header">
			<p class="tl-title">Day Trip Log</p>
			<p class="tl-sub">Cache Humane Society</p>
		</div>

		{#if submitted}
			<div class="tl-success">
				<p class="tl-success-title">Trip logged — thank you!</p>
				{#if copyText}
					<pre class="tl-copy-pre">{copyText}</pre>
					<button class="tl-btn tl-btn-copy" on:click={copyToClipboard}>Copy to clipboard</button>
				{/if}
			</div>
		{:else if loading}
			<p class="tl-loading">Loading…</p>
		{:else}
			<form class="tl-form" on:submit|preventDefault={submit}>

				<div class="tl-field">
					<label class="tl-label" for="tl-name">Your name</label>
					<input id="tl-name" class="tl-input" type="text" bind:value={volunteerName} placeholder="First and last name" required />
				</div>

				<div class="tl-field">
					<label class="tl-label" for="tl-dog">Dog taken out</label>
					<select id="tl-dog" class="tl-input" bind:value={dogId} required>
						<option value="">— select a dog —</option>
						{#each dogs as dog}
							<option value={dog.id}>{dog.name}</option>
						{/each}
					</select>
				</div>

				<div class="tl-row">
					<div class="tl-field">
						<label class="tl-label" for="tl-date">Date</label>
						<input id="tl-date" class="tl-input" type="date" bind:value={date} required />
					</div>
					<div class="tl-field">
						<label class="tl-label" for="tl-out">Time out</label>
						<input id="tl-out" class="tl-input" type="time" bind:value={timeOut} />
					</div>
					<div class="tl-field">
						<label class="tl-label" for="tl-back">Time back</label>
						<input id="tl-back" class="tl-input" type="time" bind:value={timeBack} />
					</div>
				</div>

				<div class="tl-field">
					<p class="tl-label">How did the dog react?</p>
					{#each [['Around other dogs', 'dogs_rating'], ['Around strangers', 'strangers_rating'], ['Around cats', 'cats_rating'], ['Around kids', 'kids_rating']] as [label, key]}
						<div class="tl-rating-row">
							<span class="tl-rating-label">{label}</span>
							<div class="tl-rating-btns">
								{#each ratings as r}
									<button
										type="button"
										class="tl-rating-btn"
										class:active={
											key === 'dogs_rating' ? dogs_rating === r.value :
											key === 'strangers_rating' ? strangers_rating === r.value :
											key === 'cats_rating' ? cats_rating === r.value :
											kids_rating === r.value
										}
										on:click={() => {
											if (key === 'dogs_rating') dogs_rating = dogs_rating === r.value ? '' : r.value;
											else if (key === 'strangers_rating') strangers_rating = strangers_rating === r.value ? '' : r.value;
											else if (key === 'cats_rating') cats_rating = cats_rating === r.value ? '' : r.value;
											else kids_rating = kids_rating === r.value ? '' : r.value;
										}}
									>{r.label}</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<div class="tl-field">
					<label class="tl-label" for="tl-notes">Notes</label>
					<textarea id="tl-notes" class="tl-textarea" bind:value={notes} rows="4" placeholder="Anything noteworthy from the trip…"></textarea>
				</div>

				{#if error}<p class="tl-error">{error}</p>{/if}

				<button class="tl-btn tl-btn-submit" type="submit" disabled={submitting}>
					{submitting ? 'Submitting…' : 'Submit'}
				</button>
			</form>
		{/if}
	</div>
</div>

<style>
	.tl-page {
		min-height: 100vh;
		background: #f1f3f4;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 1.5rem 1rem 3rem;
	}

	.tl-card {
		width: 100%;
		max-width: 480px;
		background: #fff;
		border-radius: 10px;
		box-shadow: 0 2px 8px rgba(60,64,67,.12);
		overflow: hidden;
	}

	.tl-header {
		padding: 1.2rem 1.4rem 0.9rem;
		border-bottom: 1px solid #f1f3f4;
	}

	.tl-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: #202124;
		margin: 0 0 0.15rem;
	}

	.tl-sub {
		font-size: 0.78rem;
		color: #5f6368;
		margin: 0;
	}

	.tl-form { padding: 1.2rem 1.4rem; display: grid; gap: 1rem; }

	.tl-field { display: flex; flex-direction: column; gap: 0.35rem; }

	.tl-row {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.6rem;
	}

	.tl-label {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #5f6368;
	}

	.tl-input {
		height: 2.4rem;
		border: 1px solid #dadce0;
		border-radius: 6px;
		padding: 0 0.75rem;
		font-size: 0.9rem;
		color: #202124;
		background: #fff;
		width: 100%;
	}

	.tl-textarea {
		border: 1px solid #dadce0;
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		font-size: 0.88rem;
		color: #202124;
		font-family: inherit;
		resize: vertical;
		width: 100%;
	}

	.tl-rating-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0;
		border-bottom: 1px solid #f1f3f4;
	}

	.tl-rating-row:last-child { border-bottom: none; }

	.tl-rating-label {
		font-size: 0.82rem;
		color: #3c4043;
		min-width: 9rem;
	}

	.tl-rating-btns { display: flex; gap: 0.3rem; flex-wrap: wrap; }

	.tl-rating-btn {
		padding: 0.25rem 0.65rem;
		border-radius: 4px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.78rem;
		color: #5f6368;
		cursor: pointer;
	}

	.tl-rating-btn.active {
		border-color: #016aa5;
		background: #e8f0fe;
		color: #016aa5;
		font-weight: 600;
	}

	.tl-btn {
		width: 100%;
		padding: 0.75rem;
		border-radius: 6px;
		font-size: 0.95rem;
		font-weight: 600;
		border: none;
		cursor: pointer;
	}

	.tl-btn-submit {
		background: #016aa5;
		color: #fff;
		margin-top: 0.3rem;
	}

	.tl-btn-submit:hover:not(:disabled) { background: #015a8c; }
	.tl-btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

	.tl-btn-copy {
		background: #e6f4ea;
		color: #1e7e34;
		border: 1px solid #a8d5a2;
		margin-top: 0.5rem;
	}

	.tl-error {
		font-size: 0.8rem;
		color: #d93025;
		margin: 0;
	}

	.tl-success {
		padding: 1.4rem;
		display: grid;
		gap: 0.75rem;
	}

	.tl-success-title {
		font-size: 1rem;
		font-weight: 600;
		color: #1e7e34;
		margin: 0;
	}

	.tl-copy-pre {
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

	.tl-loading {
		padding: 2rem 1.4rem;
		font-size: 0.88rem;
		color: #5f6368;
	}
</style>
