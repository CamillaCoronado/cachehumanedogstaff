<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { format } from 'date-fns';
	import type { AmountEaten, Dog, MealTime, PendingFeeding, PlaygroupOutcome, UserProfile } from '$lib/types';
	import {
		acceptPendingFeeding,
		dismissPendingFeeding,
		listPendingFeedings,
		withCurrentReading
	} from '$lib/data/pendingFeedings';
	import {
		addPlaygroupSession,
		listPendingPlaygroups,
		markPendingProcessed,
		pendingPostedAt,
		type PendingPlaygroup
	} from '$lib/data/playgroups';
	import { matchDogByName } from '$lib/utils/dogs';
	import { formatDateTime } from '$lib/utils/dates';

	/** Every dog, for matching names and for adding a dog when editing. */
	export let dogs: Dog[] = [];
	export let profile: UserProfile | null = null;

	type Item =
		| { kind: 'feeding'; id: string; at: Date; feeding: PendingFeeding }
		| { kind: 'playgroup'; id: string; at: Date; playgroup: PendingPlaygroup };

	let feedings: PendingFeeding[] = [];
	let playgroups: PendingPlaygroup[] = [];
	let loading = false;
	let loadError = '';
	let busyId: string | null = null;
	let editingId: string | null = null;

	// One list, newest first: what was said in Slack and what the app made of it.
	$: items = [
		...feedings.map((f) => ({ kind: 'feeding' as const, id: `f-${f.id}`, at: new Date(f.postedAt), feeding: f })),
		...playgroups.map((p) => ({ kind: 'playgroup' as const, id: `p-${p.id}`, at: pendingPostedAt(p), playgroup: p }))
	].sort((a, b) => b.at.getTime() - a.at.getTime()) as Item[];

	export async function load() {
		loading = true;
		loadError = '';
		try {
			const [f, p] = await Promise.all([
				listPendingFeedings().then(withCurrentReading),
				listPendingPlaygroups()
			]);
			feedings = f;
			playgroups = p;
		} catch (error) {
			console.error(error);
			// Shown, not toasted: a failure here would otherwise look like an empty list.
			loadError = error instanceof Error ? error.message : 'Could not load the list.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const AMOUNTS: { value: AmountEaten; label: string }[] = [
		{ value: 'all', label: 'ate all' },
		{ value: 'most', label: 'ate most' },
		{ value: 'half', label: 'ate half' },
		{ value: 'little', label: 'ate little' },
		{ value: 'none', label: "didn't eat" }
	];
	const amountLabel = (a: AmountEaten) => AMOUNTS.find((x) => x.value === a)?.label ?? a;
	const mealLabel = (m: MealTime) => (m === 'am' ? 'Morning' : m === 'pm' ? 'Afternoon' : 'Second meal');

	// --- Feeding ---------------------------------------------------------------

	type FeedingDraft = {
		mealTime: MealTime;
		named: { dogId: string; dogName: string; amountEaten: AmountEaten }[];
		fillIn: boolean;
		addDogId: string;
		addAmount: AmountEaten;
	};
	let feedingDraft: FeedingDraft | null = null;

	$: shelterDogs = dogs
		.filter((d) => d.status === 'active' && !d.inFoster && !d.permanentFoster)
		.sort((a, b) => a.name.localeCompare(b.name));

	function mealOf(f: PendingFeeding): MealTime {
		return f.entries[0]?.mealTime ?? 'am';
	}

	function startFeedingEdit(item: Item & { kind: 'feeding' }) {
		const f = item.feeding;
		editingId = item.id;
		feedingDraft = {
			mealTime: mealOf(f),
			named: f.entries.filter((e) => !e.implied).map((e) => ({ dogId: e.dogId, dogName: e.dogName, amountEaten: e.amountEaten })),
			fillIn: f.entries.some((e) => e.implied),
			addDogId: '',
			addAmount: 'none'
		};
	}

	function addDraftDog() {
		if (!feedingDraft?.addDogId) return;
		const dog = dogs.find((d) => d.id === feedingDraft!.addDogId);
		if (!dog || feedingDraft.named.some((n) => n.dogId === dog.id)) return;
		feedingDraft = {
			...feedingDraft,
			named: [...feedingDraft.named, { dogId: dog.id, dogName: dog.name, amountEaten: feedingDraft.addAmount }],
			addDogId: ''
		};
	}

	async function confirmFeeding(item: Item & { kind: 'feeding' }, withEdit: boolean) {
		busyId = item.id;
		try {
			const edit = withEdit && feedingDraft
				? { mealTime: feedingDraft.mealTime, named: feedingDraft.named, fillIn: feedingDraft.fillIn }
				: undefined;
			const written = await acceptPendingFeeding(item.feeding, profile, edit);
			feedings = feedings.filter((f) => f.id !== item.feeding.id);
			editingId = null;
			toast.success(`Logged ${written} feeding${written === 1 ? '' : 's'}.`);
		} catch (error) {
			console.error(error);
			toast.error('Could not save those feedings.');
		} finally {
			busyId = null;
		}
	}

	async function rejectFeeding(item: Item & { kind: 'feeding' }) {
		busyId = item.id;
		try {
			await dismissPendingFeeding(item.feeding.id);
			feedings = feedings.filter((f) => f.id !== item.feeding.id);
			if (editingId === item.id) editingId = null;
		} catch (error) {
			console.error(error);
			toast.error('Could not dismiss that message.');
		} finally {
			busyId = null;
		}
	}

	// --- Playgroup -------------------------------------------------------------

	type PlaygroupDraft = {
		removed: string[];
		date: string;
		outcome: PlaygroupOutcome;
		groupName: string;
		notes: string;
	};
	let playgroupDraft: PlaygroupDraft | null = null;

	// Same matching as the Playgroups page: dogs here now first, then anyone on record.
	// Rebuilt when the dog list changes, so names are coloured once the dogs have loaded
	// (the template calls it, and Svelte only re-renders on what it can see change).
	function makeMatcher(all: Dog[]) {
		const candidates = all.filter((d) => !d.permanentFoster && !d.isIncoming);
		const active = candidates.filter((d) => d.status === 'active');
		return (name: string) => {
			const dog = matchDogByName(name, active) ?? matchDogByName(name, candidates);
			return { name, dog, state: dog ? (dog.status === 'active' ? 'matched' : 'archived') : 'unmatched' };
		};
	}
	$: matchName = makeMatcher(dogs);

	function startPlaygroupEdit(item: Item & { kind: 'playgroup' }) {
		const p = item.playgroup;
		editingId = item.id;
		playgroupDraft = {
			removed: [],
			date: format(pendingPostedAt(p), 'yyyy-MM-dd'),
			outcome: p.suggestedOutcome,
			groupName: '',
			notes: p.suggestedNotes ?? ''
		};
	}

	function toggleRemoved(name: string) {
		if (!playgroupDraft) return;
		const removed = playgroupDraft.removed.includes(name)
			? playgroupDraft.removed.filter((n) => n !== name)
			: [...playgroupDraft.removed, name];
		playgroupDraft = { ...playgroupDraft, removed };
	}

	function dayFromInput(value: string): Date {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date();
	}

	async function confirmPlaygroup(item: Item & { kind: 'playgroup' }, withEdit: boolean) {
		const p = item.playgroup;
		const draft = withEdit && playgroupDraft ? playgroupDraft : null;
		const matches = p.dogNames.filter((n) => !draft?.removed.includes(n)).map(matchName);
		if (matches.length < 2) {
			toast.error('A playgroup needs at least 2 dogs.');
			return;
		}
		busyId = item.id;
		try {
			await addPlaygroupSession(
				{
					date: draft ? dayFromInput(draft.date) : pendingPostedAt(p),
					groupName: draft?.groupName.trim() ?? '',
					dogIds: matches.filter((m) => m.dog).map((m) => m.dog!.id),
					dogNames: matches.map((m) => m.name),
					recommendationType: 'manual',
					outcome: draft?.outcome ?? p.suggestedOutcome,
					notes: (draft ? draft.notes : p.suggestedNotes ?? '').trim() || null,
					durationMinutes: null
				},
				profile
			);
			await markPendingProcessed(p.id);
			playgroups = playgroups.filter((x) => x.id !== p.id);
			editingId = null;
			toast.success('Playgroup logged.');
		} catch (error) {
			console.error(error);
			toast.error('Could not save that playgroup.');
		} finally {
			busyId = null;
		}
	}

	async function rejectPlaygroup(item: Item & { kind: 'playgroup' }) {
		busyId = item.id;
		try {
			await markPendingProcessed(item.playgroup.id);
			playgroups = playgroups.filter((x) => x.id !== item.playgroup.id);
			if (editingId === item.id) editingId = null;
		} catch (error) {
			console.error(error);
			toast.error('Could not dismiss that message.');
		} finally {
			busyId = null;
		}
	}
</script>

<section class="check-card">
	<div class="check-head">
		<div>
			<p class="check-kicker">From Slack</p>
			<h3 class="check-title">Check these {#if items.length}<span class="check-count">{items.length}</span>{/if}</h3>
			<p class="check-copy">
				What was said in Slack and how the app read it. <strong>Right</strong> logs it,
				<strong>Wrong</strong> throws it away, <strong>Edit</strong> lets you fix it first.
			</p>
		</div>
		<button class="ghost-btn" type="button" on:click={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
	</div>

	{#if loadError}
		<p class="check-error">Could not load the list: {loadError}</p>
	{:else if items.length === 0}
		<p class="check-empty">{loading ? 'Checking Slack…' : 'All caught up — nothing to check.'}</p>
	{:else}
		<ul class="check-list">
			{#each items as item (item.id)}
				{@const busy = busyId === item.id}
				{@const editing = editingId === item.id}
				<li class="check-item">
					<p class="check-meta">
						<span class={`check-tag check-tag-${item.kind}`}>{item.kind === 'feeding' ? 'Feeding' : 'Playgroup'}</span>
						<strong>{item.kind === 'feeding' ? item.feeding.author : item.playgroup.author ?? 'Slack'}</strong>
						<span>{formatDateTime(item.at)}</span>
					</p>
					<blockquote class="check-quote">
						{item.kind === 'feeding' ? item.feeding.rawText : item.playgroup.rawText}
					</blockquote>

					{#if item.kind === 'feeding'}
						{@const f = item.feeding}
						{#if !editing}
							<p class="check-reading">
								<span class="check-reads">Reads as:</span>
								{mealLabel(mealOf(f))}
								{#each f.entries.filter((e) => !e.implied) as e}
									{' · '}<strong>{e.dogName}</strong>{` ${amountLabel(e.amountEaten)}`}
								{/each}
								{#if f.entries.some((e) => e.implied)}
									{@const others = f.entries.filter((e) => e.implied).length}
									{` · ${others} ${others === 1 ? 'other' : 'others'} ate all`}
								{/if}
							</p>
							{#if f.uncertain?.length}
								<p class="check-why">Unsure because: {f.uncertain.join(' · ')}</p>
							{/if}
							<div class="check-actions">
								<button class="action-btn" type="button" disabled={busy} on:click={() => confirmFeeding(item, false)}>
									{busy ? 'Saving…' : '✓ Right'}
								</button>
								<button class="ghost-btn" type="button" disabled={busy} on:click={() => rejectFeeding(item)}>✗ Wrong</button>
								<button class="ghost-btn" type="button" disabled={busy} on:click={() => startFeedingEdit(item)}>Edit</button>
							</div>
						{:else if feedingDraft}
							<div class="check-edit">
								<label class="check-field">
									<span>Meal</span>
									<select bind:value={feedingDraft.mealTime}>
										<option value="am">Morning</option>
										<option value="pm">Afternoon</option>
										<option value="second">Second meal</option>
									</select>
								</label>
								<ul class="check-named">
									{#each feedingDraft.named as n, i (n.dogId)}
										<li>
											<span class="check-dog">{n.dogName}</span>
											<select bind:value={feedingDraft.named[i].amountEaten}>
												{#each AMOUNTS as a}<option value={a.value}>{a.label}</option>{/each}
											</select>
											<button
												class="check-remove"
												type="button"
												aria-label={`Remove ${n.dogName}`}
												on:click={() => feedingDraft && (feedingDraft = { ...feedingDraft, named: feedingDraft.named.filter((x) => x.dogId !== n.dogId) })}
											>×</button>
										</li>
									{/each}
								</ul>
								<div class="check-add">
									<select bind:value={feedingDraft.addDogId}>
										<option value="">Add a dog…</option>
										{#each shelterDogs.filter((d) => !feedingDraft?.named.some((n) => n.dogId === d.id)) as d (d.id)}
											<option value={d.id}>{d.name}</option>
										{/each}
									</select>
									<select bind:value={feedingDraft.addAmount}>
										{#each AMOUNTS as a}<option value={a.value}>{a.label}</option>{/each}
									</select>
									<button class="ghost-btn action-btn-small" type="button" on:click={addDraftDog} disabled={!feedingDraft.addDogId}>Add</button>
								</div>
								<label class="check-toggle">
									<input type="checkbox" bind:checked={feedingDraft.fillIn} />
									Everyone else at the shelter ate all
								</label>
								<div class="check-actions">
									<button class="action-btn" type="button" disabled={busy} on:click={() => confirmFeeding(item, true)}>
										{busy ? 'Saving…' : '✓ Save'}
									</button>
									<button class="ghost-btn" type="button" disabled={busy} on:click={() => (editingId = null)}>Cancel</button>
								</div>
							</div>
						{/if}
					{:else}
						{@const p = item.playgroup}
						{@const matches = p.dogNames.map(matchName)}
						{#if !editing}
							<p class="check-reading">
								<span class="check-reads">Reads as:</span>
								{format(pendingPostedAt(p), 'MMM d')} · {p.suggestedOutcome}
							</p>
							<div class="check-pills">
								{#each matches as m (m.name)}
									<span class={`check-pill pill-${m.state}`}>{m.name}</span>
								{/each}
							</div>
							<div class="check-actions">
								<button
									class="action-btn"
									type="button"
									disabled={busy || matches.length < 2}
									title={matches.length < 2 ? 'Needs at least 2 dogs — use Edit' : ''}
									on:click={() => confirmPlaygroup(item, false)}
								>
									{busy ? 'Saving…' : '✓ Right'}
								</button>
								<button class="ghost-btn" type="button" disabled={busy} on:click={() => rejectPlaygroup(item)}>✗ Wrong</button>
								<button class="ghost-btn" type="button" disabled={busy} on:click={() => startPlaygroupEdit(item)}>Edit</button>
							</div>
						{:else if playgroupDraft}
							<div class="check-edit">
								<p class="check-hint">Click a name to remove it. Gray: not a dog in the app · Amber: no longer at the shelter.</p>
								<div class="check-pills">
									{#each matches as m (m.name)}
										<button
											type="button"
											class={`check-pill pill-${playgroupDraft.removed.includes(m.name) ? 'excluded' : m.state}`}
											on:click={() => toggleRemoved(m.name)}
										>{m.name}</button>
									{/each}
								</div>
								<div class="check-row">
									<label class="check-field">
										<span>Date</span>
										<input type="date" bind:value={playgroupDraft.date} />
									</label>
									<label class="check-field">
										<span>Outcome</span>
										<select bind:value={playgroupDraft.outcome}>
											<option value="successful">Successful</option>
											<option value="mixed">Mixed</option>
											<option value="incident">Incident</option>
											<option value="cancelled">Cancelled</option>
										</select>
									</label>
									<label class="check-field">
										<span>Group name</span>
										<input bind:value={playgroupDraft.groupName} placeholder="optional" />
									</label>
								</div>
								<label class="check-field">
									<span>Notes</span>
									<textarea rows="2" bind:value={playgroupDraft.notes}></textarea>
								</label>
								<div class="check-actions">
									<button
										class="action-btn"
										type="button"
										disabled={busy || matches.length - playgroupDraft.removed.length < 2}
										on:click={() => confirmPlaygroup(item, true)}
									>
										{busy ? 'Saving…' : '✓ Save'}
									</button>
									<button class="ghost-btn" type="button" disabled={busy} on:click={() => (editingId = null)}>Cancel</button>
								</div>
							</div>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.check-card {
		border: 1px solid #d6e1ec;
		border-radius: 1rem;
		background: #ffffff;
		padding: 1rem;
		display: grid;
		gap: 0.8rem;
	}
	.check-head {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: flex-start;
	}
	.check-kicker {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #526b81;
	}
	.check-title {
		margin: 0.15rem 0 0;
		font-size: 1.1rem;
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.check-count {
		font-size: 0.75rem;
		background: #016ba5;
		color: #fff;
		border-radius: 999px;
		padding: 0.08rem 0.5rem;
	}
	.check-copy {
		margin: 0.3rem 0 0;
		font-size: 0.84rem;
		color: #526b81;
	}
	.check-empty,
	.check-error {
		margin: 0;
		padding: 0.8rem 0.9rem;
		border-radius: 0.8rem;
		background: #f2f7fb;
		color: #214866;
		font-size: 0.88rem;
	}
	.check-error {
		background: #fdf0f0;
		color: #9b2c2c;
	}
	.check-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.check-item {
		border: 1px solid #d8d2c4;
		border-radius: 6px;
		padding: 12px 14px;
		display: grid;
		gap: 9px;
		min-width: 0;
	}
	.check-meta {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: baseline;
		font-size: 0.78rem;
		color: #6b6459;
	}
	.check-tag {
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
	}
	.check-tag-feeding {
		background: #fff4cc;
		color: #7a4f00;
	}
	.check-tag-playgroup {
		background: #e3f0fb;
		color: #1a4f7a;
	}
	.check-quote {
		margin: 0;
		padding-left: 11px;
		border-left: 2px solid #d8d2c4;
		font-size: 0.94rem;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.check-reading {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
	}
	.check-reads {
		font-weight: 700;
		color: #526b81;
	}
	.check-why {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: #a8501b;
		padding: 6px 10px;
		background: #f6e6d9;
		border-radius: 3px;
	}
	.check-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.check-edit {
		display: grid;
		gap: 10px;
		padding: 10px;
		background: #f7fbff;
		border-radius: 6px;
	}
	.check-row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.check-field {
		display: grid;
		gap: 3px;
		font-size: 0.78rem;
		color: #526b81;
		min-width: 0;
	}
	.check-field input,
	.check-field select,
	.check-field textarea,
	.check-named select,
	.check-add select {
		font: inherit;
		font-size: 0.9rem;
		padding: 6px 8px;
		border: 1px solid #c8d3df;
		border-radius: 4px;
		background: #fff;
		color: #1f3550;
		max-width: 100%;
	}
	.check-named {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.check-named li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.check-dog {
		font-weight: 600;
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.check-remove {
		border: 1px solid #e0c4c4;
		background: #fff;
		color: #9b2c2c;
		border-radius: 4px;
		width: 2rem;
		height: 2rem;
		font-size: 1rem;
	}
	.check-add {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.check-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.86rem;
	}
	.check-hint {
		margin: 0;
		font-size: 0.76rem;
		color: #526b81;
	}
	.check-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.check-pill {
		border-radius: 999px;
		padding: 0.14rem 0.5rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		font-family: inherit;
	}
	button.check-pill {
		cursor: pointer;
	}
	.pill-matched {
		background: #e9f6ec;
		color: #256640;
		border: 1px solid #abd5b4;
	}
	.pill-archived {
		background: #fef3e2;
		color: #7a4f10;
		border: 1px solid #f0c87a;
	}
	.pill-unmatched {
		background: #f0f2f5;
		color: #7a8fa6;
		border: 1px solid #c8d3df;
	}
	.pill-excluded {
		background: #f5f5f5;
		color: #b0b0b0;
		border: 1px solid #d4d4d4;
		text-decoration: line-through;
		opacity: 0.6;
	}
	.action-btn,
	.ghost-btn {
		min-height: 2.5rem;
		padding: 0.55rem 0.9rem;
		border-radius: 0.8rem;
		font-family: var(--font-ui);
		font-size: 0.86rem;
		font-weight: 700;
	}
	.action-btn {
		border: 1px solid #126a97;
		background: linear-gradient(180deg, #1387be 0%, #016ba5 100%);
		color: #ffffff;
	}
	.ghost-btn {
		border: 1px solid #cad8e6;
		background: #f7fbff;
		color: #214866;
	}
	.action-btn:disabled,
	.ghost-btn:disabled {
		opacity: 0.6;
	}
	.action-btn-small {
		min-height: 2rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
	}
</style>
