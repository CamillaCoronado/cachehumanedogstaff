<script lang="ts">
	import { dev } from '$app/environment';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';

	injectAnalytics({ mode: dev ? 'development' : 'production' });
	import { authReady, authUser, authProfile, initAuthListener } from '$lib/stores/auth';
	import { signOutUser } from '$lib/firebase/auth';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { normalizeText } from '$lib/utils/labels';
	import { syncAnimalsFromASM, type SyncChange } from '$lib/data/asm-sync';

	type TabItem = {
		href: string;
		label: string;
		colorClass: string;
		icon:
			| 'dashboard'
			| 'dogs'
			| 'kennels'
			| 'feeding'
			| 'cleaning'
			| 'daytrips'
			| 'playgroups'
			| 'intake';
	};

	const tabs: TabItem[] = [
		{ href: '/', label: 'Dashboard', colorClass: 'tab-blue', icon: 'dashboard' },
		{ href: '/dogs', label: 'Dogs', colorClass: 'tab-accent', icon: 'dogs' },
		{ href: '/kennels', label: 'Kennels', colorClass: 'tab-green', icon: 'kennels' },
		{ href: '/feeding', label: 'Feeding', colorClass: 'tab-blue', icon: 'feeding' },
		{ href: '/cleaning', label: 'Cleaning', colorClass: 'tab-green', icon: 'cleaning' },
		{ href: '/daytrips', label: 'Day Trips', colorClass: 'tab-accent', icon: 'daytrips' },
		{ href: '/playgroups', label: 'Playgroups', colorClass: 'tab-blue', icon: 'playgroups' },
		{ href: '/intake', label: 'AI Intake', colorClass: 'tab-accent', icon: 'intake' }
	];

	let loggingOut = false;
	let previousTabIndex = 0;
	let turnDirection: 'forward' | 'backward' = 'forward';
	let mobileNavOpen = false;
	let asmAttempted = false;
	let asmSyncing = false;
	let asmSyncedAt: string | null = null;
	let asmError: string | null = null;
	let asmChanges: SyncChange[] = [];
	let asmLogVisible = false;
	let asmLogTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		initAuthListener();
		previousTabIndex = resolveTabIndex(window.location.pathname);
	});

	$: if ($authReady && !$authUser) {
		goto('/login');
	}

	$: if ($authReady && $authUser && !asmAttempted) {
		asmAttempted = true;
		asmSyncing = true;
		void syncAnimalsFromASM()
			.then((result) => {
				asmSyncedAt = new Intl.DateTimeFormat('en-US', {
					hour: 'numeric',
					minute: '2-digit',
					hour12: true
				}).format(new Date());
				if (result.changes.length > 0 || result.archived > 0) {
					asmChanges = result.changes;
					asmLogVisible = true;
					if (asmLogTimer) clearTimeout(asmLogTimer);
					asmLogTimer = setTimeout(() => { asmLogVisible = false; }, 15000);
				}
			})
			.catch((err: unknown) => {
				asmError = err instanceof Error ? err.message : 'Sync failed';
				console.error('[ASM sync]', asmError);
			})
			.finally(() => {
				asmSyncing = false;
			});
	}

	$: currentPath = $page.url.pathname;
	$: currentTabIndex = resolveTabIndex(currentPath);
	$: activeTab = tabs[currentTabIndex] ?? tabs.find((tab) => tab.href === '/') ?? tabs[0];
	$: isDogDetailPage = currentPath.startsWith('/dogs/');
	$: if (currentPath) {
		mobileNavOpen = false;
	}
	$: isDashboardPage = activeTab.href === '/';
	$: todayLabel = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date());
	$: shiftLabel = new Date().getHours() < 12 ? 'AM Shift' : 'PM Shift';
	$: profileName = normalizeText($authProfile?.displayName) ?? normalizeText($authUser?.email) ?? 'Staff Member';
	$: profileRole = normalizeText($authProfile?.role)?.toUpperCase() ?? 'STAFF';
	$: profileInitial = profileName.trim().charAt(0).toUpperCase() || 'S';
	$: if ($authReady) {
		if (currentTabIndex > previousTabIndex) {
			turnDirection = 'forward';
		} else if (currentTabIndex < previousTabIndex) {
			turnDirection = 'backward';
		}
		previousTabIndex = currentTabIndex;
	}

	function resolveTabIndex(pathname: string) {
		const direct = tabs.findIndex(
			(tab) => pathname === tab.href || (tab.href !== '/' && pathname.startsWith(`${tab.href}/`))
		);
		if (direct !== -1) return direct;
		return tabs.findIndex((tab) => tab.href === '/');
	}

	async function handleLogout() {
		loggingOut = true;
		try {
			await signOutUser();
			await goto('/login');
		} finally {
			loggingOut = false;
		}
	}

	function toggleMobileNav() {
		mobileNavOpen = !mobileNavOpen;
	}

	function closeMobileNav() {
		mobileNavOpen = false;
	}
</script>

{#if !$authReady || !$authUser}
	<div class="shelter-shell">
		<div class="shell-wrap loading-wrap">
			<div class="loading-note">
				<p class="loading-note-tag typewriter">Cache Humane Society</p>
				<p class="loading-note-text whiteboard-hand erase-marker-blue">
					{#if $authReady && firebaseEnabled && !$authUser}
						Redirecting to sign-in...
					{:else}
						Preparing your workspace...
					{/if}
				</p>
			</div>
		</div>
	</div>
{:else}
	<div class="shelter-shell">
		<div class="shell-wrap">
			<div class="app-surface">
				<header class="app-topbar">
					<div class="topbar-main">
						<button
							class={`mobile-menu-btn ${mobileNavOpen ? 'mobile-menu-btn-open' : ''}`}
							type="button"
							aria-expanded={mobileNavOpen}
							aria-controls="primary-tabs"
							aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
							on:click={toggleMobileNav}
						>
							<span class="mobile-menu-icon" aria-hidden="true">
								<span></span>
								<span></span>
								<span></span>
							</span>
						</button>
						<div class="topbar-title">
							{#if !isDogDetailPage}
								<h1 class="board-title">{activeTab.label}</h1>
							{/if}
						</div>
						{#if asmSyncing}
							<span class="sync-badge sync-badge-loading" title="Syncing dogs from ASM…">
								<svg class="sync-spinner" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="10"/></svg>
								<span class="sync-label">Syncing</span>
							</span>
						{:else if asmSyncedAt}
							<button
								class="sync-badge sync-badge-done {asmChanges.length > 0 ? 'sync-badge-clickable' : ''}"
								title={asmChanges.length > 0 ? 'Click to view changes' : 'Dogs synced from ASM'}
								on:click={() => { if (asmChanges.length > 0) asmLogVisible = !asmLogVisible; }}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.5 3.5 6.5-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
								<span class="sync-label">Synced {asmSyncedAt}{asmChanges.length > 0 ? ` · ${asmChanges.length} change${asmChanges.length !== 1 ? 's' : ''}` : ''}</span>
							</button>
						{:else if asmError}
							<span class="sync-badge sync-badge-error">
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v5M8 11v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
								<span class="sync-label">Sync failed</span>
							</span>
						{/if}
					</div>
					<div class="topbar-meta">
						<p class="board-meta whiteboard-hand erase-marker-blue">{todayLabel} {shiftLabel}</p>
						<div class="header-lead">
							<button
								class="account-icon-btn"
								on:click={handleLogout}
								disabled={loggingOut}
								aria-label={loggingOut ? 'Signing out' : 'Sign out'}
								title={loggingOut ? 'Signing out...' : 'Sign out'}
							>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path
										d="M12 12c2.39 0 4.3-1.93 4.3-4.3S14.39 3.4 12 3.4 7.7 5.31 7.7 7.7 9.61 12 12 12Zm0 2.2c-3.58 0-6.8 1.61-6.8 3.6v2h13.6v-2c0-1.99-3.22-3.6-6.8-3.6Z"
									/>
								</svg>
							</button>
							<div class="lead-text">
								<p class="lead-name whiteboard-hand erase-marker-blue">{profileName}</p>
								<p class="lead-role permanent-marker">{profileRole}</p>
							</div>
						</div>
					</div>
				</header>

				{#if asmLogVisible && asmChanges.length > 0}
					<div class="sync-log" role="log" aria-live="polite">
						<div class="sync-log-header">
							<span class="sync-log-title">ASM Sync — {asmChanges.length} dog{asmChanges.length !== 1 ? 's' : ''} updated</span>
							<button class="sync-log-close" aria-label="Dismiss" on:click={() => { asmLogVisible = false; }}>
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
							</button>
						</div>
						<ul class="sync-log-list">
							{#each asmChanges as change}
								<li class="sync-log-item">
									<span class="sync-log-name">{change.name}</span>
									{#if change.isNew}
										<span class="sync-log-tag sync-log-tag-new">New</span>
									{:else}
										<span class="sync-log-fields">{change.fields.join(', ')}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<div class="app-layout">
					<nav id="primary-tabs" class={`tab-strip ${mobileNavOpen ? 'tab-strip-open' : ''}`} aria-label="Primary">
						<div class="menu-brand" aria-hidden="true">
							<span class="menu-brand-initial">{profileInitial}</span>
						</div>
						{#each tabs as tab, index}
							<a
								class={`board-tab ${tab.colorClass} ${currentTabIndex === index ? 'tab-active' : ''}`}
								href={tab.href}
								aria-current={currentTabIndex === index ? 'page' : undefined}
								on:click={closeMobileNav}
							>
								<span class="tab-icon-shell" aria-hidden="true">
									<svg class="tab-icon" viewBox="0 0 24 24" fill="none">
										{#if tab.icon === 'dashboard'}
											<rect x="4" y="4" width="7" height="7" rx="1.5"></rect>
											<rect x="13" y="4" width="7" height="7" rx="1.5"></rect>
											<rect x="4" y="13" width="7" height="7" rx="1.5"></rect>
											<rect x="13" y="13" width="7" height="7" rx="1.5"></rect>
										{:else if tab.icon === 'dogs'}
											<circle cx="7.5" cy="8.3" r="1.5"></circle>
											<circle cx="12" cy="6.8" r="1.5"></circle>
											<circle cx="16.5" cy="8.3" r="1.5"></circle>
											<path d="M8.5 16.9c0-2 1.6-3.6 3.5-3.6s3.5 1.6 3.5 3.6c0 1.4-1 2.6-3.5 2.6s-3.5-1.2-3.5-2.6Z"></path>
										{:else if tab.icon === 'kennels'}
											<path d="M4 10.6 12 4l8 6.6v8.2a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 18.8v-8.2Z"></path>
											<path d="M10.2 20v-5.5h3.6V20"></path>
										{:else if tab.icon === 'feeding'}
											<path d="M4 11h16"></path>
											<path d="M6.3 11c.4 3.9 2.6 6 5.7 6s5.3-2.1 5.7-6"></path>
											<path d="M12 7v2"></path>
										{:else if tab.icon === 'cleaning'}
											<path d="M6 8h12"></path>
											<path d="M7.5 8v6.6a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3V8"></path>
											<path d="M9 5h6"></path>
										{:else if tab.icon === 'daytrips'}
											<path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2z"></path>
											<path d="M9 4v14"></path>
											<path d="M15 6v14"></path>
										{:else if tab.icon === 'playgroups'}
											<circle cx="9" cy="9" r="2.4"></circle>
											<circle cx="16" cy="10.2" r="2"></circle>
											<path d="M4.7 18c.6-2.2 2.5-3.7 4.3-3.7s3.7 1.5 4.3 3.7"></path>
											<path d="M14.4 17.5c.4-1.6 1.8-2.7 3.3-2.7 1.2 0 2.2.6 2.9 1.7"></path>
										{:else}
											<rect x="6" y="4.5" width="12" height="15" rx="2"></rect>
											<path d="M9 4.5h6v2H9z"></path>
											<path d="M9.6 11.3h4.8"></path>
											<path d="M9.6 14.6h4.8"></path>
											<path d="m17.5 8.8.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"></path>
										{/if}
									</svg>
								</span>
								<span class="tab-content">
									<span class="tab-name whiteboard-hand">{tab.label}</span>
								</span>
							</a>
						{/each}
						<div class="menu-account">
							<p class="menu-account-name whiteboard-hand erase-marker-blue">{profileName}</p>
							<p class="menu-account-role typewriter">{profileRole}</p>
							<button
								type="button"
								class="menu-auth-btn typewriter"
								on:click={() => {
									closeMobileNav();
									void handleLogout();
								}}
								disabled={loggingOut}
							>
								<span class="menu-auth-icon" aria-hidden="true">
									<svg class="tab-icon" viewBox="0 0 24 24" fill="none">
										<circle cx="12" cy="12" r="3.2"></circle>
										<path d="m12 4.6.8 1.8 2 .3.5 2 .4-.3 1.7 1.7-.3.4 1.9.5v2.2l-1.9.5.3.4-1.7 1.7-.4-.3-.5 2-2 .3-.8 1.8h-2.2l-.8-1.8-2-.3-.5-2-.4.3-1.7-1.7.3-.4-1.9-.5v-2.2l1.9-.5-.3-.4 1.7-1.7.4.3.5-2 2-.3.8-1.8z"></path>
									</svg>
								</span>
								<span class="menu-auth-label">{loggingOut ? 'Signing out...' : 'Log out'}</span>
							</button>
						</div>
					</nav>

					<div class="board-workspace">
						<div class="page-stage">
							{#key currentPath}
								<div
									class={`page-paper ${turnDirection === 'forward' ? 'page-turn-forward' : 'page-turn-backward'} ${isDashboardPage ? 'page-paper-dashboard' : ''}`}
								>
									<slot />
								</div>
							{/key}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.shelter-shell {
		--layout-primary: #016ba5;
		--layout-success: #3baf2b;
		--layout-accent: #933980;
		--layout-ink: #133149;
		--layout-muted: #526b81;
		--layout-border: #d1dfec;
		min-height: 100vh;
		background:
			radial-gradient(65rem 30rem at -10% -20%, rgba(1, 107, 165, 0.16) 0%, transparent 62%),
			radial-gradient(55rem 28rem at 110% -20%, rgba(147, 57, 128, 0.14) 0%, transparent 58%),
			linear-gradient(180deg, #f5f8fc 0%, #eaf0f7 100%);
	}

	.shell-wrap {
		width: min(100%, 1240px);
		margin: 0 auto;
		padding: 0;
	}

	.loading-wrap {
		min-height: 100vh;
		display: grid;
		place-items: center;
	}

	.loading-note {
		position: relative;
		border: 1px solid var(--layout-border);
		background: rgba(255, 255, 255, 0.92);
		padding: 1.6rem 1.5rem 1.3rem;
		border-radius: 0.95rem;
		box-shadow:
			0 14px 36px rgba(15, 40, 63, 0.16),
			0 1px 0 rgba(255, 255, 255, 0.8) inset;
		text-align: center;
		max-width: 24rem;
	}

	.loading-note-tag {
		font-size: 0.63rem;
		font-family: var(--font-typewriter);
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--layout-muted);
	}

	.loading-note-text {
		margin-top: 0.55rem;
		font-family: var(--font-ui);
		font-size: 1.06rem;
		color: var(--layout-primary);
	}

	.app-surface {
		border: 0;
		border-radius: 1.05rem;
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 20px 44px rgba(14, 38, 61, 0.14);
		overflow: hidden;
	}

	.app-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.78rem 0.85rem;
		border-bottom: 1px solid #d6e2ee;
		background: rgba(255, 255, 255, 0.94);
	}

	.topbar-main {
		display: flex;
		align-items: center;
		gap: 0.58rem;
		min-width: 0;
	}

	.topbar-title {
		display: grid;
		gap: 0.12rem;
		min-width: 0;
	}

	.board-eyebrow {
		margin: 0;
		font-family: var(--font-typewriter);
		font-size: 0.5rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--layout-muted);
	}

	.board-title {
		margin: 0;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: clamp(1.2rem, 4.8vw, 1.7rem);
		line-height: 1.02;
		letter-spacing: -0.01em;
		color: var(--layout-ink);
	}

	.topbar-meta {
		display: flex;
		align-items: center;
		gap: 0.68rem;
	}

	.sync-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.18rem 0.48rem 0.18rem 0.32rem;
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 0.65rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.sync-badge svg {
		width: 0.78rem;
		height: 0.78rem;
		flex-shrink: 0;
	}

	.sync-badge-loading {
		background: rgba(1, 107, 165, 0.09);
		color: var(--layout-primary);
		border: 1px solid rgba(1, 107, 165, 0.2);
	}

	.sync-badge-done {
		background: rgba(59, 175, 43, 0.1);
		color: #2a8c1a;
		border: 1px solid rgba(59, 175, 43, 0.22);
	}

	.sync-badge-error {
		background: rgba(200, 50, 30, 0.08);
		color: #b83220;
		border: 1px solid rgba(200, 50, 30, 0.22);
	}

	.sync-badge-clickable {
		cursor: pointer;
	}

	.sync-badge-clickable:hover {
		background: rgba(59, 175, 43, 0.18);
	}

	.sync-spinner {
		animation: spin 900ms linear infinite;
		transform-origin: center;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.sync-log {
		position: fixed;
		top: 3.8rem;
		right: 0.85rem;
		z-index: 30;
		width: min(22rem, calc(100vw - 1.4rem));
		background: rgba(255, 255, 255, 0.98);
		border: 1px solid #c8d8e8;
		border-radius: 0.85rem;
		box-shadow: 0 12px 32px rgba(12, 34, 55, 0.18);
		overflow: hidden;
		animation: logSlideIn 160ms ease-out;
	}

	@keyframes logSlideIn {
		from { opacity: 0; transform: translateY(-6px); }
		to   { opacity: 1; transform: translateY(0); }
	}

	.sync-log-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 0.7rem 0.5rem;
		border-bottom: 1px solid #dce8f2;
		background: rgba(59, 175, 43, 0.07);
	}

	.sync-log-title {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 700;
		color: #1e6b15;
	}

	.sync-log-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.3rem;
		height: 1.3rem;
		border: 0;
		border-radius: 0.36rem;
		background: transparent;
		color: #6a8090;
		flex-shrink: 0;
	}

	.sync-log-close:hover {
		background: rgba(0,0,0,0.06);
	}

	.sync-log-close svg {
		width: 0.72rem;
		height: 0.72rem;
	}

	.sync-log-list {
		margin: 0;
		padding: 0.38rem 0;
		list-style: none;
		max-height: 16rem;
		overflow-y: auto;
	}

	.sync-log-item {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.28rem 0.7rem;
		font-family: var(--font-ui);
		font-size: 0.7rem;
	}

	.sync-log-item:not(:last-child) {
		border-bottom: 1px solid #edf3f8;
	}

	.sync-log-name {
		font-weight: 700;
		color: var(--layout-ink);
		flex-shrink: 0;
	}

	.sync-log-tag-new {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.1rem 0.38rem;
		border-radius: 999px;
		background: rgba(1, 107, 165, 0.1);
		color: var(--layout-primary);
		border: 1px solid rgba(1, 107, 165, 0.2);
	}

	.sync-log-fields {
		color: var(--layout-muted);
		font-size: 0.67rem;
		min-width: 0;
	}

	.board-meta {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--layout-primary);
		text-shadow: none;
	}

	.header-lead {
		border: 1px solid #d2deea;
		border-radius: 0.76rem;
		padding: 0.3rem 0.38rem;
		background: rgba(255, 255, 255, 0.95);
		display: flex;
		align-items: center;
		gap: 0.38rem;
		box-shadow: 0 6px 16px rgba(15, 38, 59, 0.12);
	}

	.lead-text {
		display: grid;
		gap: 0.08rem;
		min-width: 0;
	}

	.lead-name {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1.1;
		max-width: 9rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--layout-ink);
		text-shadow: none;
	}

	.lead-role {
		margin: 0;
		font-family: var(--font-typewriter);
		font-size: 0.48rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--layout-muted);
	}

	.account-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.8rem;
		height: 1.8rem;
		border: 1px solid #bacee1;
		border-radius: 0.54rem;
		background: linear-gradient(180deg, #eff6fd 0%, #e2eef9 100%);
		color: var(--layout-primary);
		flex-shrink: 0;
	}

	.account-icon-btn svg {
		width: 0.94rem;
		height: 0.94rem;
		fill: currentColor;
	}

	.app-layout {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		min-height: calc(100vh - 7rem);
	}

	.mobile-menu-btn {
		width: 2.2rem;
		height: 2.2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid #bed0e0;
		border-radius: 0.66rem;
		background: #ffffff;
		box-shadow: 0 8px 18px rgba(16, 36, 56, 0.16);
	}

	.mobile-menu-icon {
		position: relative;
		width: 1rem;
		height: 0.82rem;
		flex-shrink: 0;
	}

	.mobile-menu-icon span {
		position: absolute;
		left: 0;
		top: 50%;
		width: 1rem;
		height: 1.8px;
		background: var(--layout-primary);
		border-radius: 999px;
		transition: transform 160ms ease, opacity 160ms ease;
		transform-origin: center;
	}

	.mobile-menu-icon span:nth-child(1) {
		transform: translateY(calc(-50% - 4px));
	}

	.mobile-menu-icon span:nth-child(2) {
		transform: translateY(-50%);
	}

	.mobile-menu-icon span:nth-child(3) {
		transform: translateY(calc(-50% + 4px));
	}

	.mobile-menu-btn.mobile-menu-btn-open .mobile-menu-icon span:nth-child(1) {
		transform: translateY(-50%) rotate(45deg);
	}

	.mobile-menu-btn.mobile-menu-btn-open .mobile-menu-icon span:nth-child(2) {
		opacity: 0;
	}

	.mobile-menu-btn.mobile-menu-btn-open .mobile-menu-icon span:nth-child(3) {
		transform: translateY(-50%) rotate(-45deg);
	}

	.tab-strip {
		display: none;
	}

	.menu-brand {
		display: none;
	}

	.tab-strip.tab-strip-open {
		position: absolute;
		top: 0.7rem;
		left: 0.7rem;
		right: 0.7rem;
		display: grid;
		gap: 0.36rem;
		padding: 0.5rem;
		border: 1px solid #c8d8e8;
		border-radius: 0.85rem;
		background: rgba(247, 251, 255, 0.98);
		box-shadow: 0 18px 34px rgba(12, 34, 55, 0.2);
		z-index: 20;
	}

	.board-tab {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.28rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid #cad7e5;
		border-radius: 0.68rem;
		font-weight: 700;
		color: var(--layout-ink);
		background: #ffffff;
		text-decoration: none;
	}

	.tab-active {
		border-color: color-mix(in srgb, var(--tab-accent, var(--layout-primary)) 42%, #ffffff);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--tab-accent, var(--layout-primary)) 18%, transparent);
	}

	.tab-icon-shell {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		flex-shrink: 0;
		border: 1px solid color-mix(in srgb, var(--tab-accent, var(--layout-primary)) 22%, #d2dfed);
		border-radius: 0.48rem;
		background: color-mix(in srgb, var(--tab-accent, var(--layout-primary)) 8%, #ffffff);
		color: color-mix(in srgb, var(--tab-accent, var(--layout-primary)) 76%, #274763);
	}

	.tab-icon {
		width: 0.88rem;
		height: 0.88rem;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.tab-active .tab-icon-shell {
		border-color: color-mix(in srgb, var(--tab-accent, var(--layout-primary)) 38%, #d2dfed);
		background: color-mix(in srgb, var(--tab-accent, var(--layout-primary)) 16%, #ffffff);
		color: color-mix(in srgb, var(--tab-accent, var(--layout-primary)) 90%, #274763);
	}

	.tab-content {
		display: inline-flex;
		align-items: center;
		line-height: 1;
		min-width: 0;
	}

	.tab-name {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--layout-ink);
		white-space: nowrap;
		text-shadow: none;
	}

	.tab-blue {
		--tab-accent: var(--layout-primary);
	}

	.tab-green {
		--tab-accent: var(--layout-success);
	}

	.tab-accent {
		--tab-accent: var(--layout-accent);
	}

	.menu-account {
		display: grid;
		gap: 0.3rem;
		margin-top: 0.16rem;
		padding: 0.58rem 0.16rem 0.1rem;
		border-top: 1px solid #d2deea;
	}

	.menu-account-name {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.84rem;
		font-weight: 700;
		line-height: 1.15;
		color: var(--layout-ink);
		text-shadow: none;
	}

	.menu-account-role {
		margin: 0;
		font-family: var(--font-typewriter);
		font-size: 0.48rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--layout-muted);
	}

	.menu-auth-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.1rem;
		padding: 0.34rem 0.56rem;
		border: 1px solid #c4d6e8;
		border-radius: 0.65rem;
		background: linear-gradient(180deg, #f4f9ff 0%, #edf4fb 100%);
		color: var(--layout-primary);
		font-size: 0.58rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-align: left;
	}

	.menu-auth-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.16rem;
		height: 1.16rem;
		flex-shrink: 0;
		color: currentColor;
	}

	.menu-auth-label {
		display: inline-flex;
		align-items: center;
	}

	.board-workspace {
		padding: 0.7rem;
	}

	.page-stage {
		min-height: 15rem;
		width: 100%;
		max-width: 100vw;
	}

	.page-paper {
		position: relative;
		will-change: transform, opacity;
		width: 100%;
		max-width: 100vw;
		min-width: 0;
		overflow-x: clip;
	}

	.page-paper.page-paper-dashboard {
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
	}

	.page-turn-forward {
		animation: pageTurnForward 240ms ease-out;
	}

	.page-turn-backward {
		animation: pageTurnBackward 240ms ease-out;
	}

	@keyframes pageTurnForward {
		0% {
			opacity: 0;
			transform: translateY(10px);
		}
		100% {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes pageTurnBackward {
		0% {
			opacity: 0;
			transform: translateY(10px);
		}
		100% {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 959px) {
		.topbar-meta {
			display: none;
		}
	}

	@media (min-width: 960px) {
		.mobile-menu-btn {
			display: none;
		}

		.app-layout {
			grid-template-columns: 4.7rem minmax(0, 1fr);
		}

		.tab-strip {
			display: flex;
			flex-direction: column;
			gap: 0.18rem;
			padding: 0.4rem 0.28rem;
			border-right: 1px solid #d6dee8;
			background: linear-gradient(180deg, #ecf2f9 0%, #e9f0f8 100%);
		}

		.tab-strip.tab-strip-open {
			position: static;
			box-shadow: none;
			border: 0;
			border-right: 1px solid #d6dee8;
			border-radius: 0;
			padding: 0.4rem 0.28rem;
			left: auto;
			right: auto;
			top: auto;
		}

		.menu-account {
			display: grid;
			gap: 0.18rem;
			margin-top: auto;
			padding: 0.2rem 0 0;
			border-top: 0;
		}

		.menu-brand {
			display: grid;
			place-items: center;
			min-height: 2.38rem;
			margin-bottom: 0.18rem;
			border: 1px solid #d7e2ed;
			border-radius: 0.62rem;
			background: #f8fbfe;
			box-shadow:
				0 1px 0 rgba(255, 255, 255, 0.95) inset,
				0 6px 12px rgba(31, 53, 76, 0.04);
		}

		.menu-brand-initial {
			font-family: 'Georgia', 'Times New Roman', serif;
			font-size: 1.08rem;
			line-height: 1;
			color: #95a1ae;
		}

		.tab-strip .board-tab {
			display: grid;
			justify-items: center;
			align-content: center;
			gap: 0.18rem;
			min-height: 3.15rem;
			padding: 0.25rem 0.12rem;
			border: 1px solid transparent;
			border-radius: 0.62rem;
			background: transparent;
			color: #5e6773;
		}

		.tab-strip .board-tab.tab-active {
			border-color: #d4dee9;
			background: #f8fbff;
			box-shadow: 0 2px 4px rgba(31, 53, 76, 0.06);
		}

		.tab-strip .tab-icon-shell {
			width: 1.28rem;
			height: 1.28rem;
			border: 0;
			border-radius: 0;
			background: transparent;
			color: #5e6773;
		}

		.tab-strip .board-tab.tab-active .tab-icon-shell {
			border: 0;
			background: transparent;
			color: #3f4b58;
		}

		.tab-strip .tab-icon {
			width: 0.98rem;
			height: 0.98rem;
			stroke-width: 1.8;
		}

		.tab-strip .tab-content {
			display: grid;
			justify-items: center;
			width: 100%;
		}

		.tab-strip .tab-name {
			font-size: 0.56rem;
			font-weight: 600;
			line-height: 1.05;
			text-align: center;
			white-space: normal;
			color: #5e6773;
		}

		.tab-strip .board-tab.tab-active .tab-name {
			color: #3f4b58;
			font-weight: 700;
		}

		.tab-strip .menu-account-name,
		.tab-strip .menu-account-role {
			display: none;
		}

		.tab-strip .menu-auth-btn {
			display: grid;
			justify-items: center;
			align-content: center;
			gap: 0.18rem;
			min-height: 3.15rem;
			padding: 0.24rem 0.12rem;
			border: 1px solid transparent;
			border-radius: 0.62rem;
			background: transparent;
			color: #5e6773;
			font-family: var(--font-ui);
			font-size: 0.56rem;
			font-weight: 600;
			letter-spacing: 0;
			line-height: 1.05;
			text-transform: none;
			text-align: center;
		}

		.tab-strip .menu-auth-btn:disabled {
			opacity: 0.7;
		}

		.tab-strip .menu-auth-icon {
			width: 1.28rem;
			height: 1.28rem;
		}

		.board-workspace {
			padding: 0.85rem;
		}
	}
</style>
