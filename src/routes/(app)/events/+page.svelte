<script lang="ts">
	import { onMount, tick } from 'svelte';
	import toast from 'svelte-french-toast';
	import EventCounterCard from '$lib/components/events/EventCounterCard.svelte';
	import {
		subscribeEventMeta,
		subscribeEventHistory,
		setEventName,
		endCurrentEvent,
		type PastEvent
	} from '$lib/data/events';

	let eventName = '';
	let metaLoaded = false;
	let editingName = false;
	let nameDraft = '';
	let nameInput: HTMLInputElement | undefined;
	let history: PastEvent[] = [];
	let confirmingEnd = false;
	let endingEvent = false;

	onMount(() => {
		const unsubMeta = subscribeEventMeta((meta) => {
			eventName = meta.name;
			metaLoaded = true;
		});
		const unsubHistory = subscribeEventHistory((events) => {
			history = events;
		});
		return () => {
			unsubMeta();
			unsubHistory();
		};
	});

	async function startEditingName() {
		nameDraft = eventName;
		editingName = true;
		await tick();
		nameInput?.focus();
	}

	function saveName() {
		const trimmed = nameDraft.trim();
		editingName = false;
		if (trimmed === eventName.trim()) return;
		eventName = trimmed;
		void setEventName(trimmed).catch(() => toast.error('Could not save the event name.'));
	}

	function onNameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') saveName();
		if (event.key === 'Escape') editingName = false;
	}

	async function markEventOver() {
		if (!confirmingEnd) {
			confirmingEnd = true;
			return;
		}
		confirmingEnd = false;
		endingEvent = true;
		try {
			const archived = await endCurrentEvent();
			toast.success(`"${archived.name}" saved to history! 🎉`);
		} catch (error) {
			console.error('[events] failed to end event:', error);
			toast.error('Could not end the event — try again.');
		} finally {
			endingEvent = false;
		}
	}

	function formatEventDate(event: PastEvent) {
		if (!event.endedAt) return '';
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(event.endedAt));
	}
</script>

<svelte:head>
	<title>Events — Cache Humane Society</title>
</svelte:head>

<div class="events-page">
	<div class="event-bar">
		<div class="event-bar-name">
			<p class="event-bar-eyebrow typewriter">Now counting</p>
			{#if editingName}
				<input
					class="event-name-input"
					type="text"
					maxlength="80"
					placeholder="e.g. Summer Adoption Day"
					bind:value={nameDraft}
					bind:this={nameInput}
					on:keydown={onNameKeydown}
					on:blur={saveName}
				/>
			{:else}
				<button class="event-name-display" type="button" on:click={startEditingName}>
					{#if eventName}
						<span class="event-name-text whiteboard-hand erase-marker-blue">{eventName}</span>
					{:else}
						<span class="event-name-placeholder whiteboard-hand">
							{metaLoaded ? 'Tap to name this event ✏️' : '…'}
						</span>
					{/if}
					{#if eventName}
						<span class="event-name-pencil" aria-hidden="true">✏️</span>
					{/if}
				</button>
			{/if}
		</div>
		<button
			class={`end-event-btn typewriter ${confirmingEnd ? 'end-event-btn-confirm' : ''}`}
			type="button"
			disabled={endingEvent}
			on:click={markEventOver}
			on:blur={() => (confirmingEnd = false)}
		>
			{#if endingEvent}
				Saving…
			{:else if confirmingEnd}
				Tap again to finish &amp; save
			{:else}
				Mark event over 🏁
			{/if}
		</button>
	</div>

	<EventCounterCard
		counterId="visitors"
		eyebrow="Event Visitor Counter"
		heading="Welcome, friends! 🐾"
		unitSingular="visitor so far"
		unitPlural="visitors so far"
		buttonLabel="Visitor came in!"
		trailEmoji="🐾"
		milestone={25}
		theme="green"
	/>
	<EventCounterCard
		counterId="poodles"
		eyebrow="Poodle Patrol"
		heading="Poodles &amp; poodle mixes 🐩"
		unitSingular="poodle spotted so far"
		unitPlural="poodles spotted so far"
		buttonLabel="Poodle spotted!"
		trailEmoji="🐩"
		milestone={10}
		theme="purple"
	/>

	{#if history.length > 0}
		<div class="history-card">
			<p class="history-eyebrow typewriter">Past Events</p>
			<ul class="history-list">
				{#each history as event (event.id)}
					<li class="history-item">
						<div class="history-item-main">
							<span class="history-name whiteboard-hand">{event.name}</span>
							<span class="history-date typewriter">{formatEventDate(event)}</span>
						</div>
						<div class="history-counts">
							<span class="history-count">🐾 {event.counts.visitors} {event.counts.visitors === 1 ? 'visitor' : 'visitors'}</span>
							<span class="history-count">🐩 {event.counts.poodles} {event.counts.poodles === 1 ? 'poodle' : 'poodles'}</span>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.events-page {
		display: grid;
		grid-template-columns: minmax(0, 34rem);
		justify-content: center;
		align-items: start;
		gap: 1rem;
		padding: 1rem 0.5rem 2rem;
	}

	@media (min-width: 1100px) {
		.events-page {
			grid-template-columns: repeat(2, minmax(0, 34rem));
		}

		.event-bar,
		.history-card {
			grid-column: 1 / -1;
		}
	}

	.event-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		padding: 0.9rem 1.2rem;
		border: 1px solid #d1dfec;
		border-radius: 1.1rem;
		background: rgba(255, 255, 255, 0.97);
		box-shadow:
			0 12px 28px rgba(14, 38, 61, 0.1),
			0 1px 0 rgba(255, 255, 255, 0.85) inset;
	}

	.event-bar-name {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
		flex: 1 1 14rem;
	}

	.event-bar-eyebrow {
		margin: 0;
		font-size: 0.55rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #526b81;
	}

	.event-name-display {
		display: inline-flex;
		align-items: baseline;
		gap: 0.45rem;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		text-align: left;
		min-width: 0;
	}

	.event-name-text {
		font-size: clamp(1.15rem, 4vw, 1.55rem);
		color: #016aa5;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.event-name-placeholder {
		font-size: clamp(1.05rem, 3.5vw, 1.3rem);
		color: #8aa0b4;
	}

	.event-name-pencil {
		font-size: 0.8rem;
		opacity: 0.6;
	}

	.event-name-display:hover .event-name-pencil {
		opacity: 1;
	}

	.event-name-input {
		width: 100%;
		max-width: 24rem;
		padding: 0.35rem 0.55rem;
		border: 1px solid #9fc0da;
		border-radius: 0.6rem;
		font-family: var(--font-ui);
		font-size: 1.05rem;
		font-weight: 700;
		color: #133149;
		background: #f7fbff;
	}

	.event-name-input:focus {
		outline: 2px solid rgba(1, 106, 165, 0.35);
		outline-offset: 1px;
	}

	.end-event-btn {
		flex-shrink: 0;
		border: 1px solid #c4d6e8;
		border-radius: 999px;
		padding: 0.5rem 1.1rem;
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 700;
		background: rgba(1, 106, 165, 0.06);
		color: #016aa5;
		cursor: pointer;
	}

	.end-event-btn:hover:not(:disabled) {
		background: rgba(1, 106, 165, 0.14);
	}

	.end-event-btn:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.end-event-btn-confirm {
		border-color: rgba(207, 75, 75, 0.5);
		background: rgba(207, 75, 75, 0.1);
		color: #cf4b4b;
	}

	.end-event-btn-confirm:hover:not(:disabled) {
		background: rgba(207, 75, 75, 0.18);
	}

	.history-card {
		padding: 1.1rem 1.2rem 0.9rem;
		border: 1px solid #d1dfec;
		border-radius: 1.1rem;
		background: rgba(255, 255, 255, 0.97);
		box-shadow:
			0 12px 28px rgba(14, 38, 61, 0.1),
			0 1px 0 rgba(255, 255, 255, 0.85) inset;
	}

	.history-eyebrow {
		margin: 0 0 0.5rem;
		font-size: 0.55rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #526b81;
	}

	.history-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.history-item {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.3rem 0.8rem;
		padding: 0.55rem 0;
	}

	.history-item:not(:last-child) {
		border-bottom: 1px dashed #dce8f2;
	}

	.history-item-main {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		min-width: 0;
	}

	.history-name {
		font-size: 1.05rem;
		color: #133149;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-date {
		font-size: 0.52rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #8aa0b4;
		flex-shrink: 0;
	}

	.history-counts {
		display: flex;
		gap: 0.9rem;
		flex-shrink: 0;
	}

	.history-count {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 700;
		color: #526b81;
	}
</style>
