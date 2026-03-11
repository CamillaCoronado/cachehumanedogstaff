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
			radial-gradient(60rem 28rem at 0% -20%, rgba(1, 107, 165, 0.08) 0%, transparent 62%),
			linear-gradient(180deg, #f5f8fc 0%, #edf3f9 100%);
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
