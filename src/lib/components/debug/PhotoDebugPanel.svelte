<script lang="ts">
	import { photoDebugLog } from '$lib/utils/photoLog';

	let open = false;
	const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
	let copied = false;

	async function copyLog() {
		const lines = $photoDebugLog
			.slice()
			.reverse()
			.map((e) => `${e.time} [${e.event}] ${e.dogName ?? e.dogId ?? '?'} — ${e.detail}`);
		const text = `${ua}\n\n${lines.join('\n')}`;
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}
</script>

<button
	type="button"
	class="photo-debug-toggle"
	on:click={() => (open = !open)}
	aria-label="Toggle photo debug log"
>🐛</button>

{#if open}
	<div class="photo-debug-panel">
		<div class="photo-debug-head">
			<strong>Photo debug log</strong>
			<div class="photo-debug-head-actions">
				<button type="button" on:click={copyLog}>{copied ? 'Copied!' : 'Copy'}</button>
				<button type="button" on:click={() => (open = false)}>✕</button>
			</div>
		</div>
		<p class="photo-debug-ua">{ua}</p>
		<div class="photo-debug-list">
			{#if $photoDebugLog.length === 0}
				<p class="photo-debug-empty">No photo events yet — open a page with dog photos.</p>
			{:else}
				{#each $photoDebugLog as entry}
					<div class="photo-debug-entry photo-debug-{entry.event}">
						<div class="photo-debug-row">
							<span class="photo-debug-time">{entry.time}</span>
							<span class="photo-debug-tag">{entry.event}</span>
							<span class="photo-debug-name">{entry.dogName ?? entry.dogId ?? '?'}</span>
						</div>
						<div class="photo-debug-detail">{entry.detail}</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	.photo-debug-toggle {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		z-index: 9999;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 999px;
		background: #23262b;
		color: #fff;
		border: none;
		font-size: 1.2rem;
		line-height: 1;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
	}

	.photo-debug-panel {
		position: fixed;
		bottom: 4.2rem;
		right: 1rem;
		z-index: 9999;
		width: min(24rem, calc(100vw - 2rem));
		max-height: 70vh;
		display: flex;
		flex-direction: column;
		background: #fff;
		border: 1px solid #d4d9e0;
		border-radius: 0.7rem;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
		overflow: hidden;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}

	.photo-debug-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 0.7rem;
		border-bottom: 1px solid #e6e9ee;
		font-size: 0.78rem;
		background: #f7f8fa;
	}

	.photo-debug-head-actions {
		display: flex;
		gap: 0.4rem;
	}

	.photo-debug-head-actions button {
		font-size: 0.68rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid #ccd2da;
		border-radius: 0.4rem;
		background: #fff;
	}

	.photo-debug-ua {
		margin: 0;
		padding: 0.4rem 0.7rem;
		font-size: 0.62rem;
		color: #6b7280;
		border-bottom: 1px solid #e6e9ee;
		word-break: break-all;
	}

	.photo-debug-list {
		overflow-y: auto;
		padding: 0.4rem 0.7rem;
	}

	.photo-debug-empty {
		font-size: 0.72rem;
		color: #6b7280;
	}

	.photo-debug-entry {
		padding: 0.35rem 0;
		border-bottom: 1px solid #f0f1f3;
	}

	.photo-debug-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.68rem;
	}

	.photo-debug-time {
		color: #9aa1ab;
	}

	.photo-debug-tag {
		text-transform: uppercase;
		font-weight: 700;
		font-size: 0.6rem;
		padding: 0.05rem 0.3rem;
		border-radius: 0.25rem;
		background: #eef1f4;
		color: #4b5563;
	}

	.photo-debug-error .photo-debug-tag {
		background: #fde2e2;
		color: #a12727;
	}

	.photo-debug-loaded .photo-debug-tag {
		background: #dcf3e3;
		color: #1f7a3d;
	}

	.photo-debug-name {
		font-weight: 600;
		color: #2b2f36;
	}

	.photo-debug-detail {
		font-size: 0.66rem;
		color: #4b5563;
		word-break: break-all;
		margin-top: 0.1rem;
	}
</style>
