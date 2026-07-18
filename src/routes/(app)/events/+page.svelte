<script lang="ts">
	import EventCounterCard from '$lib/components/events/EventCounterCard.svelte';
</script>

<svelte:head>
	<title>Events — Cache Humane Society</title>
</svelte:head>

<div class="events-page">
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
	}
</style>
