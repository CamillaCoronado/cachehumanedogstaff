<script lang="ts">
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { resolveRole, canViewInternalDogInfo } from '$lib/utils/permissions';
	import type { UserRole } from '$lib/types';
	import LostDogMap from '$lib/components/lostdog/LostDogMap.svelte';
	import { LOST_DOGS } from '$lib/data/pretzelSearch';

	$: role = resolveRole($authProfile, $localRole as UserRole);
	// Staff only: it has a foster's home address and landowners' addresses.
	$: isStaff = canViewInternalDogInfo(role);

	let selectedId = LOST_DOGS[0]?.id ?? '';
	$: dog = LOST_DOGS.find((d) => d.id === selectedId) ?? LOST_DOGS[0];
</script>

<svelte:head><title>Lost dog search</title></svelte:head>

<div class="page">
	{#if !isStaff}
		<p class="empty">This page is for staff only.</p>
	{:else if !dog}
		<p class="empty">No lost-dog searches.</p>
	{:else}
		<header>
			<div>
				<h1>{dog.name} search</h1>
				<p class="sub">
					{dog.status === 'found' ? 'Found.' : 'Missing.'}
					AirTag pings, sightings and land access from Slack.
					{#if dog.home}The dark house marker is the foster home ({dog.home.address}).{/if}
				</p>
			</div>
			{#if LOST_DOGS.length > 1}
				<select bind:value={selectedId} aria-label="Which dog">
					{#each LOST_DOGS as d}<option value={d.id}>{d.name}</option>{/each}
				</select>
			{/if}
		</header>
		<LostDogMap {dog} />
	{/if}
</div>

<style>
	.page { max-width:1200px; margin:0 auto; padding:16px; }
	header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
	h1 { font-size:1.6rem; font-weight:600; margin:0; }
	.sub { color:#5f6368; margin:.25rem 0 0; max-width:72ch; }
	select { border:1px solid #dadce0; background:#fff; color:#202124; border-radius:999px; padding:6px 14px; }
	.empty { color:#5f6368; }
	@media (prefers-color-scheme: dark) {
		.sub, .empty { color:#9aa0a6; }
		select { background:#202124; color:#e8eaed; border-color:#3c4043; }
	}
</style>
