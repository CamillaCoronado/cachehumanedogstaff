<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Treatment } from '$lib/types';
	import { toDateString } from '$lib/utils/dates';

	export let treatment: Treatment;
	/** Which field to focus when the editor opens — staff usually come here for one or
	 *  the other ("+ reason" vs. tapping the medication). */
	export let focusField: 'condition' | 'name' = 'name';
	export let saving = false;

	const dispatch = createEventDispatcher<{
		save: { condition: string | null; name: string; startDate: string; endDate: string; notes: string | null };
		cancel: void;
		remove: void;
	}>();

	let condition = treatment.condition ?? '';
	let name = treatment.name ?? '';
	let startDate = toDateString(treatment.startDate)?.slice(0, 10) ?? '';
	let endDate = toDateString(treatment.endDate)?.slice(0, 10) ?? '';
	let notes = treatment.notes ?? '';

	function focusIf(node: HTMLInputElement, shouldFocus: boolean) {
		if (shouldFocus) {
			node.focus();
			node.select();
		}
	}

	// The medication is optional — staff often record what a dog is being treated for
	// before anyone writes down the drug. With only a reason, it stands in as the name.
	$: canSave = !!(name.trim() || condition.trim());

	function submit() {
		if (!canSave) return;
		dispatch('save', {
			condition: condition.trim() || null,
			name: name.trim() || condition.trim(),
			startDate,
			endDate,
			notes: notes.trim() || null
		});
	}

	// Attached as an action rather than an on:keydown so the <form> stays a plain form
	// (a listener on it trips the non-interactive-element a11y rule).
	function escapeToCancel(node: HTMLElement) {
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				dispatch('cancel');
			}
		};
		node.addEventListener('keydown', onKeydown);
		return { destroy: () => node.removeEventListener('keydown', onKeydown) };
	}
</script>

<form class="tx-editor" on:submit|preventDefault={submit} use:escapeToCancel>
	<div class="tx-editor-row">
		<label class="tx-field">
			<span class="tx-label">Reason</span>
			<input
				class="tx-input"
				type="text"
				placeholder="e.g. URI"
				bind:value={condition}
				use:focusIf={focusField === 'condition'}
			/>
		</label>
		<label class="tx-field">
			<span class="tx-label">Medication</span>
			<input
				class="tx-input"
				type="text"
				placeholder="e.g. doxycycline"
				bind:value={name}
				use:focusIf={focusField === 'name'}
			/>
		</label>
	</div>
	<div class="tx-editor-row">
		<label class="tx-field">
			<span class="tx-label">Started</span>
			<input class="tx-input tx-input-date" type="date" bind:value={startDate} />
		</label>
		<label class="tx-field">
			<span class="tx-label">Ends</span>
			<input class="tx-input tx-input-date" type="date" bind:value={endDate} />
		</label>
	</div>
	<label class="tx-field">
		<span class="tx-label">Notes</span>
		<input class="tx-input" type="text" placeholder="Optional" bind:value={notes} />
	</label>
	<div class="tx-editor-actions">
		<button type="button" class="tx-remove" disabled={saving} on:click={() => dispatch('remove')}>
			Remove
		</button>
		<button type="button" class="tx-cancel" disabled={saving} on:click={() => dispatch('cancel')}>
			Cancel
		</button>
		<button type="submit" class="tx-save" disabled={saving || !canSave}>
			{saving ? '…' : 'Save'}
		</button>
	</div>
</form>

<style>
	.tx-editor {
		display: grid;
		gap: 0.3rem;
		margin: 0.2rem 0 0.35rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid #c4b8d6;
		border-radius: 0.5rem;
		background: #ffffff;
	}

	.tx-editor-row {
		display: flex;
		gap: 0.3rem;
	}

	.tx-field {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.08rem;
	}

	.tx-label {
		font-family: var(--font-ui);
		font-size: 0.56rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: #9aa7b4;
	}

	.tx-input {
		flex: 1;
		min-width: 0;
		border: 1px solid #d7d0e2;
		border-radius: 0.38rem;
		padding: 0.22rem 0.4rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: #33414f;
	}

	.tx-input-date {
		flex: 1;
	}

	.tx-editor-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.tx-remove,
	.tx-cancel,
	.tx-save {
		border-radius: 0.38rem;
		padding: 0.22rem 0.6rem;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 700;
		cursor: pointer;
	}

	.tx-remove {
		margin-right: auto;
		border: 1px solid #e0b6b6;
		background: #fdf5f5;
		color: #a5302f;
	}

	.tx-cancel {
		border: 1px solid #d7d0e2;
		background: #ffffff;
		color: #7d7490;
	}

	.tx-save {
		border: 1px solid #a98dba;
		background: #ece8f3;
		color: #4d3a63;
	}

	.tx-remove:disabled,
	.tx-cancel:disabled,
	.tx-save:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
