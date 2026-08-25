<script lang="ts">
	import toast from 'svelte-french-toast';
	import { listUserProfiles, updateUserProfile, setUserApproved, isProfileApproved } from '$lib/data/users';
	import { formatPhoneNumber, normalizePhoneNumber } from '$lib/utils/phone';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import type { Dog, UserProfile, UserRole } from '$lib/types';
	import { formatDate, formatDateTime, toDate } from '$lib/utils/dates';
	import { listDogs, mergeDogs, updateDog } from '$lib/data/dogs';

	type EditableUser = UserProfile & {
		draftDisplayName: string;
		draftRole: UserRole;
		draftPhone: string;
	};

	const roleOptions: UserRole[] = ['admin', 'manager', 'coordinator', 'staff', 'volunteer'];

	let users: EditableUser[] = [];
	let usersLoaded = false;
	let usersLoading = false;
	let usersError = '';
	let savingUserId: string | null = null;

	// One-time backfill: archived dogs missing a departure date
	type DateFix = { dog: Dog; date: string; source: string };
	type DateUnknown = { dog: Dog; manualDate: string };
	let backfillRunning = false;
	let backfillRan = false;
	let backfillMatched: DateFix[] = [];
	let backfillUnknown: DateUnknown[] = [];
	let backfillApplying = false;
	let backfillFixingId: string | null = null;

	// Merge dogs
	let allDogs: Dog[] = [];
	let allDogsLoaded = false;
	let mergeKeepId = '';
	let mergeDeleteId = '';
	let merging = false;
	let mergeConfirm = false;

	$: isAdmin = $authProfile?.role === 'admin';
	$: currentUserId = $authUser?.uid ?? '';
	$: pendingUserCount = users.filter(hasPendingChanges).length;
	$: roleCounts = roleOptions.map((role) => ({
		role,
		count: users.filter((user) => user.role === role).length
	}));

	$: if ($authReady && $authUser && isAdmin && !usersLoaded && !usersLoading) {
		usersLoaded = true;
		void loadUsers();
	}

	$: if ($authReady && $authUser && isAdmin && !allDogsLoaded) {
		allDogsLoaded = true;
		void listDogs().then((dogs) => {
			allDogs = dogs.sort((a, b) => a.name.localeCompare(b.name));
		});
	}

	$: mergeKeepDog = allDogs.find((d) => d.id === mergeKeepId) ?? null;
	$: mergeDeleteDog = allDogs.find((d) => d.id === mergeDeleteId) ?? null;
	$: mergeValid = mergeKeepId && mergeDeleteId && mergeKeepId !== mergeDeleteId;

	// Dry run: find archived dogs with no leftShelterDate and propose real dates
	// from ASM (adoption movement dates + deceased dates). Reads only.
	async function runBackfillDryRun() {
		backfillRunning = true;
		backfillRan = false;
		backfillMatched = [];
		backfillUnknown = [];
		try {
			const today = new Date().toISOString().slice(0, 10);
			// App first shipped 2026-03-02 — Feb 2026 gives a month of margin.
			const [dogs, res] = await Promise.all([
				listDogs(),
				fetch(`/api/asm/departures?fromdate=2026-02-01&todate=${today}`)
			]);
			if (!res.ok) throw new Error(`ASM departures feed failed (${res.status})`);
			const departures: { id: number; shelterCode: string; date: string; outcome: string }[] = await res.json();
			const byId = new Map(departures.map((d) => [d.id, d]));
			const byCode = new Map(departures.filter((d) => d.shelterCode).map((d) => [d.shelterCode, d]));

			const missing = dogs.filter(
				(d) =>
					(d.status === 'adopted' || d.status === 'transferred' || d.status === 'euthanized') &&
					!toDate(d.leftShelterDate)
			);
			for (const dog of missing) {
				const asmId = dog.asmId ?? (/^\d+$/.test(dog.id) ? Number(dog.id) : null);
				const match =
					(asmId !== null ? byId.get(asmId) : undefined) ??
					(dog.asmShelterCode ? byCode.get(dog.asmShelterCode) : undefined);
				if (match) {
					backfillMatched = [...backfillMatched, { dog, date: match.date, source: match.outcome === 'euthanized' ? '🌈 euthanized — ASM deceased record' : '🏠 adopted — ASM adoption record' }];
				} else {
					// No exact record in ASM — pre-fill with the day the sync archived
					// the dog (usually within a day of the real departure). Editable.
					const archivedAt = toDate(dog.lastSyncedAt);
					const approx = archivedAt
						? `${archivedAt.getFullYear()}-${String(archivedAt.getMonth() + 1).padStart(2, '0')}-${String(archivedAt.getDate()).padStart(2, '0')}`
						: '';
					backfillUnknown = [...backfillUnknown, { dog, manualDate: approx }];
				}
			}
			backfillMatched.sort((a, b) => a.dog.name.localeCompare(b.dog.name));
			backfillUnknown.sort((a, b) => a.dog.name.localeCompare(b.dog.name));
			backfillRan = true;
			if (backfillMatched.length === 0 && backfillUnknown.length === 0) {
				toast.success('Every archived dog already has a departure date.');
			}
		} catch (e) {
			toast.error('Dry run failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			backfillRunning = false;
		}
	}

	async function applyBackfillMatches() {
		if (backfillApplying || backfillMatched.length === 0) return;
		backfillApplying = true;
		let applied = 0;
		try {
			for (const fix of backfillMatched) {
				await updateDog(fix.dog.id, { leftShelterDate: toDate(fix.date) });
				applied += 1;
			}
			backfillMatched = [];
			toast.success(`Set departure dates for ${applied} dog${applied === 1 ? '' : 's'}.`);
		} catch (e) {
			backfillMatched = backfillMatched.slice(applied);
			toast.error('Stopped after an error: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			backfillApplying = false;
		}
	}

	async function applyAllFilledDates() {
		if (backfillApplying) return;
		const filled = backfillUnknown.filter((u) => toDate(u.manualDate));
		if (filled.length === 0) return;
		backfillApplying = true;
		let applied = 0;
		try {
			for (const entry of filled) {
				await updateDog(entry.dog.id, { leftShelterDate: toDate(entry.manualDate) });
				backfillUnknown = backfillUnknown.filter((u) => u.dog.id !== entry.dog.id);
				applied += 1;
			}
			toast.success(`Set departure dates for ${applied} dog${applied === 1 ? '' : 's'}.`);
		} catch (e) {
			toast.error(`Stopped after ${applied} — ` + (e instanceof Error ? e.message : String(e)));
		} finally {
			backfillApplying = false;
		}
	}

	async function applyManualDate(entry: DateUnknown) {
		const parsed = toDate(entry.manualDate);
		if (!parsed) {
			toast.error('Pick a date first.');
			return;
		}
		backfillFixingId = entry.dog.id;
		try {
			await updateDog(entry.dog.id, { leftShelterDate: parsed });
			backfillUnknown = backfillUnknown.filter((u) => u.dog.id !== entry.dog.id);
			toast.success(`${entry.dog.name}: departure date set to ${formatDate(parsed)}.`);
		} catch (e) {
			toast.error('Save failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			backfillFixingId = null;
		}
	}

	async function runMerge() {
		if (!mergeValid || merging) return;
		merging = true;
		try {
			await mergeDogs(mergeKeepId, mergeDeleteId);
			toast.success(`Merged — ${mergeDeleteDog?.name} deleted, records moved to ${mergeKeepDog?.name}.`);
			allDogs = allDogs.filter((d) => d.id !== mergeDeleteId);
			mergeKeepId = '';
			mergeDeleteId = '';
			mergeConfirm = false;
		} catch (error) {
			console.error(error);
			toast.error('Merge failed. Check the console for details.');
		} finally {
			merging = false;
		}
	}

	function toEditableUser(user: UserProfile): EditableUser {
		const displayName = user.displayName?.trim() || user.email || 'Staff Member';
		return {
			...user,
			displayName,
			draftDisplayName: displayName,
			draftRole: user.role,
			draftPhone: formatPhoneNumber(user.phoneNumber)
		};
	}

	function hasPendingChanges(user: EditableUser) {
		const nextName = user.draftDisplayName.trim() || user.email || 'Staff Member';
		const nextPhone = user.draftPhone.trim() ? normalizePhoneNumber(user.draftPhone) : null;
		return nextName !== user.displayName || user.draftRole !== user.role || nextPhone !== (user.phoneNumber ?? null);
	}

	function updateDraft(userId: string, field: 'draftDisplayName' | 'draftRole' | 'draftPhone', value: string) {
		users = users.map((user) =>
			user.uid === userId
				? {
						...user,
						[field]: value
					}
				: user
		);
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

	async function toggleApproval(user: EditableUser) {
		const next = !isProfileApproved(user);
		if (user.uid === currentUserId && !next) {
			toast.error('You can\'t set your own account back to pending.');
			return;
		}
		savingUserId = user.uid;
		try {
			await setUserApproved(user.uid, next);
			users = users.map((entry) =>
				entry.uid === user.uid ? { ...entry, approved: next, updatedAt: new Date() } : entry
			);
			toast.success(next ? `${user.displayName || user.email} approved.` : `${user.displayName || user.email} set back to pending.`);
		} catch (error) {
			console.error(error);
			toast.error('Unable to change approval.');
		} finally {
			savingUserId = null;
		}
	}

	async function saveUser(user: EditableUser) {
		const displayName = user.draftDisplayName.trim() || user.email || 'Staff Member';

		if (user.uid === currentUserId && user.draftRole !== 'admin') {
			toast.error('Promote another admin before removing admin from your current account.');
			return;
		}

		// Phone is optional, but if provided it must normalize — it's the
		// phone-inbox allowlist, so a malformed number would never match.
		const phoneNumber = user.draftPhone.trim() ? normalizePhoneNumber(user.draftPhone) : null;
		if (user.draftPhone.trim() && !phoneNumber) {
			toast.error('That phone number doesn\'t look valid — use e.g. (435) 555-0134.');
			return;
		}

		savingUserId = user.uid;
		try {
			await updateUserProfile(user.uid, {
				displayName,
				role: user.draftRole,
				phoneNumber
			});

			const updatedAt = new Date();
			users = users.map((entry) =>
				entry.uid === user.uid
					? {
							...entry,
							displayName,
							role: user.draftRole,
							phoneNumber,
							draftDisplayName: displayName,
							draftRole: user.draftRole,
							draftPhone: formatPhoneNumber(phoneNumber),
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
				<p class="section-copy">Manage staff roles and merge duplicate dog records.</p>
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
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Backfill departure dates</h3>
						<p class="section-copy">
							One-time cleanup: archived dogs saved without a departure date don't appear in the dashboard's
							Movements history. The dry run finds them and proposes real dates from ASM (adoption and deceased
							records). Transfers have no ASM feed — set those by hand below. <strong>Nothing changes until you apply.</strong>
							Takes a minute or two; ASM's changes feed is slow.
						</p>
					</div>
					<button class="action-btn" type="button" on:click={runBackfillDryRun} disabled={backfillRunning}>
						{backfillRunning ? 'Checking…' : 'Dry run'}
					</button>
				</div>
				{#if backfillRan && backfillMatched.length === 0 && backfillUnknown.length === 0}
					<p class="empty-note">Every archived dog already has a departure date — nothing to fix.</p>
				{/if}
				{#if backfillMatched.length > 0}
					<div class="status-row-plain">
						<span class="status-meta">{backfillMatched.length} dog{backfillMatched.length === 1 ? '' : 's'} with a date found in ASM:</span>
					</div>
					<ul class="user-list">
						{#each backfillMatched as fix (fix.dog.id)}
							<li class="user-row">
								<div class="user-main">
									<p class="suspect-name">{fix.dog.name}</p>
									<p class="suspect-detail">{fix.dog.status} · will set departure to <strong>{formatDate(fix.date)}</strong> ({fix.source})</p>
								</div>
							</li>
						{/each}
					</ul>
					<button class="action-btn backfill-apply" type="button" on:click={applyBackfillMatches} disabled={backfillApplying}>
						{backfillApplying ? 'Applying…' : `Apply ${backfillMatched.length} date${backfillMatched.length === 1 ? '' : 's'}`}
					</button>
				{/if}
				{#if backfillUnknown.length > 0}
					<div class="status-row-plain">
						<span class="status-meta">
							{backfillUnknown.length} dog{backfillUnknown.length === 1 ? '' : 's'} with no exact date in ASM.
							Pre-filled dates are the day the sync archived the dog (usually within a day of the real departure) — adjust any, then set individually or all at once.
						</span>
					</div>
					<ul class="user-list">
						{#each backfillUnknown as entry (entry.dog.id)}
							<li class="user-row">
								<div class="user-main">
									<p class="suspect-name">{entry.dog.name}</p>
									<p class="suspect-detail">{entry.dog.status} · {entry.manualDate ? 'approximate date from archive time' : 'no date on record — set by hand'}</p>
								</div>
								<div class="repair-actions">
									<input type="date" class="field-input backfill-date-input" bind:value={entry.manualDate} />
									<button
										class="action-btn action-btn-small"
										type="button"
										disabled={backfillFixingId === entry.dog.id || !entry.manualDate}
										on:click={() => applyManualDate(entry)}
									>Set</button>
								</div>
							</li>
						{/each}
					</ul>
					{#if backfillUnknown.some((u) => u.manualDate)}
						<button class="action-btn backfill-apply" type="button" on:click={applyAllFilledDates} disabled={backfillApplying}>
							{backfillApplying ? 'Applying…' : `Apply all ${backfillUnknown.filter((u) => u.manualDate).length} filled date${backfillUnknown.filter((u) => u.manualDate).length === 1 ? '' : 's'}`}
						</button>
					{/if}
				{/if}
			</section>

			<section class="admin-card">
				<div class="card-header">
					<div>
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Merge duplicate dogs</h3>
						<p class="section-copy">Move all logs and notes from the duplicate into the dog you want to keep, then delete the duplicate.</p>
					</div>
				</div>

				<div class="merge-fields">
					<label class="field">
						<span class="field-label">Keep (canonical record)</span>
						<select class="field-select" bind:value={mergeKeepId} disabled={merging}>
							<option value="">— select dog to keep —</option>
							{#each allDogs as dog}
								<option value={dog.id}>{dog.name}{dog.status === 'active' ? '' : ` (${dog.status})`}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span class="field-label">Delete (duplicate)</span>
						<select class="field-select" bind:value={mergeDeleteId} disabled={merging}>
							<option value="">— select dog to delete —</option>
							{#each allDogs.filter((d) => d.id !== mergeKeepId) as dog}
								<option value={dog.id}>{dog.name}{dog.status === 'active' ? '' : ` (${dog.status})`}</option>
							{/each}
						</select>
					</label>
				</div>

				{#if mergeValid && !mergeConfirm}
					<div class="merge-preview">
						<p class="merge-preview-text">
							All feeding logs, stool logs, bath logs, yard logs, behavioral notes, and day trip logs from
							<strong>{mergeDeleteDog?.name}</strong> will be moved to <strong>{mergeKeepDog?.name}</strong>,
							and any profile fields <strong>{mergeKeepDog?.name}</strong> is missing will be filled in from
							<strong>{mergeDeleteDog?.name}</strong> (the name stays <strong>{mergeKeepDog?.name}</strong>).
							Then <strong>{mergeDeleteDog?.name}</strong> will be permanently deleted.
						</p>
						<button class="danger-btn" type="button" on:click={() => (mergeConfirm = true)}>
							Merge dogs
						</button>
					</div>
				{/if}

				{#if mergeConfirm}
					<div class="merge-confirm">
						<p class="merge-confirm-text">This cannot be undone. Are you sure?</p>
						<div class="merge-confirm-actions">
							<button class="danger-btn" type="button" on:click={runMerge} disabled={merging}>
								{merging ? 'Merging…' : 'Yes, merge and delete duplicate'}
							</button>
							<button class="ghost-btn" type="button" on:click={() => (mergeConfirm = false)} disabled={merging}>
								Cancel
							</button>
						</div>
					</div>
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

										<label class="field">
											<span class="field-label">Phone (update line)</span>
											<input
												class="field-input"
												type="tel"
												placeholder="(435) 555-0134"
												value={user.draftPhone}
												on:input={(event) => updateDraft(user.uid, 'draftPhone', event.currentTarget.value)}
												disabled={savingUserId === user.uid}
											/>
										</label>
									</div>

									<div class="user-meta">
										<span>{user.email || 'No email on profile'}</span>
										<span>{user.uid}</span>
										{#if user.uid === currentUserId}
											<span class="current-user-badge">Current account</span>
										{/if}
										{#if !isProfileApproved(user)}
											<span class="pending-badge">Awaiting approval</span>
										{/if}
									</div>
								</div>

								<div class="user-actions">
									<span class="status-meta">Updated {formatDateTime(user.updatedAt)}</span>
									<button
										class={`action-btn ${isProfileApproved(user) ? '' : 'action-btn-approve'}`}
										type="button"
										on:click={() => toggleApproval(user)}
										disabled={savingUserId === user.uid}
									>
										{isProfileApproved(user) ? 'Set to pending' : 'Approve'}
									</button>
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
	.role-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.hero-badge,
	.role-chip,
	.current-user-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.28rem 0.6rem;
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.hero-badge {
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

	.action-btn-small {
		min-height: 1.9rem;
		padding: 0.3rem 0.6rem;
		font-size: 0.72rem;
		border-radius: 0.5rem;
	}

	.repair-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		flex-shrink: 0;
		align-items: center;
	}

	.status-row-plain {
		margin-top: 0.8rem;
	}

	.suspect-name {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.94rem;
		font-weight: 800;
		color: #133149;
	}

	.suspect-detail {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: #526b81;
	}

	.backfill-apply {
		margin-top: 0.7rem;
	}

	.backfill-date-input {
		width: auto;
		min-height: 1.9rem;
		padding: 0.24rem 0.4rem;
		font-size: 0.78rem;
	}

	.danger-btn {
		min-height: 2.5rem;
		padding: 0.6rem 0.9rem;
		border-radius: 0.8rem;
		font-family: var(--font-ui);
		font-size: 0.86rem;
		font-weight: 700;
		border: 1px solid #9e2929;
		background: linear-gradient(180deg, #d95050 0%, #b83232 100%);
		color: #fff;
		box-shadow: 0 10px 18px rgba(180, 40, 40, 0.18);
	}

	.danger-btn:disabled {
		opacity: 0.65;
		box-shadow: none;
	}

	.merge-fields {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.8rem;
	}

	.merge-preview {
		margin-top: 0.8rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid #e8d5b0;
		border-radius: 0.5rem;
		background: #fffbf2;
		display: grid;
		gap: 0.6rem;
	}

	.merge-preview-text {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.5;
		color: #5a3e1a;
	}

	.merge-confirm {
		margin-top: 0.8rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid #e8b0b0;
		border-radius: 0.5rem;
		background: #fff5f5;
		display: grid;
		gap: 0.6rem;
	}

	.merge-confirm-text {
		margin: 0;
		font-size: 0.84rem;
		font-weight: 700;
		color: #7a1f1f;
	}

	.merge-confirm-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
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

	.user-list {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.7rem;
	}

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

	.user-main {
		display: grid;
		gap: 0.28rem;
		min-width: 0;
		flex: 1 1 18rem;
	}

	.pending-badge {
		display: inline-block;
		border-radius: 999px;
		padding: 1px 10px;
		background: #fbf0dd;
		color: #8a5d05;
		font-size: 11px;
		letter-spacing: 0.04em;
	}

	.action-btn-approve {
		border-color: #b9d9b3;
		background: #edf7ed;
		color: #24601f;
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

</style>
