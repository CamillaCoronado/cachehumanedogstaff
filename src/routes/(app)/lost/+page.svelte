<script lang="ts">
	import { onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { resolveRole, canEditPlaygroups } from '$lib/utils/permissions';
	import type { UserRole } from '$lib/types';
	import LostDogMap from '$lib/components/lostdog/LostDogMap.svelte';
	import { subscribeLostDogs, saveLostDog, setLostDogStatus, parseLostDogJson, type LostDog } from '$lib/data/lostDogs';

	let dogs: LostDog[] = [];
	let loaded = false;
	let loadError = '';
	let selectedId = '';
	let importing = false;
	let importText = '';
	let saving = false;

	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canEdit = canEditPlaygroups(role);
	$: dog = dogs.find((d) => d.id === selectedId) ?? dogs[0];

	onMount(() =>
		subscribeLostDogs(
			(list) => {
				dogs = list;
				loaded = true;
			},
			(e) => {
				loadError = e.message;
				loaded = true;
			}
		)
	);

	async function doImport() {
		let parsed: LostDog;
		try {
			parsed = parseLostDogJson(importText);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not read that.');
			return;
		}
		saving = true;
		try {
			await saveLostDog(parsed);
			selectedId = parsed.id;
			importing = false;
			importText = '';
			toast.success(`Saved ${parsed.name}'s search.`);
		} catch (e) {
			toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			saving = false;
		}
	}

	async function markFound() {
		if (!dog) return;
		try {
			await setLostDogStatus(dog, dog.status === 'found' ? 'missing' : 'found');
		} catch {
			toast.error('Could not update the status.');
		}
	}
</script>

<svelte:head><title>Lost dog search</title></svelte:head>

<div class="page">
	<header>
		<div>
			<h1>{dog ? `${dog.name} search` : 'Lost dog search'}</h1>
			{#if dog}
				<p class="sub">
					{dog.status === 'found' ? 'Found.' : 'Missing.'}
					AirTag pings, sightings and land access from Slack.
					{#if dog.home}The dark house marker is the foster home ({dog.home.address}).{/if}
					{#if dog.updatedAt}Updated {new Date(dog.updatedAt).toLocaleString()}.{/if}
				</p>
			{/if}
		</div>
		<div class="actions">
			{#if dogs.length > 1}
				<select bind:value={selectedId} aria-label="Which dog">
					{#each dogs as d}<option value={d.id}>{d.name}{d.status === 'found' ? ' (found)' : ''}</option>{/each}
				</select>
			{/if}
			{#if canEdit && dog}
				<button type="button" on:click={markFound}>{dog.status === 'found' ? 'Mark missing' : 'Mark found'}</button>
			{/if}
			{#if canEdit}
				<button type="button" on:click={() => (importing = !importing)}>{importing ? 'Cancel' : 'Update data'}</button>
			{/if}
		</div>
	</header>

	{#if importing}
		<div class="import">
			<label for="ld-json">Paste the search JSON. It replaces the record with the same id.</label>
			<textarea id="ld-json" rows="8" bind:value={importText} spellcheck="false"></textarea>
			<button type="button" on:click={doImport} disabled={saving || !importText.trim()}>{saving ? 'Saving…' : 'Save'}</button>
		</div>
	{/if}

	{#if !loaded}
		<p class="empty">Loading…</p>
	{:else if loadError}
		<p class="empty">Couldn't load lost-dog searches: {loadError}</p>
	{:else if !dog}
		<p class="empty">No lost-dog searches yet.{#if canEdit} Use "Update data" to add one.{/if}</p>
	{:else}
		<LostDogMap {dog} />
	{/if}
</div>

<style>
	.page { max-width:1200px; margin:0 auto; padding:16px; }
	header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
	h1 { font-size:1.6rem; font-weight:600; margin:0; }
	.sub { color:#5f6368; margin:.25rem 0 0; max-width:72ch; }
	.actions { display:flex; gap:8px; flex-wrap:wrap; }
	.actions button, .actions select, .import button { border:1px solid #dadce0; background:#fff; color:#202124; border-radius:999px; padding:6px 14px; font-weight:500; cursor:pointer; }
	.import { display:flex; flex-direction:column; gap:8px; margin-bottom:16px; }
	.import textarea { font-family:ui-monospace,Menlo,monospace; font-size:.8rem; border:1px solid #dadce0; border-radius:8px; padding:8px; width:100%; }
	.import button { align-self:flex-start; }
	.empty { color:#5f6368; }
	@media (prefers-color-scheme: dark) {
		.sub, .empty { color:#9aa0a6; }
		.actions button, .actions select, .import button, .import textarea { background:#202124; color:#e8eaed; border-color:#3c4043; }
	}
</style>
