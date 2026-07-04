<script lang="ts">
	import toast from 'svelte-french-toast';
	import { syncAnimalsFromASM, type SyncChange } from '$lib/data/asm-sync';
	import { migrateFoodTypes } from '$lib/data/migrate-food-types';
	import { listUserProfiles, updateUserProfile } from '$lib/data/users';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import type { DayTripLog, Dog, UserProfile, UserRole } from '$lib/types';
	import { formatDateTime, toDate, toDateString } from '$lib/utils/dates';
	import { getDog, listDogs, listAllDayTripLogs, mergeDogs, repairTripYear, deleteDayTripLog } from '$lib/data/dogs';
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

	// Merge dogs
	let allDogs: Dog[] = [];
	let allDogsLoaded = false;
	let mergeKeepId = '';
	let mergeDeleteId = '';
	let merging = false;
	let mergeConfirm = false;

	let showFosterTest = false;
	let fosterTestDog: Dog | null = null;

	let showTransferTest = false;
	let transferTestDog: Dog | null = null;

	// Trip year repair
	type TripYearSuspect = { dogId: string; dogName: string; log: DayTripLog };
	let scanningTrips = false;
	let tripScanRan = false;
	let tripYearSuspects: TripYearSuspect[] = [];
	let fixingTripId: string | null = null;

	// Duplicate trip cleanup
	type DuplicateGroup = { dogId: string; dogName: string; logs: DayTripLog[]; likelyDuplicate: boolean };
	let scanningDupes = false;
	let dupeScanRan = false;
	let duplicateGroups: DuplicateGroup[] = [];
	let deletingDupeId: string | null = null;

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

	$: if ($authReady && $authUser && isAdmin && !allDogsLoaded) {
		allDogsLoaded = true;
		void listDogs().then((dogs) => {
			allDogs = dogs.filter((d) => d.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
		});
	}

	$: mergeKeepDog = allDogs.find((d) => d.id === mergeKeepId) ?? null;
	$: mergeDeleteDog = allDogs.find((d) => d.id === mergeDeleteId) ?? null;
	$: mergeValid = mergeKeepId && mergeDeleteId && mergeKeepId !== mergeDeleteId;

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

	async function scanForBadTripYears() {
		scanningTrips = true;
		tripScanRan = false;
		tripYearSuspects = [];
		try {
			const today = new Date();
			const currentYear = today.getFullYear();
			const [dogs, allLogs] = await Promise.all([listDogs(), listAllDayTripLogs()]);
			const dogMap = new Map(dogs.map((d) => [d.id, d]));

			const logsByDog = new Map<string, DayTripLog[]>();
			for (const log of allLogs) {
				const list = logsByDog.get(log.dogId) ?? [];
				list.push(log);
				logsByDog.set(log.dogId, list);
			}

			const suspects: TripYearSuspect[] = [];
			for (const [dogId, logs] of logsByDog) {
				const dog = dogMap.get(dogId);
				if (!dog) continue;

				const currentYearLogs = logs.filter((l) => toDate(l.startedAt)?.getFullYear() === currentYear);
				const prevYearLogs = logs.filter((l) => toDate(l.startedAt)?.getFullYear() === currentYear - 1);
				if (prevYearLogs.length === 0) continue;

				const fosterDate = toDate(dog.inFosterSince);

				for (const log of currentYearLogs) {
					// Imported trips from parseDayTripNotes have startedAt === endedAt (same midnight timestamp)
					const startStr = toDateString(log.startedAt);
					const endStr = toDateString(log.endedAt);
					if (!startStr || !endStr || startStr !== endStr) continue;

					const start = toDate(log.startedAt);
					if (!start) continue;

					let isSuspect = false;

					if (fosterDate) {
						// Definitive: trip is after the dog went into foster → wrong year
						isSuspect = start > fosterDate;
					} else {
						// Fallback heuristic: prev-year entry with later month/day than suspect
						const suspectMD = (start.getMonth() + 1) * 100 + start.getDate();
						isSuspect = prevYearLogs.some((l) => {
							const d = toDate(l.startedAt);
							if (!d) return false;
							return (d.getMonth() + 1) * 100 + d.getDate() > suspectMD;
						});
					}

					if (isSuspect) suspects.push({ dogId, dogName: dog.name, log });
				}
			}

			suspects.sort((a, b) => a.dogName.localeCompare(b.dogName));
			tripYearSuspects = suspects;
			tripScanRan = true;
			if (suspects.length === 0) {
				toast.success('No suspicious trip entries found.');
			}
		} catch (e) {
			toast.error('Scan failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			scanningTrips = false;
		}
	}

	async function fixTripYear(suspect: TripYearSuspect) {
		fixingTripId = suspect.log.id;
		try {
			const start = toDate(suspect.log.startedAt)!;
			const correctedStart = new Date(start);
			correctedStart.setFullYear(correctedStart.getFullYear() - 1);

			const end = toDate(suspect.log.endedAt);
			const correctedEnd = end ? new Date(end) : null;
			if (correctedEnd) correctedEnd.setFullYear(correctedEnd.getFullYear() - 1);

			await repairTripYear(suspect.dogId, suspect.log.id, correctedStart, correctedEnd);
			tripYearSuspects = tripYearSuspects.filter((s) => s.log.id !== suspect.log.id);
			toast.success(`Fixed trip for ${suspect.dogName}.`);
		} catch (e) {
			toast.error('Fix failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			fixingTripId = null;
		}
	}

	async function deleteSuspectTrip(suspect: TripYearSuspect) {
		fixingTripId = suspect.log.id;
		try {
			await deleteDayTripLog(suspect.dogId, suspect.log.id);
			tripYearSuspects = tripYearSuspects.filter((s) => s.log.id !== suspect.log.id);
			toast.success(`Deleted trip for ${suspect.dogName}.`);
		} catch (e) {
			toast.error('Delete failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			fixingTripId = null;
		}
	}

	// Minute-of-day for a log's start, or null if it has no real clock time (e.g.
	// midnight-imported trips). Used to tell a true duplicate from a real 2nd trip.
	function startMinute(log: DayTripLog): number | null {
		const d = toDate(log.startedAt);
		if (!d) return null;
		const m = d.getHours() * 60 + d.getMinutes();
		return m === 0 ? null : m; // midnight = imported, no real time
	}

	async function scanForDuplicateTrips() {
		scanningDupes = true;
		dupeScanRan = false;
		duplicateGroups = [];
		try {
			const [dogs, allLogs] = await Promise.all([listDogs(), listAllDayTripLogs()]);
			const dogMap = new Map(dogs.map((d) => [d.id, d]));

			// Group every log by dog + calendar day. A dog can legitimately go out twice
			// in a day, so same-day isn't enough — we classify each group below.
			const groups = new Map<string, DayTripLog[]>();
			for (const log of allLogs) {
				const day = toDateString(log.startedAt)?.slice(0, 10) ?? 'no-date';
				const key = `${log.dogId}|${day}`;
				const list = groups.get(key) ?? [];
				list.push(log);
				groups.set(key, list);
			}

			const dupes: DuplicateGroup[] = [];
			for (const logs of groups.values()) {
				if (logs.length < 2) continue;
				const dog = dogMap.get(logs[0].dogId);
				if (!dog) continue;
				logs.sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0));

				// Likely a true duplicate when two logs share the same start time (or both
				// lack one) AND the same notes — i.e. there's no sign of a separate outing.
				let likelyDuplicate = false;
				for (let i = 0; i < logs.length && !likelyDuplicate; i++) {
					for (let j = i + 1; j < logs.length; j++) {
						const sameTime = startMinute(logs[i]) === startMinute(logs[j]);
						const sameNotes =
							(logs[i].tripNotes ?? '').trim().toLowerCase() ===
							(logs[j].tripNotes ?? '').trim().toLowerCase();
						if (sameTime && sameNotes) { likelyDuplicate = true; break; }
					}
				}

				dupes.push({ dogId: dog.id, dogName: dog.name, logs, likelyDuplicate });
			}

			// Likely duplicates first, then alphabetical
			dupes.sort((a, b) =>
				a.likelyDuplicate !== b.likelyDuplicate
					? (a.likelyDuplicate ? -1 : 1)
					: a.dogName.localeCompare(b.dogName)
			);
			duplicateGroups = dupes;
			dupeScanRan = true;
			if (dupes.length === 0) toast.success('No same-day trips found.');
		} catch (e) {
			toast.error('Scan failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			scanningDupes = false;
		}
	}

	function tripTimeLabel(log: DayTripLog): string {
		const s = toDate(log.startedAt);
		if (!s) return '';
		const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
		if (s.getHours() === 0 && s.getMinutes() === 0) return 'imported (no time)';
		const e = toDate(log.endedAt);
		return e && !(e.getHours() === 0 && e.getMinutes() === 0) ? `${fmt(s)}–${fmt(e)}` : fmt(s);
	}

	async function deleteDuplicateTrip(group: DuplicateGroup, log: DayTripLog) {
		deletingDupeId = log.id;
		try {
			await deleteDayTripLog(group.dogId, log.id);
			duplicateGroups = duplicateGroups
				.map((g) =>
					g === group ? { ...g, logs: g.logs.filter((l) => l.id !== log.id) } : g
				)
				.filter((g) => g.logs.length > 1);
			toast.success(`Deleted duplicate for ${group.dogName}.`);
		} catch (e) {
			toast.error('Delete failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			deletingDupeId = null;
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
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Fix misattributed trip years</h3>
						<p class="section-copy">Finds imported day trip entries where the year was incorrectly assigned. Suspects have the same start and end timestamp and exist in the current year alongside older trips for the same dog.</p>
					</div>
					<button class="action-btn" type="button" on:click={scanForBadTripYears} disabled={scanningTrips}>
						{scanningTrips ? 'Scanning…' : 'Scan'}
					</button>
				</div>
				{#if tripScanRan && tripYearSuspects.length === 0}
					<p class="empty-note">No suspicious entries found.</p>
				{/if}
				{#if tripYearSuspects.length > 0}
					<ul class="change-list">
						{#each tripYearSuspects as suspect}
							{@const d = toDate(suspect.log.startedAt)}
							<li class="change-item">
								<div class="change-main">
									<p class="change-name">{suspect.dogName}</p>
									<p class="change-detail">
										{d ? d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : '?'}
										{suspect.log.tripNotes ? `· "${suspect.log.tripNotes.slice(0, 60)}…"` : ''}
									</p>
								</div>
								<div class="repair-actions">
									<button
										class="action-btn action-btn-small"
										type="button"
										disabled={fixingTripId === suspect.log.id}
										on:click={() => fixTripYear(suspect)}
									>Shift to {(d?.getFullYear() ?? 0) - 1}</button>
									<button
										class="action-btn action-btn-small action-btn-danger"
										type="button"
										disabled={fixingTripId === suspect.log.id}
										on:click={() => deleteSuspectTrip(suspect)}
									>Delete</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="admin-card">
				<div class="card-header">
					<div>
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Find duplicate day trips</h3>
						<p class="section-copy">Lists every dog with two or more trips on the same day. Sets where the times and notes match are flagged as <strong>likely duplicate</strong>; sets with different start times are probably real separate outings. Check the times before deleting.</p>
					</div>
					<button class="action-btn" type="button" on:click={scanForDuplicateTrips} disabled={scanningDupes}>
						{scanningDupes ? 'Scanning…' : 'Scan'}
					</button>
				</div>
				{#if dupeScanRan && duplicateGroups.length === 0}
					<p class="empty-note">No same-day trips found.</p>
				{/if}
				{#if duplicateGroups.length > 0}
					<ul class="change-list">
						{#each duplicateGroups as group}
							{@const d = toDate(group.logs[0].startedAt)}
							<li class="dupe-group">
								<p class="change-name">
									{group.dogName}
									<span class="dupe-day">{d ? d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : '?'}</span>
									{#if group.likelyDuplicate}
										<span class="dupe-flag dupe-flag-dup">likely duplicate</span>
									{:else}
										<span class="dupe-flag dupe-flag-sep">separate times</span>
									{/if}
								</p>
								{#each group.logs as log}
									<div class="dupe-row">
										<div class="change-main">
											<p class="change-detail">
												<span class="dupe-time">{tripTimeLabel(log)}</span>
												{#if log.volunteerName}· {log.volunteerName}{/if}
												{log.tripNotes ? `· "${log.tripNotes.slice(0, 44)}…"` : '· (no notes)'}
											</p>
										</div>
										<button
											class="action-btn action-btn-small action-btn-danger"
											type="button"
											disabled={deletingDupeId === log.id}
											on:click={() => deleteDuplicateTrip(group, log)}
										>Delete</button>
									</div>
								{/each}
							</li>
						{/each}
					</ul>
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
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span class="field-label">Delete (duplicate)</span>
						<select class="field-select" bind:value={mergeDeleteId} disabled={merging}>
							<option value="">— select dog to delete —</option>
							{#each allDogs.filter((d) => d.id !== mergeKeepId) as dog}
								<option value={dog.id}>{dog.name}</option>
							{/each}
						</select>
					</label>
				</div>

				{#if mergeValid && !mergeConfirm}
					<div class="merge-preview">
						<p class="merge-preview-text">
							All feeding logs, stool logs, bath logs, behavioral notes, and day trip logs from
							<strong>{mergeDeleteDog?.name}</strong> will be moved to <strong>{mergeKeepDog?.name}</strong>,
							then <strong>{mergeDeleteDog?.name}</strong> will be permanently deleted.
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

	.action-btn-small {
		min-height: 1.8rem;
		padding: 0.28rem 0.6rem;
		font-size: 0.72rem;
		border-radius: 0.5rem;
	}

	.action-btn-danger {
		border-color: #9e2929;
		background: linear-gradient(180deg, #d95050 0%, #b83232 100%);
		box-shadow: 0 6px 12px rgba(180, 40, 40, 0.18);
	}

	.repair-actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.dupe-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.5rem 0;
	}

	.dupe-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding-left: 0.6rem;
	}

	.dupe-day {
		margin-left: 0.4rem;
		font-weight: 600;
		color: #55708a;
	}

	.dupe-flag {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0.04rem 0.4rem;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.dupe-flag-dup {
		background: rgba(207, 75, 75, 0.14);
		color: #b83232;
	}

	.dupe-flag-sep {
		background: rgba(1, 107, 165, 0.12);
		color: #016aa5;
	}

	.dupe-time {
		font-weight: 700;
		color: #2e3845;
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
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	background: rgba(220, 245, 225, 0.9);
	-webkit-backdrop-filter: blur(4px);
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
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	background: rgba(255, 245, 220, 0.88);
	-webkit-backdrop-filter: blur(4px);
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
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
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
