<script lang="ts">
	import toast from 'svelte-french-toast';
	import { syncAnimalsFromASM, type SyncChange } from '$lib/data/asm-sync';
	import { migrateFoodTypes } from '$lib/data/migrate-food-types';
	import { listUserProfiles, updateUserProfile } from '$lib/firebase/firestore';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import type { Dog, UserProfile, UserRole } from '$lib/types';
	import { formatDateTime } from '$lib/utils/dates';
	import { getDog, listDogs } from '$lib/data/dogs';
	import { confetti } from '@neoconfetti/svelte';

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	type EditableUser = UserProfile & {
		draftDisplayName: string;
		draftRole: UserRole;
	};

	const roleOptions: UserRole[] = ['admin', 'manager', 'coordinator', 'staff', 'volunteer'];

	let users: EditableUser[] = [];
	let usersLoaded = false;
	let usersLoading = false;
	let usersError = '';
	let savingUserId: string | null = null;

	let auditRunning = false;
	let auditError = '';
	let auditChanges: SyncChange[] = [];
	let auditRanAt: Date | null = null;

	let migratingFood = false;
	let foodMigrateResult = '';

	let showCelebrationTest = false;
	let testDogs: Dog[] = [];

	let showFosterTest = false;
	let fosterTestDog: Dog | null = null;

	let showTransferTest = false;
	let transferTestDog: Dog | null = null;

	async function testFosterMoment() {
		const all = await listDogs();
		const active = all.filter((d) => d.status === 'active');
		if (active.length === 0) { toast.error('No active dogs found.'); return; }
		fosterTestDog = active[Math.floor(Math.random() * active.length)];
		showFosterTest = true;
	}

	async function testTransferMoment() {
		const all = await listDogs();
		const active = all.filter((d) => d.status === 'active');
		if (active.length === 0) { toast.error('No active dogs found.'); return; }
		transferTestDog = active[Math.floor(Math.random() * active.length)];
		showTransferTest = true;
	}

	async function testAdoptionCelebration() {
		const all = await listDogs();
		const active = all.filter((d) => d.status === 'active');
		if (active.length === 0) { toast.error('No active dogs found.'); return; }
		const pick = active[Math.floor(Math.random() * active.length)];
		testDogs = [pick];
		showCelebrationTest = true;
	}

	$: isAdmin = $authProfile?.role === 'admin';
	$: currentUserId = $authUser?.uid ?? '';
	$: pendingUserCount = users.filter(hasPendingChanges).length;
	$: auditSummary =
		auditChanges.length === 0
			? 'No changes found'
			: `${auditChanges.length} change${auditChanges.length === 1 ? '' : 's'} found`;
	$: roleCounts = roleOptions.map((role) => ({
		role,
		count: users.filter((user) => user.role === role).length
	}));

	$: if ($authReady && $authUser && isAdmin && !usersLoaded && !usersLoading) {
		usersLoaded = true;
		void loadUsers();
	}

	function toEditableUser(user: UserProfile): EditableUser {
		const displayName = user.displayName?.trim() || user.email || 'Staff Member';
		return {
			...user,
			displayName,
			draftDisplayName: displayName,
			draftRole: user.role
		};
	}

	function hasPendingChanges(user: EditableUser) {
		const nextName = user.draftDisplayName.trim() || user.email || 'Staff Member';
		return nextName !== user.displayName || user.draftRole !== user.role;
	}

	function updateDraft(userId: string, field: 'draftDisplayName' | 'draftRole', value: string) {
		users = users.map((user) =>
			user.uid === userId
				? {
						...user,
						[field]: value
					}
				: user
		);
	}

	function describeChange(change: SyncChange) {
		if (change.isArchived) return 'Adopted';
		if (change.isTransferredOut) return 'Transferred out';
		if (change.isEuthanized) return 'Euthanized';
		if (change.isNew) return 'Added to shelter';
		return `Updated: ${change.fields.join(', ')}`;
	}

	function roleTone(role: UserRole) {
		if (role === 'admin') return 'role-chip-admin';
		if (role === 'manager') return 'role-chip-manager';
		if (role === 'coordinator') return 'role-chip-coordinator';
		if (role === 'staff') return 'role-chip-staff';
		return 'role-chip-volunteer';
	}

	async function loadUsers() {
		usersLoading = true;
		usersError = '';

		try {
			users = (await listUserProfiles()).map(toEditableUser);
		} catch (error) {
			console.error(error);
			usersError = error instanceof Error ? error.message : 'Unable to load users.';
		} finally {
			usersLoading = false;
		}
	}

	async function saveUser(user: EditableUser) {
		const displayName = user.draftDisplayName.trim() || user.email || 'Staff Member';

		if (user.uid === currentUserId && user.draftRole !== 'admin') {
			toast.error('Promote another admin before removing admin from your current account.');
			return;
		}

		savingUserId = user.uid;
		try {
			await updateUserProfile(user.uid, {
				displayName,
				role: user.draftRole
			});

			const updatedAt = new Date();
			users = users.map((entry) =>
				entry.uid === user.uid
					? {
							...entry,
							displayName,
							role: user.draftRole,
							draftDisplayName: displayName,
							draftRole: user.draftRole,
							updatedAt
						}
					: entry
			);

			if ($authProfile?.uid === user.uid) {
				authProfile.set({
					...$authProfile,
					displayName,
					role: user.draftRole,
					updatedAt
				});
			}

			toast.success(`Updated ${displayName}.`);
		} catch (error) {
			console.error(error);
			toast.error(error instanceof Error ? error.message : 'Unable to update user.');
		} finally {
			savingUserId = null;
		}
	}

	async function runFoodMigration() {
		migratingFood = true;
		foodMigrateResult = '';
		try {
			const { updated } = await migrateFoodTypes();
			foodMigrateResult = updated === 0 ? 'All dogs already up to date.' : `Migrated ${updated} dog${updated === 1 ? '' : 's'}.`;
			toast.success(foodMigrateResult);
		} catch (error) {
			foodMigrateResult = error instanceof Error ? error.message : 'Migration failed.';
			toast.error(foodMigrateResult);
		} finally {
			migratingFood = false;
		}
	}

	async function runFullChangeCheck() {
		auditRunning = true;
		auditError = '';

		try {
			const result = await syncAnimalsFromASM();
			auditChanges = result.changes;
			auditRanAt = new Date();
			toast.success(
				result.changes.length === 0
					? 'No ASM changes found.'
					: `Found ${result.changes.length} ASM change${result.changes.length === 1 ? '' : 's'}.`
			);
		} catch (error) {
			console.error(error);
			auditError = error instanceof Error ? error.message : 'Unable to run ASM check.';
			toast.error(auditError);
		} finally {
			auditRunning = false;
		}
	}
</script>

<svelte:head>
	<title>Admin | Cache Humane Society</title>
</svelte:head>

{#if !isAdmin}
	<section class="admin-page">
		<div class="admin-card admin-card-centered">
			<p class="section-kicker">Admin</p>
			<h2 class="section-title">Access restricted</h2>
			<p class="section-copy">This page is only available to accounts with the `admin` role.</p>
		</div>
	</section>
{:else}
	<section class="admin-page">
		<div class="admin-hero">
			<div>
				<p class="section-kicker">Admin</p>
				<h2 class="hero-title">System tools and user management</h2>
				<p class="section-copy">Run the existing ASM full change check on demand and manage staff roles in one place.</p>
			</div>
			<div class="hero-badges">
				<span class="hero-badge">{users.length} user{users.length === 1 ? '' : 's'}</span>
				<span class="hero-badge">{pendingUserCount} pending edit{pendingUserCount === 1 ? '' : 's'}</span>
			</div>
		</div>

		<div class="admin-grid">
			<section class="admin-card">
				<div class="card-header">
					<div>
						<p class="section-kicker">UI</p>
						<h3 class="section-title">Test adoption celebration</h3>
						<p class="section-copy">Previews the confetti overlay using the most recently adopted dog from the last sync run.</p>
					</div>
					<button class="action-btn" type="button" on:click={testAdoptionCelebration}>
						Test 🎉
					</button>
				</div>
			</section>

			<section class="admin-card">
				<div class="card-header">
					<div>
						<p class="section-kicker">UI</p>
						<h3 class="section-title">Test foster moment</h3>
						<p class="section-copy">Previews the foster overlay using the most recently fostered dog from the last sync run.</p>
					</div>
					<button class="action-btn" type="button" on:click={testFosterMoment}>
						Test 🏡
					</button>
				</div>
			</section>

			<section class="admin-card">
				<div class="card-header">
					<div>
						<p class="section-kicker">UI</p>
						<h3 class="section-title">Test transfer moment</h3>
						<p class="section-copy">Previews the transfer-out overlay using dogs transferred out in the last sync run.</p>
					</div>
					<button class="action-btn" type="button" on:click={testTransferMoment}>
						Test 🚌
					</button>
				</div>
			</section>

			<section class="admin-card">
				<div class="card-header">
					<div>
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Migrate food types</h3>
						<p class="section-copy">Maps existing food type values to Normal, Puppy, No Fish, or No Chicken. Sets supplements flag from notes keywords. Safe to run multiple times.</p>
					</div>
					<button class="action-btn" type="button" on:click={runFoodMigration} disabled={migratingFood}>
						{migratingFood ? 'Migrating…' : 'Run migration'}
					</button>
				</div>
				{#if foodMigrateResult}
					<p class="status-pill">{foodMigrateResult}</p>
				{/if}
			</section>

			<section class="admin-card">
				<div class="card-header">
					<div>
						<p class="section-kicker">ASM</p>
						<h3 class="section-title">Full change check</h3>
						<p class="section-copy">Runs the same ASM sync and diff that already executes on page load, but manually.</p>
					</div>
					<button class="action-btn" type="button" on:click={runFullChangeCheck} disabled={auditRunning}>
						{auditRunning ? 'Running…' : 'Run change check'}
					</button>
				</div>

				<div class="status-row">
					<span class="status-pill">{auditRanAt ? auditSummary : 'Not run manually yet'}</span>
					{#if auditRanAt}
						<span class="status-meta">Last run {formatDateTime(auditRanAt)}</span>
					{/if}
				</div>

				{#if auditError}
					<p class="error-note">{auditError}</p>
				{/if}

				{#if auditRanAt && auditChanges.length === 0}
					<p class="empty-note">No changes were detected in ASM on the last manual run.</p>
				{/if}

				{#if auditChanges.length > 0}
					<ul class="change-list">
						{#each auditChanges as change}
							<li class="change-item">
								<div class="change-main">
									<p class="change-name">{change.name}</p>
									<p class="change-detail">{describeChange(change)}</p>
								</div>
								{#if change.isArchived}
									<span class="change-tag change-tag-archived">Adopted</span>
								{:else if change.isTransferredOut}
									<span class="change-tag change-tag-transferred">Transferred</span>
								{:else if change.isEuthanized}
									<span class="change-tag change-tag-euthanized">Euthanized</span>
								{:else if change.isNew}
									<span class="change-tag change-tag-new">New</span>
								{:else}
									<span class="change-tag change-tag-updated">Updated</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="admin-card">
				<div class="card-header">
					<div>
						<p class="section-kicker">Users</p>
						<h3 class="section-title">Manage users</h3>
						<p class="section-copy">Profiles appear here after a person signs in for the first time.</p>
					</div>
					<button class="ghost-btn" type="button" on:click={loadUsers} disabled={usersLoading || savingUserId !== null}>
						{usersLoading ? 'Refreshing…' : 'Refresh users'}
					</button>
				</div>

				<div class="role-summary">
					{#each roleCounts as entry}
						<span class={`role-chip ${roleTone(entry.role)}`}>{entry.role}: {entry.count}</span>
					{/each}
				</div>

				{#if usersError}
					<p class="error-note">{usersError}</p>
				{:else if usersLoading}
					<p class="empty-note">Loading users…</p>
				{:else if users.length === 0}
					<p class="empty-note">No user profiles exist yet.</p>
				{:else}
					<div class="user-list">
						{#each users as user}
							<article class="user-row">
								<div class="user-main">
									<div class="user-fields">
										<label class="field">
											<span class="field-label">Display name</span>
											<input
												class="field-input"
												type="text"
												value={user.draftDisplayName}
												on:input={(event) => updateDraft(user.uid, 'draftDisplayName', event.currentTarget.value)}
												disabled={savingUserId === user.uid}
											/>
										</label>

										<label class="field field-role">
											<span class="field-label">Role</span>
											<select
												class="field-select"
												value={user.draftRole}
												on:change={(event) => updateDraft(user.uid, 'draftRole', event.currentTarget.value)}
												disabled={savingUserId === user.uid}
											>
												{#each roleOptions as role}
													<option value={role}>{role}</option>
												{/each}
											</select>
										</label>
									</div>

									<div class="user-meta">
										<span>{user.email || 'No email on profile'}</span>
										<span>{user.uid}</span>
										{#if user.uid === currentUserId}
											<span class="current-user-badge">Current account</span>
										{/if}
									</div>
								</div>

								<div class="user-actions">
									<span class="status-meta">Updated {formatDateTime(user.updatedAt)}</span>
									<button
										class="action-btn"
										type="button"
										on:click={() => saveUser(user)}
										disabled={savingUserId !== null || !hasPendingChanges(user)}
									>
										{savingUserId === user.uid ? 'Saving…' : hasPendingChanges(user) ? 'Save' : 'Saved'}
									</button>
								</div>
							</article>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	</section>
{/if}

{#if showFosterTest && fosterTestDog}
	<div class="foster-overlay" use:portal role="presentation" on:click={() => showFosterTest = false}>
		<div class="foster-moment">
			<p class="foster-heading">Heading to a foster home 🏡</p>
			<div class="foster-dog-item">
				{#if fosterTestDog.photoUrl}
					<img class="foster-photo" src={fosterTestDog.photoUrl} alt={fosterTestDog.name} />
				{:else}
					<div class="foster-photo foster-photo-placeholder"></div>
				{/if}
				<p class="foster-name">{fosterTestDog.name}</p>
			</div>
			<button class="foster-close typewriter" on:click={() => showFosterTest = false}>Close</button>
		</div>
	</div>
{/if}

{#if showTransferTest && transferTestDog}
	<div class="transfer-overlay" use:portal role="presentation" on:click={() => showTransferTest = false}>
		<div class="transfer-moment">
			<p class="transfer-heading">Off to a new shelter! 🚌</p>
			<div class="transfer-dog-item">
				{#if transferTestDog.photoUrl}
					<img class="transfer-photo" src={transferTestDog.photoUrl} alt={transferTestDog.name} />
				{:else}
					<div class="transfer-photo transfer-photo-placeholder"></div>
				{/if}
				<p class="transfer-name">{transferTestDog.name}</p>
			</div>
			<p class="transfer-subtext">A new chance to find their forever home</p>
			<button class="transfer-close typewriter" on:click={() => showTransferTest = false}>Close</button>
		</div>
	</div>
{/if}

{#if showCelebrationTest && testDogs.length > 0}
	<div class="adoption-overlay" use:portal role="presentation" on:click={() => showCelebrationTest = false}>
		<div class="adoption-celebration">
			<div class="confetti-anchor" use:confetti={{ particleCount: 150, force: 0.7, stageHeight: 900 }}></div>
			<div class="adoption-dogs-row">
				{#each testDogs as dog}
					<div class="adoption-dog-item">
						{#if dog.photoUrl}
							<img class="adoption-photo" src={dog.photoUrl} alt={dog.name} />
						{:else}
							<div class="adoption-photo adoption-photo-placeholder"></div>
						{/if}
						<p class="adoption-name">{dog.name}</p>
					</div>
				{/each}
			</div>
			<p class="adoption-message">{testDogs.length === 1 ? 'Found their forever home!' : `${testDogs.length} dogs found their forever homes!`} 🎉</p>
			<button class="adoption-close typewriter" on:click={() => showCelebrationTest = false}>Close</button>
		</div>
	</div>
{/if}

<style>
	.admin-page {
		display: grid;
		gap: 1rem;
	}

	.admin-hero,
	.admin-card {
		border: 1px solid #d3dfeb;
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 16px 32px rgba(15, 38, 59, 0.08);
	}

	.admin-hero {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.9rem;
		padding: 1.15rem 1.2rem;
		background:
			radial-gradient(circle at top right, rgba(147, 57, 128, 0.12), transparent 36%),
			linear-gradient(180deg, rgba(1, 107, 165, 0.06), rgba(255, 255, 255, 0.96));
	}

	.hero-title,
	.section-title {
		margin: 0;
		font-family: var(--font-ui);
		color: #133149;
	}

	.hero-title {
		font-size: clamp(1.35rem, 3vw, 1.8rem);
		line-height: 1.05;
	}

	.section-title {
		font-size: 1.05rem;
	}

	.section-kicker {
		margin: 0 0 0.2rem;
		font-family: var(--font-typewriter);
		font-size: 0.65rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: #5c7388;
	}

	.section-copy {
		margin: 0.32rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		line-height: 1.45;
		color: #526b81;
		max-width: 42rem;
	}

	.hero-badges,
	.role-summary,
	.status-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.hero-badge,
	.status-pill,
	.role-chip,
	.current-user-badge,
	.change-tag {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.28rem 0.6rem;
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.hero-badge,
	.status-pill {
		background: rgba(1, 107, 165, 0.08);
		border: 1px solid rgba(1, 107, 165, 0.18);
		color: #016ba5;
	}

	.admin-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
	}

	.admin-card {
		padding: 1rem 1.05rem;
	}

	.admin-card-centered {
		padding: 1.4rem;
		text-align: center;
	}

	.card-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
	}

	.action-btn,
	.ghost-btn {
		min-height: 2.5rem;
		padding: 0.6rem 0.9rem;
		border-radius: 0.8rem;
		font-family: var(--font-ui);
		font-size: 0.86rem;
		font-weight: 700;
	}

	.action-btn {
		border: 1px solid #126a97;
		background: linear-gradient(180deg, #1387be 0%, #016ba5 100%);
		color: #ffffff;
		box-shadow: 0 10px 18px rgba(1, 107, 165, 0.18);
	}

	.ghost-btn {
		border: 1px solid #cad8e6;
		background: #f7fbff;
		color: #214866;
	}

	.action-btn:disabled,
	.ghost-btn:disabled {
		opacity: 0.65;
		box-shadow: none;
	}

	.status-row {
		align-items: center;
		margin-top: 0.9rem;
	}

	.status-meta {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		color: #6b7e90;
	}

	.error-note,
	.empty-note {
		margin: 0.9rem 0 0;
		padding: 0.8rem 0.9rem;
		border-radius: 0.8rem;
		font-family: var(--font-ui);
		font-size: 0.86rem;
	}

	.error-note {
		border: 1px solid rgba(184, 50, 32, 0.18);
		background: rgba(184, 50, 32, 0.06);
		color: #b83220;
	}

	.empty-note {
		border: 1px dashed #d4e0eb;
		background: #f8fbfe;
		color: #526b81;
	}

	.change-list,
	.user-list {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.7rem;
	}

	.change-item,
	.user-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.9rem;
		border: 1px solid #d8e3ed;
		border-radius: 0.9rem;
		background: #fbfdff;
	}

	.change-main,
	.user-main {
		display: grid;
		gap: 0.28rem;
		min-width: 0;
		flex: 1 1 18rem;
	}

	.change-name {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.94rem;
		font-weight: 800;
		color: #133149;
	}

	.change-detail {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		color: #526b81;
	}

	.change-tag-new {
		background: rgba(1, 107, 165, 0.08);
		color: #016ba5;
	}

	.change-tag-updated {
		background: rgba(59, 175, 43, 0.1);
		color: #2c8e1d;
	}

	.change-tag-archived {
		background: rgba(184, 50, 32, 0.08);
		color: #b83220;
	}

	.change-tag-transferred {
		background: rgba(60, 100, 160, 0.08);
		color: #2a5c9e;
	}

	.change-tag-euthanized {
		background: rgba(90, 90, 100, 0.1);
		color: #4a4a58;
	}

	.role-chip-admin {
		background: rgba(147, 57, 128, 0.12);
		color: #7f306f;
	}

	.role-chip-manager {
		background: rgba(1, 107, 165, 0.1);
		color: #016ba5;
	}

	.role-chip-coordinator {
		background: rgba(242, 153, 0, 0.12);
		color: #a06500;
	}

	.role-chip-staff {
		background: rgba(59, 175, 43, 0.12);
		color: #2c8e1d;
	}

	.role-chip-volunteer {
		background: rgba(82, 107, 129, 0.12);
		color: #516a80;
	}

	.user-fields {
		display: grid;
		gap: 0.7rem;
		grid-template-columns: minmax(0, 1fr) 11rem;
	}

	.field {
		display: grid;
		gap: 0.28rem;
	}

	.field-label {
		font-family: var(--font-typewriter);
		font-size: 0.64rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #60778c;
	}

	.field-input,
	.field-select {
		width: 100%;
		min-height: 2.45rem;
		padding: 0.58rem 0.72rem;
		border: 1px solid #c8d8e8;
		border-radius: 0.76rem;
		background: #ffffff;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		color: #133149;
	}

	.user-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem 0.7rem;
		font-family: var(--font-ui);
		font-size: 0.76rem;
		color: #6b7e90;
		word-break: break-word;
	}

	.current-user-badge {
		padding-inline: 0.55rem;
		background: rgba(147, 57, 128, 0.1);
		color: #7f306f;
	}

	.user-actions {
		display: grid;
		gap: 0.5rem;
		justify-items: end;
		flex: 0 0 auto;
	}

	@media (max-width: 720px) {
		.user-fields {
			grid-template-columns: 1fr;
		}

		.user-actions {
			width: 100%;
			justify-items: stretch;
		}

		.action-btn,
		.ghost-btn {
			width: 100%;
		}
	}

.transfer-overlay {
	position: fixed;
	inset: 0;
	background: rgba(220, 245, 225, 0.9);
	backdrop-filter: blur(4px);
	z-index: 500;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1.5rem;
	animation: fosterFadeIn 0.4s ease;
}

.transfer-moment {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1rem;
	text-align: center;
	max-width: 22rem;
	width: 100%;
}

.transfer-heading {
	margin: 0;
	font-family: var(--font-ui);
	font-size: clamp(1.4rem, 5vw, 2rem);
	font-weight: 400;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #1a5c2a;
	line-height: 1.1;
}

.transfer-dog-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.45rem;
}

.transfer-photo {
	width: clamp(5rem, 20vw, 8rem);
	height: clamp(5rem, 20vw, 8rem);
	object-fit: cover;
	border-radius: 50%;
	border: 3px solid #5bbf74;
	box-shadow: 0 4px 18px rgba(30, 140, 60, 0.2);
}

.transfer-photo-placeholder {
	background: rgba(30, 140, 60, 0.1);
}

.transfer-name {
	margin: 0;
	font-family: var(--font-ui);
	font-size: clamp(1rem, 3.5vw, 1.5rem);
	font-weight: 400;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #143d1e;
	line-height: 1;
}

.transfer-subtext {
	margin: 0;
	font-family: var(--font-ui);
	font-size: 0.85rem;
	color: #2a6e3a;
	opacity: 0.8;
}

.transfer-close {
	margin-top: 0.2rem;
	border: 1px solid #5bbf74;
	border-radius: 999px;
	padding: 0.4rem 1.2rem;
	font-size: 0.6rem;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	font-weight: 700;
	background: rgba(91, 191, 116, 0.15);
	color: #1a5c2a;
	cursor: pointer;
}

.transfer-close:hover {
	background: rgba(91, 191, 116, 0.28);
}

.foster-overlay {
	position: fixed;
	inset: 0;
	background: rgba(255, 245, 220, 0.88);
	backdrop-filter: blur(4px);
	z-index: 500;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1.5rem;
	animation: fosterFadeIn 0.4s ease;
}

@keyframes fosterFadeIn {
	from { opacity: 0; }
	to   { opacity: 1; }
}

.foster-moment {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1rem;
	text-align: center;
	max-width: 22rem;
	width: 100%;
}

.foster-heading {
	margin: 0;
	font-family: var(--font-ui);
	font-size: clamp(1.4rem, 5vw, 2rem);
	font-weight: 400;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #7a4f10;
	line-height: 1.1;
}

.foster-dog-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.45rem;
}

.foster-photo {
	width: clamp(5rem, 20vw, 8rem);
	height: clamp(5rem, 20vw, 8rem);
	object-fit: cover;
	border-radius: 50%;
	border: 3px solid #e8c07a;
	box-shadow: 0 4px 18px rgba(180, 120, 30, 0.22);
}

.foster-photo-placeholder {
	background: rgba(180, 120, 30, 0.12);
}

.foster-name {
	margin: 0;
	font-family: var(--font-ui);
	font-size: clamp(1rem, 3.5vw, 1.5rem);
	font-weight: 400;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #5a3a00;
	line-height: 1;
}

.foster-close {
	margin-top: 0.2rem;
	border: 1px solid #c8993a;
	border-radius: 999px;
	padding: 0.4rem 1.2rem;
	font-size: 0.6rem;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	font-weight: 700;
	background: rgba(200, 153, 58, 0.15);
	color: #7a4f10;
	cursor: pointer;
}

.foster-close:hover {
	background: rgba(200, 153, 58, 0.28);
}

.adoption-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.72);
	z-index: 500;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1.5rem;
}

.adoption-celebration {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.9rem;
	text-align: center;
	max-width: 22rem;
	width: 100%;
}

.confetti-anchor {
	position: absolute;
	top: 0;
	left: 50%;
	transform: translateX(-50%);
	pointer-events: none;
}

.adoption-dogs-row {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 1.2rem;
}

.adoption-dog-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.5rem;
}

.adoption-photo {
	width: clamp(5rem, 20vw, 9rem);
	height: clamp(5rem, 20vw, 9rem);
	object-fit: cover;
	border-radius: 50%;
	border: 4px solid #fff;
	box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}

.adoption-photo-placeholder {
	background: rgba(255,255,255,0.15);
}

.adoption-name {
	margin: 0;
	font-family: var(--font-ui);
	font-size: clamp(1.2rem, 4vw, 2rem);
	font-weight: 400;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #fff;
	line-height: 1;
}

.adoption-message {
	margin: 0;
	font-size: 1.05rem;
	color: rgba(255,255,255,0.85);
}

.adoption-close {
	margin-top: 0.4rem;
	border: 1px solid rgba(255,255,255,0.4);
	border-radius: 999px;
	padding: 0.4rem 1.2rem;
	font-size: 0.6rem;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	font-weight: 700;
	background: rgba(255,255,255,0.12);
	color: #fff;
	cursor: pointer;
}

.adoption-close:hover {
	background: rgba(255,255,255,0.22);
}
</style>
