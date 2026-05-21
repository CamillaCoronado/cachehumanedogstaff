<script lang="ts">
	export let open = false;
	export let title = '';
	export let onClose: (() => void) | undefined;
	export let placement: 'center' | 'top' = 'center';

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) node.parentNode.removeChild(node);
			}
		};
	}
</script>

{#if open}
	<div
		class="modal-overlay modal-overlay-{placement}"
		use:portal
		on:click={() => onClose?.()}
	>
		<div class="modal-backdrop"></div>
		<div class="modal-card" on:click|stopPropagation>
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
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 9999;
		display: flex;
		justify-content: center;
		padding: 0.75rem 1rem;
	}

	.modal-overlay-center {
		align-items: center;
	}

	.modal-overlay-top {
		align-items: flex-start;
		overflow-y: auto;
		padding-top: 1.5rem;
		padding-bottom: 1.5rem;
	}

	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.3);
		-webkit-backdrop-filter: blur(2px);
		backdrop-filter: blur(2px);
	}

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
