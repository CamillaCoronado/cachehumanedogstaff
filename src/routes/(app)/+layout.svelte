<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authReady, authUser, authProfile, initAuthListener } from '$lib/stores/auth';
	import { signOutUser } from '$lib/firebase/auth';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { normalizeText } from '$lib/utils/labels';

	type TabItem = {
		href: string;
		number?: string;
		label: string;
		colorClass: string;
	};

	const tabs: TabItem[] = [
		{ href: '/', number: '1', label: 'Dashboard', colorClass: 'tab-white' },
		{ href: '/dogs', number: '2', label: 'Dogs', colorClass: 'tab-white' },
		{ href: '/kennels', number: '3', label: 'Kennels', colorClass: 'tab-white' },
		{ href: '/feeding', number: '4', label: 'Feeding', colorClass: 'tab-white' },
		{ href: '/cleaning', number: '5', label: 'Cleaning', colorClass: 'tab-white' },
		{ href: '/daytrips', number: '6', label: 'Day Trips', colorClass: 'tab-white' },
		{ href: '/playgroups', number: '7', label: 'Playgroups', colorClass: 'tab-white' },
		{ href: '/intake', number: '8', label: 'AI Intake', colorClass: 'tab-white' }
	];

	let loggingOut = false;
	let previousTabIndex = 0;
	let turnDirection: 'forward' | 'backward' = 'forward';
	let mobileNavOpen = false;

	onMount(() => {
		initAuthListener();
		previousTabIndex = resolveTabIndex(window.location.pathname);
	});

	$: if ($authReady && !$authUser && firebaseEnabled) {
		goto('/login');
	}

	$: currentPath = $page.url.pathname;
	$: currentTabIndex = resolveTabIndex(currentPath);
	$: activeTab = tabs[currentTabIndex] ?? tabs.find((tab) => tab.href === '/') ?? tabs[0];
	$: if (currentPath) {
		mobileNavOpen = false;
	}
	$: isDashboardPage = activeTab.href === '/';
	$: hideHeaderDivider =
		activeTab.href === '/feeding' || activeTab.href === '/dogs' || activeTab.href === '/kennels';
	$: todayLabel = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date());
	$: shiftLabel = new Date().getHours() < 12 ? 'AM Shift' : 'PM Shift';
	$: profileName = normalizeText($authProfile?.displayName) ?? normalizeText($authUser?.email) ?? 'Staff Member';
	$: profileRole = normalizeText($authProfile?.role)?.toUpperCase() ?? 'STAFF';
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

{#if !$authReady || (firebaseEnabled && !$authUser)}
		<div class="shelter-shell">
			<div class="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6">
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
	<div class="shelter-shell pb-8">
		<div class="mx-auto w-full max-w-6xl px-3 pt-4 sm:px-6 sm:pt-5">
			<!-- Whiteboard frame -->
			<div class="whiteboard-frame">
				<!-- Aluminum tray at bottom of whiteboard -->
				<div class="whiteboard-surface">

					{#if !isDashboardPage}
						<!-- Header strip - permanent marker on whiteboard -->
						<div class={`header-strip ${hideHeaderDivider ? 'header-strip-no-divider' : ''}`}>
							<div class="header-main">
								<h1 class="board-title">{activeTab.label}</h1>
								<p class="board-meta whiteboard-hand erase-marker-blue">{todayLabel} {shiftLabel}</p>
							</div>
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
					{/if}

					<div class="mobile-nav-row">
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
					</div>

					<!-- Tab navigation - like labeled cardstock divider tabs -->
					<nav
						id="primary-tabs"
						class={`tab-strip ${isDashboardPage ? 'tab-strip-dashboard' : ''} ${mobileNavOpen ? 'tab-strip-open' : ''}`}
						aria-label="Primary"
					>
						{#each tabs as tab, index}
							<a
								class={`board-tab ${tab.colorClass} ${currentTabIndex === index ? 'tab-active' : ''}`}
								href={tab.href}
								aria-current={currentTabIndex === index ? 'page' : undefined}
								on:click={closeMobileNav}
							>
								<span class="tab-color-mark"></span>
								<span class="tab-content">
									{#if tab.number}
										<span class="tab-num typewriter">{tab.number}</span>
									{/if}
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
								{loggingOut ? 'Signing out...' : 'Log out'}
							</button>
						</div>
					</nav>

					<!-- Main workspace area -->
					<div class="board-workspace">
						<!-- Page content area - looks like printed paper taped to board -->
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
		min-height: 100vh;
		background: linear-gradient(180deg, #dde4ec 0%, #d0d8e1 34%, #c6ced8 100%);
	}

	.loading-note {
		position: relative;
		border: 2px solid var(--marker-black);
		background: var(--paper);
		padding: 1.55rem 1.5rem 1.2rem;
		border-radius: 0.5rem;
		box-shadow:
			0 8px 12px rgba(0, 0, 0, 0.1),
			0 20px 26px rgba(0, 0, 0, 0.14);
		text-align: center;
		max-width: 24rem;
	}

	.loading-note-tag {
		font-size: 0.68rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--ink-main);
	}

	.loading-note-text {
		margin-top: 0.45rem;
		font-size: 1.1rem;
	}

	.whiteboard-frame {
		position: relative;
		border-radius: 0.35rem;
	}

	.whiteboard-surface {
		position: relative;
		border-radius: 0.35rem;
		padding: 0.72rem 0.62rem 0.82rem;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(247, 250, 253, 0.92) 100%),
			#f5f7f9;
	}

	.whiteboard-surface::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background:
			linear-gradient(166deg, rgba(255, 255, 255, 0.45) 0%, transparent 42%),
			repeating-linear-gradient(
				90deg,
				transparent 0,
				transparent 199px,
				rgba(206, 214, 223, 0.03) 199px,
				rgba(206, 214, 223, 0.03) 200px
			);
		pointer-events: none;
	}

	.header-strip {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		gap: 0.44rem;
		padding: 0.5rem 0.54rem 0.42rem;
		border-bottom: 4px solid var(--marker-black);
	}

	.header-strip.header-strip-no-divider {
		border-bottom: 0;
	}

	.header-main {
		display: grid;
		gap: 0.12rem;
	}

	.board-title {
		margin: 0;
		font-family: var(--font-printed);
		font-weight: 400;
		font-size: clamp(1.52rem, 8vw, 2.2rem);
		line-height: 0.98;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--marker-black);
	}

	.board-meta {
		margin-top: 0.04rem;
		font-size: 0.92rem;
		font-weight: 400;
	}

	.header-lead {
		position: relative;
		border: 2px solid var(--marker-black);
		border-radius: 0.28rem;
		padding: 0.26rem 0.34rem;
		background: var(--paper-strong);
		display: flex;
		align-items: center;
		gap: 0.3rem;
		box-shadow: 0 5px 8px rgba(0, 0, 0, 0.08);
		justify-self: start;
		max-width: 100%;
	}

	.lead-text {
		display: grid;
		gap: 0.08rem;
		min-width: 0;
	}

	.lead-name {
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1.06;
		max-width: 7.5rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lead-role {
		margin: 0;
		font-size: 0.46rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--marker-black);
	}

	.account-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.62rem;
		height: 1.62rem;
		border: 1.5px solid var(--marker-black);
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.9);
		color: var(--marker-black);
		flex-shrink: 0;
	}

	.account-icon-btn svg {
		width: 0.88rem;
		height: 0.88rem;
		fill: currentColor;
	}

	.account-icon-btn:hover {
		background: #fef3c7;
	}

	.account-icon-btn:disabled {
		opacity: 0.55;
	}

	.mobile-nav-row {
		position: absolute;
		top: 0.54rem;
		right: 0.54rem;
		z-index: 10;
	}

	.mobile-menu-btn {
		width: 2.3rem;
		height: 2.3rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1.5px solid #a9b4c2;
		border-radius: 0.58rem;
		background: #ffffff;
		box-shadow: 0 2px 6px rgba(14, 25, 38, 0.08);
	}

	.mobile-menu-icon {
		position: relative;
		width: 1rem;
		height: 0.92rem;
		flex-shrink: 0;
	}

	.mobile-menu-icon span {
		position: absolute;
		left: 0;
		top: 50%;
		width: 1rem;
		height: 2px;
		background: #2e3a4a;
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

	.mobile-menu-btn.mobile-menu-btn-open {
		border-color: #7f8fa4;
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
		position: absolute;
		top: 3.18rem;
		right: 0.54rem;
		display: none;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.32rem;
		width: min(17rem, calc(100% - 1.1rem));
		padding: 0.4rem;
		border: 1.5px solid #b4becb;
		border-radius: 0.66rem;
		background: #f8fbff;
		box-shadow: 0 10px 16px rgba(16, 29, 44, 0.16);
		z-index: 9;
	}

	.tab-strip.tab-strip-open {
		display: grid;
	}

	.menu-account {
		display: grid;
		gap: 0.24rem;
		margin-top: 0.1rem;
		padding: 0.44rem 0.42rem 0.2rem;
		border-top: 1px solid #c8d1dc;
	}

	.menu-account-name {
		margin: 0;
		font-size: 0.96rem;
		font-weight: 700;
		line-height: 1.1;
	}

	.menu-account-role {
		margin: 0;
		font-size: 0.55rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #5f6f84;
	}

	.menu-auth-btn {
		min-height: 2.1rem;
		padding: 0.3rem 0.52rem;
		border: 1.5px solid #3f4f63;
		border-radius: 0.45rem;
		background: #ffffff;
		color: #1f2b3a;
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-align: left;
	}

	.menu-auth-btn:disabled {
		opacity: 0.62;
	}

	.tab-strip-dashboard .board-tab {
		opacity: 0.84;
		filter: saturate(0.78);
	}

	.tab-strip-dashboard .board-tab.tab-active {
		opacity: 1;
		filter: saturate(1);
	}

	.board-tab {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		min-height: 2.42rem;
		width: 100%;
		padding: 0.4rem 0.52rem;
		border: 1.5px solid var(--marker-black);
		border-radius: 0.52rem;
		font-weight: 800;
		color: var(--marker-black);
		background: #ffffff;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
		overflow: hidden;
		isolation: isolate;
	}

	.board-tab::before {
		content: none;
	}

	.board-tab > * {
		position: relative;
		z-index: 1;
	}

	.board-tab:hover {
		box-shadow: 0 5px 10px rgba(0, 0, 0, 0.12);
	}

	.tab-active {
		border-color: #1a6bb5;
		box-shadow:
			0 0 0 2px rgba(26, 107, 181, 0.18),
			0 5px 11px rgba(0, 0, 0, 0.12),
			0 2px 4px rgba(0, 0, 0, 0.08);
	}

	.tab-color-mark {
		display: inline-flex;
		width: 0.34rem;
		height: 0.78rem;
		border-radius: 0.14rem;
		border: 1px solid rgba(0, 0, 0, 0.2);
		background: #9aa3ad;
		flex-shrink: 0;
	}

	.tab-content {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		line-height: 1;
	}

	.tab-num {
		display: inline-flex;
		font-size: 0.54rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5d6f86;
	}

	.tab-name {
		font-size: 0.92rem;
		white-space: nowrap;
	}

	.tab-blue {
		background: linear-gradient(180deg, #f8fbff 0%, #e8f2ff 100%);
	}
	.tab-blue .tab-color-mark { background: var(--marker-blue); }
	.tab-green { background: #edfae8; }
	.tab-green .tab-color-mark { background: var(--marker-green); }
	.tab-yellow { background: #fff9dc; }
	.tab-yellow .tab-color-mark { background: var(--marker-orange); }
	.tab-sand { background: #fff1e2; }
	.tab-sand .tab-color-mark { background: var(--marker-red); }
	.tab-lilac { background: #f2ebff; }
	.tab-lilac .tab-color-mark { background: var(--marker-purple); }
	.tab-white {
		background: linear-gradient(180deg, #ffffff 0%, #f2f6fb 100%);
	}
	.tab-white .tab-color-mark { background: #8a939f; }

	.board-workspace {
		margin-top: 0.56rem;
		display: grid;
		gap: 0.8rem;
	}

	.page-stage {
		min-height: 15rem;
		perspective: 1400px;
	}

	.page-paper {
		position: relative;
		will-change: transform, opacity;
		border-radius: 0.34rem;
		padding: 0.74rem 0.62rem;
		background: var(--paper);
	}

	.page-paper.page-paper-dashboard {
		padding: 0;
		border-radius: 0;
		background: transparent;
	}

	.page-paper::after {
		content: none;
	}

	.page-turn-forward {
		transform-origin: left center;
		animation: pageTurnForward 390ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	.page-turn-backward {
		transform-origin: right center;
		animation: pageTurnBackward 390ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	@keyframes pageTurnForward {
		0% {
			opacity: 0;
			transform: perspective(1400px) rotateY(-18deg) translateX(14px);
		}
		65% {
			opacity: 1;
			transform: perspective(1400px) rotateY(2deg) translateX(-2px);
		}
		100% {
			opacity: 1;
			transform: perspective(1400px) rotateY(0deg) translateX(0);
		}
	}

	@keyframes pageTurnBackward {
		0% {
			opacity: 0;
			transform: perspective(1400px) rotateY(18deg) translateX(-14px);
		}
		65% {
			opacity: 1;
			transform: perspective(1400px) rotateY(-2deg) translateX(2px);
		}
		100% {
			opacity: 1;
			transform: perspective(1400px) rotateY(0deg) translateX(0);
		}
	}

	@media (max-width: 480px) {
		.header-strip {
			padding-right: 3.2rem;
		}

		.tab-strip {
			top: 3.05rem;
			right: 0.46rem;
			width: calc(100% - 0.92rem);
			padding: 0.34rem;
		}

		.board-tab {
			padding: 0.34rem 0.46rem;
			min-height: 2.24rem;
		}

		.tab-name {
			font-size: 0.84rem;
		}
	}

	@media (min-width: 640px) {
		.whiteboard-surface {
			padding: 1rem 0.95rem 1.15rem;
		}

		.header-strip {
			grid-template-columns: minmax(0, 1fr) auto;
			padding: 0.72rem 0.86rem;
		}
	}

	@media (min-width: 960px) {
		.mobile-nav-row {
			display: none;
		}

		.whiteboard-surface {
			padding: 1rem 1.15rem 1.2rem;
			padding-right: 7.2rem;
		}

		.header-strip {
			grid-template-columns: minmax(0, 1fr) 12.5rem;
			align-items: start;
		}

		.tab-strip {
			position: absolute;
			top: 2.8rem;
			right: -0.12rem;
			margin-top: 0;
			display: flex !important;
			flex-direction: column;
			width: 6.45rem;
			overflow: visible;
			padding: 0;
			gap: 0.18rem;
			border: none;
			border-radius: 0;
			background: transparent;
			box-shadow: none;
		}

		.menu-account {
			display: none;
		}

		.board-tab {
			min-height: 2.6rem;
			width: 100%;
			min-width: 0;
			border-left: none;
			border-radius: 0 0.55rem 0.55rem 0;
			padding: 0.48rem 0.58rem 0.48rem 0.64rem;
			flex: 1 0 auto;
		}

		.tab-active {
			border-color: var(--marker-black);
			border-bottom-color: transparent;
			transform: translateX(6px);
		}

		.board-tab:hover {
			transform: translateX(3px);
		}
	}

	@media (max-width: 390px) {
		.whiteboard-surface {
			padding: 0.75rem 0.55rem 0.85rem;
		}

		.board-title {
			font-size: clamp(1.34rem, 6.5vw, 1.74rem);
		}

		.page-paper {
			padding: 0.62rem 0.54rem;
		}

		.lead-text {
			display: none;
		}

		.header-lead {
			padding: 0.22rem;
		}
	}

	@media (max-width: 959px) {
		.header-lead {
			display: none;
		}
	}
</style>
