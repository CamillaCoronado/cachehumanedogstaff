<div class="auth-shell">
	<div class="auth-surface">
		<slot />
	</div>
</div>

<style>
	.auth-shell {
		min-height: 100vh;
		padding: 1.1rem 0.8rem;
		display: grid;
		place-items: center;
		background:
			linear-gradient(180deg, #dde4ec 0%, #ced7e1 45%, #c6ced8 100%);
	}

	.auth-surface {
		position: relative;
		width: min(100%, 30rem);
	}

	@media (min-width: 640px) {
		.auth-shell {
			padding: 1.6rem;
		}
	}
</style>
