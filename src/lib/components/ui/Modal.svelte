<script lang="ts">
	export let open = false;
	export let title = '';
	export let onClose: (() => void) | undefined;
	export let placement: 'center' | 'top' = 'center';
</script>

{#if open}
	<div
		class={`fixed inset-0 z-50 flex justify-center px-3 sm:px-4 ${
			placement === 'top'
				? 'items-start overflow-y-auto pt-3 pb-3 sm:pt-6 sm:pb-6'
				: 'items-center'
		}`}
	>
		<div class="absolute inset-0 bg-black/30 backdrop-blur-[2px]" on:click={() => onClose?.()}></div>
		<div class="modal-card">
			<!-- Washi tape decoration -->
			<span class="modal-tape" aria-hidden="true"></span>
			<div class="modal-header flex items-center justify-between gap-3">
				<h2 class="permanent-marker text-base" style="color: var(--marker-black);">{title}</h2>
				<button
					class="typewriter modal-close-btn"
					on:click={() => onClose?.()}
					aria-label="Close modal"
				>
					Close
				</button>
			</div>
			<div class="modal-body">
				<slot />
			</div>
			{#if $$slots.footer}
				<div class="modal-footer">
					<slot name="footer" />
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.modal-card {
		position: relative;
		z-index: 10;
		width: 100%;
		max-width: 42rem;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1.5px solid #c0c8d2;
		border-radius: 0.35rem;
		background: var(--paper, #fffefa);
		padding: 1.2rem;
		box-shadow:
			0 4px 8px rgba(0, 0, 0, 0.08),
			0 12px 28px rgba(0, 0, 0, 0.12);
	}

	/* Subtle lined paper */
	.modal-card::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: repeating-linear-gradient(
			0deg,
			transparent 0,
			transparent 27px,
			rgba(200, 210, 220, 0.06) 27px,
			rgba(200, 210, 220, 0.06) 28px
		);
		pointer-events: none;
	}

	.modal-tape {
		position: absolute;
		top: -0.32rem;
		left: 50%;
		transform: translateX(-50%) rotate(-1.5deg);
		width: 3rem;
		height: 0.65rem;
		background: var(--washi-blue, rgba(147, 197, 235, 0.48));
		border-radius: 0.04rem;
		z-index: 2;
		box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.05);
	}

	.modal-close-btn {
		border: 1.5px solid var(--marker-black, #1a1f28);
		border-radius: 0.18rem;
		padding: 0.25rem 0.65rem;
		font-size: 0.56rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--marker-black, #1a1f28);
		background: rgba(255, 255, 255, 0.7);
		flex-shrink: 0;
	}

	.modal-close-btn:hover {
		background: rgba(255, 248, 220, 0.8);
	}

	.modal-body {
		margin-top: 1rem;
		min-height: 0;
		overflow-y: auto;
	}

	.modal-footer {
		margin-top: 0.7rem;
		padding-top: 0.7rem;
		border-top: 1.5px solid rgba(26, 31, 40, 0.2);
		background: linear-gradient(
			to top,
			rgba(255, 254, 250, 0.98) 72%,
			rgba(255, 254, 250, 0.75) 100%
		);
		flex-shrink: 0;
	}

	@media (max-width: 640px) {
		.modal-card {
			padding: 0.9rem;
			max-height: 85vh;
		}

		.modal-tape {
			width: 2.4rem;
			height: 0.52rem;
		}
	}
</style>
