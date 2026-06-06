<script lang="ts">
	import toast from 'svelte-french-toast';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { firebaseEnabled } from '$lib/firebase/config';
	import { canAccessVolunteers, canEditVolunteers, resolveRole } from '$lib/utils/permissions';
	import { listVolunteers, syncVolunteers, syncIHVVolunteers, clearAllVolunteers, updateVolunteerNotes, updateOrientationDate, updateVolunteerStatus, updateVolunteerEstablished, deleteVolunteer } from '$lib/data/volunteers';
	import type { UserRole, Volunteer, VolunteerOrientationStatus } from '$lib/types';

	let volunteers: Volunteer[] = [];
	let loading = true;
	let loaded = false;

	// ── Type toggle ──
	let volTypeFilter: 'dtv' | 'ihv' = 'dtv';

	// ── Sync ──
	let volSyncing = false;
	let volSyncError = '';

	// ── Card state ──
	let volExpandedId: string | null = null;
	let volNotesDraft: Record<string, string> = {};
	let volOrientationDraft: Record<string, string> = {};
	let volSearch = '';
	let volStatusFilter = 'all';
	let volAwaitingDate = new Set<string>();

	const today = new Date().toISOString().split('T')[0];

	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canView = canAccessVolunteers($authProfile?.role);
	$: canEdit = canEditVolunteers($authProfile?.role);

	$: {
		const canLoad = !firebaseEnabled || ($authReady && Boolean($authUser));
		if (canLoad && !loaded) {
			loaded = true;
			void load();
		}
	}

	async function load() {
		loading = true;
		try {
			volunteers = await listVolunteers();
		} catch {
			toast.error('Unable to load volunteers.');
		} finally {
			loading = false;
		}
	}

	// ── Sync ──
	async function clearAndResync() {
		if (!confirm('This will delete ALL volunteer records and re-sync from the spreadsheet. Are you sure?')) return;
		volSyncing = true;
		volSyncError = '';
		try {
			const deleted = await clearAllVolunteers();
			console.log(`[Volunteers] Cleared ${deleted} records. Re-syncing...`);

			const [dtvRes, ihvRes] = await Promise.all([
				fetch('/api/sheets/volunteers'),
				fetch('/api/sheets/volunteers-ihv')
			]);
			if (!dtvRes.ok) throw new Error(`DTV sheet HTTP ${dtvRes.status}`);
			if (!ihvRes.ok) throw new Error(`IHV sheet HTTP ${ihvRes.status}`);

			const dtvPayload = await dtvRes.json();
			const dtvRows = Array.isArray(dtvPayload) ? dtvPayload : (dtvPayload.rows ?? []);
			const ihvRows = await ihvRes.json();

			await syncVolunteers(dtvRows);
			await syncIHVVolunteers(ihvRows);
			volunteers = await listVolunteers();
			toast.success(`Cleared ${deleted} records and re-synced ${volunteers.length} volunteers.`);
		} catch (e) {
			volSyncError = e instanceof Error ? e.message : String(e);
		} finally {
			volSyncing = false;
		}
	}

	async function syncDTVsFromSheet() {
		volSyncing = true;
		volSyncError = '';
		try {
			const res = await fetch('/api/sheets/volunteers');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const payload = await res.json();
			const rows = Array.isArray(payload) ? payload : (payload.rows ?? []);
			await syncVolunteers(rows);
			volunteers = await listVolunteers();
			toast.success(`Synced.`);
		} catch (e) {
			volSyncError = e instanceof Error ? e.message : String(e);
		} finally {
			volSyncing = false;
		}
	}

	async function syncIHVsFromSheet() {
		volSyncing = true;
		volSyncError = '';
		try {
			const res = await fetch('/api/sheets/volunteers-ihv');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const rows = await res.json();
			await syncIHVVolunteers(rows);
			volunteers = await listVolunteers();
			toast.success(`Synced.`);
		} catch (e) {
			volSyncError = e instanceof Error ? e.message : String(e);
		} finally {
			volSyncing = false;
		}
	}

	// ── Volunteer actions ──
	async function saveNotes(id: string) {
		await updateVolunteerNotes(id, volNotesDraft[id] ?? '');
		volunteers = volunteers.map((v) => v.id === id ? { ...v, internalNotes: volNotesDraft[id] ?? '' } : v);
		toast.success('Notes saved.');
	}

	async function removeVolunteer(id: string) {
		await deleteVolunteer(id);
		volunteers = volunteers.filter((v) => v.id !== id);
	}

	async function changeStatus(id: string, status: VolunteerOrientationStatus) {
		await updateVolunteerStatus(id, status);
		volunteers = volunteers.map((v) => v.id === id ? { ...v, orientationStatus: status } : v);
	}

	async function setIHVActive(id: string, active: boolean) {
		await updateVolunteerEstablished(id, active);
		volunteers = volunteers.map((v) => v.id === id ? { ...v, isEstablished: active } : v);
	}

	function setVolStep(id: string, s: string, orientationDate: string | null | undefined) {
		if (s === 'scheduled') {
			volOrientationDraft[id] = volOrientationDraft[id] ?? orientationDate ?? '';
			volAwaitingDate = new Set([...volAwaitingDate, id]);
			return;
		}
		volAwaitingDate = new Set([...volAwaitingDate].filter((x) => x !== id));
		void changeStatus(id, s as VolunteerOrientationStatus);
	}

	async function confirmScheduled(id: string, date: string) {
		if (!date) return;
		await updateOrientationDate(id, date);
		volunteers = volunteers.map((v) => v.id === id ? { ...v, orientationDate: date, orientationStatus: 'scheduled' } : v);
		volAwaitingDate = new Set([...volAwaitingDate].filter((x) => x !== id));
	}

	async function saveOrientationDate(id: string, date: string) {
		await updateOrientationDate(id, date);
		volunteers = volunteers.map((v) => v.id === id ? { ...v, orientationDate: date || null } : v);
		toast.success('Date saved.');
	}

	// ── Formatters ──
	function formatDate(d: string | null | undefined): string {
		if (!d) return '—';
		const [y, m, day] = d.split('-').map(Number);
		return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	}

	function calendarParts(d: string): { month: string; day: string; weekday: string } {
		const [y, m, day] = d.split('-').map(Number);
		const date = new Date(y, m - 1, day);
		return {
			month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
			day: String(day),
			weekday: date.toLocaleDateString('en-US', { weekday: 'long' })
		};
	}

	function addToCalendar(date: string, names: string[]) {
		const d = date.replace(/-/g, '');
		const [y, mo, day] = date.split('-').map(Number);
		const next = new Date(y, mo - 1, day + 1);
		const dEnd = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
		const params = new URLSearchParams({
			action: 'TEMPLATE',
			text: volTypeFilter === 'ihv' ? 'IHV Training Session' : 'Dog Day Trip Orientation',
			dates: `${d}/${dEnd}`,
			details: names.length ? `Volunteers: ${names.join(', ')}` : ''
		});
		window.open(`https://calendar.google.com/calendar/render?${params}`, '_blank');
	}

	function nameWithInitial(name: string): string {
		const parts = name.trim().split(/\s+/);
		if (parts.length < 2) return parts[0] ?? name;
		return `${parts[0]} ${parts[parts.length - 1][0]}.`;
	}

	function statusLabel(s: VolunteerOrientationStatus, isIHV = false): string {
		if (isIHV) {
			const map: Record<VolunteerOrientationStatus, string> = {
				pending: 'Pending', emailed: 'Point', scheduled: 'Scheduled',
				signed_waiver: 'Computer', answered_no: 'Non-Active', no_showed: 'No-showed'
			};
			return map[s] ?? s;
		}
		const map: Record<VolunteerOrientationStatus, string> = {
			pending: 'Pending', emailed: 'Emailed', scheduled: 'Scheduled',
			signed_waiver: 'Signed Waiver', answered_no: 'Answered No', no_showed: 'No-showed'
		};
		return map[s] ?? s;
	}

	function statusClass(s: VolunteerOrientationStatus): string {
		if (s === 'signed_waiver') return 'vs-green';
		if (s === 'scheduled') return 'vs-blue';
		if (s === 'emailed') return 'vs-yellow';
		if (s === 'no_showed' || s === 'answered_no') return 'vs-red';
		return 'vs-gray';
	}

	// ── Derived ──
	$: volsForType = volunteers.filter((v) => (v.volunteerType ?? 'dtv') === volTypeFilter);

	$: crossRoleEmails = (() => {
		const dtvSet = new Set(volunteers.filter((v) => (v.volunteerType ?? 'dtv') === 'dtv').map((v) => v.email?.toLowerCase()).filter(Boolean));
		const ihvSet = new Set(volunteers.filter((v) => v.volunteerType === 'ihv').map((v) => v.email?.toLowerCase()).filter(Boolean));
		return new Set([...dtvSet].filter((e) => ihvSet.has(e)));
	})();

	$: overdueScheduled = volsForType.filter(
		(v) => !v.isEstablished && v.orientationStatus === 'scheduled' && v.orientationDate && v.orientationDate < today
	);
	$: needsOutreach = volsForType.filter(
		(v) => !v.isEstablished && v.orientationStatus === 'pending'
	);
	$: volAttentionList = [...overdueScheduled, ...needsOutreach];

	$: upcomingOrientations = volsForType
		.filter((v) => v.orientationStatus === 'scheduled' && v.orientationDate && v.orientationDate >= today)
		.sort((a, b) => (a.orientationDate ?? '').localeCompare(b.orientationDate ?? ''));

	$: volFlaggedCount = volsForType.filter((v) => !v.isEstablished && (v.orientationStatus === 'no_showed' || v.orientationStatus === 'answered_no')).length;

	// Scheduled but date hasn't passed = upcoming; overdue = needs attention
	$: upcomingScheduled = (v: typeof volsForType[0]) =>
		!v.isEstablished && !v.isNonActive && v.orientationStatus === 'scheduled' && (!v.orientationDate || v.orientationDate >= today);

	$: filterPills = volTypeFilter === 'ihv'
		? ([
			['all',        'All',         volsForType.length],
			['attention',  'Attention',   volAttentionList.filter((v) => v.volunteerType === 'ihv').length],
			['pending',    'Pending',     volsForType.filter((v) => !v.isEstablished && !v.isNonActive && v.orientationStatus === 'pending').length],
			['scheduled',  'Scheduled',   volsForType.filter(upcomingScheduled).length],
			['established','Active',      volsForType.filter((v) => v.isEstablished).length],
			['nonactive',  'Non-Active',  volsForType.filter((v) => v.isNonActive).length],
		] as [string, string, number][])
		: ([
			['all',          'All',       volsForType.length],
			['attention',    'Attention', volAttentionList.filter((v) => (v.volunteerType ?? 'dtv') === 'dtv').length],
			['pending',      'Pending',   volsForType.filter((v) => !v.isEstablished && v.orientationStatus === 'pending').length],
			['emailed',      'Emailed',   volsForType.filter((v) => !v.isEstablished && v.orientationStatus === 'emailed').length],
			['scheduled',    'Scheduled', volsForType.filter(upcomingScheduled).length],
			['signed_waiver','Signed',    volsForType.filter((v) => !v.isEstablished && v.orientationStatus === 'signed_waiver').length],
			['established',  'DTVs',      volsForType.filter((v) => v.isEstablished).length],
			['flagged',      'Flagged',   volFlaggedCount],
		] as [string, string, number][]);

	const volStatusOrder: Record<VolunteerOrientationStatus, number> = {
		pending: 0, emailed: 1, scheduled: 2, signed_waiver: 3, no_showed: 4, answered_no: 5
	};

	$: filteredVolunteers = volsForType
		.filter((v) => {
			if (v.id === volExpandedId) return true;
			if (volSearch.trim()) {
				const q = volSearch.toLowerCase();
				if (!(v.name + ' ' + (v.email ?? '') + ' ' + (v.phone ?? '')).toLowerCase().includes(q)) return false;
			}
			switch (volStatusFilter) {
				case 'all': return true;
				case 'attention': return volAttentionList.some((a) => a.id === v.id);
				case 'established': return v.isEstablished;
				case 'nonactive': return Boolean(v.isNonActive);
				case 'pending': return !v.isEstablished && !v.isNonActive && v.orientationStatus === 'pending';
				case 'scheduled': return upcomingScheduled(v);
				case 'flagged': return !v.isEstablished && (v.orientationStatus === 'no_showed' || v.orientationStatus === 'answered_no');
				default: return !v.isEstablished && v.orientationStatus === volStatusFilter;
			}
		})
		.sort((a, b) => {
			const aAttn = volAttentionList.some((x) => x.id === a.id);
			const bAttn = volAttentionList.some((x) => x.id === b.id);
			if (aAttn && !bAttn) return -1;
			if (!aAttn && bAttn) return 1;
			if (a.isEstablished && !b.isEstablished) return 1;
			if (!a.isEstablished && b.isEstablished) return -1;
			const ao = volStatusOrder[a.orientationStatus] ?? 99;
			const bo = volStatusOrder[b.orientationStatus] ?? 99;
			if (ao !== bo) return ao - bo;
			if (a.orientationStatus === 'scheduled' && b.orientationStatus === 'scheduled')
				return (a.orientationDate ?? 'zzz').localeCompare(b.orientationDate ?? 'zzz');
			return (a.name ?? '').localeCompare(b.name ?? '');
		});

	// ── Stats ──
	$: dtvCount = volunteers.filter((v) => (v.volunteerType ?? 'dtv') === 'dtv').length;
	$: ihvCount = volunteers.filter((v) => v.volunteerType === 'ihv').length;
	$: activeDTVs = volunteers.filter((v) => (v.volunteerType ?? 'dtv') === 'dtv' && v.isEstablished).length;
	$: activeIHVs = volunteers.filter((v) => v.volunteerType === 'ihv' && v.isEstablished).length;

	function switchType(type: 'dtv' | 'ihv') {
		volTypeFilter = type;
		volStatusFilter = 'all';
		volExpandedId = null;
		volSearch = '';
	}

	const AVATAR_COLORS = ['#016aa5','#3aaf2a','#933980','#cf4b4b','#f29900','#0097a7','#5c6bc0','#26a69a'];

	function avatarColor(name: string): string {
		const code = [...(name ?? 'Z')].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
		return AVATAR_COLORS[code % AVATAR_COLORS.length];
	}

	function initials(name: string): string {
		const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0][0].toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}
</script>

<div class="vp">
{#if !canView}
	<div class="vp-restricted">
		<p class="vp-restricted-title">Manager only</p>
		<p class="vp-restricted-sub">Volunteer management is available to manager and admin accounts.</p>
	</div>
{:else}

	<!-- ── Stat cards + type switcher ── -->
	<div class="vp-top">
		<button class="vp-stat-card vp-stat-dtv" class:vp-stat-active={volTypeFilter === 'dtv'} on:click={() => switchType('dtv')}>
			<span class="vp-stat-type-label">Day Trip Volunteers</span>
			<span class="vp-stat-big">{activeDTVs}</span>
			<span class="vp-stat-total">active · {dtvCount} total</span>
		</button>
		<button class="vp-stat-card vp-stat-ihv" class:vp-stat-active={volTypeFilter === 'ihv'} on:click={() => switchType('ihv')}>
			<span class="vp-stat-type-label">In-House Volunteers</span>
			<span class="vp-stat-big">{activeIHVs}</span>
			<span class="vp-stat-total">active · {ihvCount} total</span>
		</button>
		{#if canEdit}
			<div class="vp-sync-area">
				<button class="vp-sync-btn" on:click={volTypeFilter === 'dtv' ? syncDTVsFromSheet : syncIHVsFromSheet} disabled={volSyncing}>
					{volSyncing ? 'Syncing…' : `Sync ${volTypeFilter === 'dtv' ? 'DTVs' : 'IHVs'}`}
				</button>
				<button class="vp-sync-btn vp-sync-danger" on:click={clearAndResync} disabled={volSyncing}>
					Clear & Re-sync All
				</button>
				{#if volSyncError}<span class="vp-error">{volSyncError}</span>{/if}
			</div>
		{/if}
	</div>

	{#if loading}
		<p class="vp-loading">Loading volunteers…</p>
	{:else}

		<!-- ── Upcoming orientation hero ── -->
		{#if upcomingOrientations.length > 0}
			{@const nextDate = upcomingOrientations[0].orientationDate}
			{@const nextGroup = upcomingOrientations.filter((v) => v.orientationDate === nextDate)}
			{@const laterDates = [...new Set(upcomingOrientations.filter((v) => v.orientationDate !== nextDate).map((v) => v.orientationDate))]}
			{@const cal = calendarParts(nextDate ?? '')}
			<div class="vp-hero" class:vp-hero-ihv={volTypeFilter === 'ihv'}>
				<div class="vp-cal">
					<div class="vp-cal-month">{cal.month}</div>
					<div class="vp-cal-day">{cal.day}</div>
					<div class="vp-cal-weekday">{cal.weekday}</div>
				</div>
				<div class="vp-hero-body">
					<span class="vp-hero-eyebrow">{volTypeFilter === 'ihv' ? 'Next training' : 'Next orientation'}</span>
					<div class="vp-hero-names">
						{#each nextGroup as v}
							<span class="vp-hero-name">{nameWithInitial(v.name)}</span>
						{/each}
					</div>
				</div>
				<button class="vp-cal-btn" on:click={() => addToCalendar(nextDate ?? '', nextGroup.map((v) => nameWithInitial(v.name)))}>
					+ Calendar
				</button>
			</div>
			{#if laterDates.length > 0}
				<div class="vp-upcoming">
					<p class="vp-upcoming-label">Also upcoming</p>
					{#each laterDates as date}
						{@const group = upcomingOrientations.filter((v) => v.orientationDate === date)}
						<div class="vp-upcoming-row">
							<span class="vp-upcoming-date">{formatDate(date)}</span>
							<div class="vp-upcoming-names">
								{#each group as v}<span class="vp-upcoming-chip">{nameWithInitial(v.name)}</span>{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}

		<!-- ── Search + filter pills ── -->
		<div class="vp-controls">
			<input class="vp-search" type="search" placeholder="Search name, email or phone…" bind:value={volSearch} />
			<div class="vp-pills">
				{#each filterPills as [key, label, count]}
					{#if (key !== 'flagged' && key !== 'attention') || count > 0}
						<button
							class="vp-pill"
							class:vp-pill-active={volStatusFilter === key}
							class:vp-pill-flagged={key === 'flagged'}
							class:vp-pill-attention={key === 'attention'}
							on:click={() => volStatusFilter = key}
						>{label}{count > 0 ? ` · ${count}` : ''}</button>
					{/if}
				{/each}
			</div>
		</div>

		<!-- ── Volunteer list ── -->
		{#if volsForType.length === 0}
			<div class="vp-empty-state">
				<p class="vp-empty-title">No {volTypeFilter === 'ihv' ? 'in-house' : 'day trip'} volunteers yet</p>
				<p class="vp-empty-sub">Click "Sync {volTypeFilter === 'dtv' ? 'DTVs' : 'IHVs'}" above to load from the spreadsheet.</p>
			</div>
		{:else if filteredVolunteers.length === 0}
			<p class="vp-empty">No volunteers match this filter.</p>
		{:else}
			<div class="vp-list">
				{#each filteredVolunteers as vol}
					{@const isIHV = vol.volunteerType === 'ihv'}
					{@const isAlert = volAttentionList.some((x) => x.id === vol.id)}
					{@const color = avatarColor(vol.name ?? '')}
					<div class="vp-card" class:vp-card-open={volExpandedId === vol.id} class:vp-card-alert={isAlert}>
						<button class="vp-card-row" on:click={() => {
							const closing = volExpandedId === vol.id;
							volExpandedId = closing ? null : vol.id;
							if (closing) volAwaitingDate = new Set([...volAwaitingDate].filter((x) => x !== vol.id));
							if (volNotesDraft[vol.id] === undefined) volNotesDraft[vol.id] = vol.internalNotes ?? '';
							if (volOrientationDraft[vol.id] === undefined) volOrientationDraft[vol.id] = vol.orientationDate ?? '';
						}}>
							<!-- Avatar -->
							<div class="vp-avatar" style="background:{color}">{initials(vol.name ?? '')}</div>

							<!-- Name + contact -->
							<div class="vp-card-main">
								<span class="vp-card-name">{vol.name || '—'}</span>
								<div class="vp-card-contact">
									{#if vol.email}<span class="vp-card-contact-item">{vol.email}</span>{/if}
									{#if isIHV && vol.phone}<span class="vp-card-contact-sep">·</span><span class="vp-card-contact-item">{vol.phone}</span>{/if}
									{#if !vol.email}<span class="vp-card-warn">Missing email</span>{/if}
								</div>
							</div>

							<!-- Right side -->
							<div class="vp-card-right">
								{#if vol.email && crossRoleEmails.has(vol.email.toLowerCase())}
									<span class="vp-badge-dual">{volTypeFilter === 'dtv' ? 'Also IHV' : 'Also DTV'}</span>
								{/if}
								{#if isAlert}
									{@const reason = overdueScheduled.some((x) => x.id === vol.id)
										? (isIHV ? 'Mark active or no-showed' : 'Orientation passed — follow up')
										: (isIHV
											? (vol.trainingSteps?.trained ? (vol.trainingSteps?.pointPending ? 'Point registration pending' : 'Needs Point registration') : 'Schedule training')
											: 'Never contacted')}
									<span class="vp-alert-dot" title={reason}>!</span>
									<span class="vp-alert-reason">{reason}</span>
								{/if}
								{#if vol.orientationDate && (vol.orientationStatus === 'scheduled' || vol.orientationStatus === 'no_showed')}
									<span class="vp-date-chip">{formatDate(vol.orientationDate)}</span>
								{/if}
								{#if vol.isEstablished}
									<span class="vp-status vs-green">{isIHV ? 'Active' : 'DTV'}</span>
								{:else}
									<span class="vp-status {statusClass(vol.orientationStatus)}">{statusLabel(vol.orientationStatus, isIHV)}</span>
								{/if}
								<span class="vp-chevron">{volExpandedId === vol.id ? '▲' : '▼'}</span>
							</div>
						</button>

						{#if volExpandedId === vol.id}
							<div class="vp-detail">
								<!-- Stepper (edit only) -->
								{#if canEdit}
								{#if isIHV}
									<div class="vp-stepper">
										<button class="vp-step" class:vp-step-active={!vol.isEstablished && vol.orientationStatus === 'pending'} on:click={() => { void setIHVActive(vol.id, false); void changeStatus(vol.id, 'pending'); }}>Pending</button>
										<button class="vp-step" class:vp-step-active={!vol.isEstablished && (vol.orientationStatus === 'scheduled' || volAwaitingDate.has(vol.id))} on:click={() => setVolStep(vol.id, 'scheduled', vol.orientationDate)}>Scheduled</button>
										<button class="vp-step" class:vp-step-active={vol.isEstablished} on:click={() => setIHVActive(vol.id, true)}>Active</button>
									</div>
								{:else if !vol.isEstablished}
									<div class="vp-stepper">
										{#each [['pending','Pending'],['emailed','Emailed'],['scheduled','Scheduled'],['signed_waiver','Signed']] as [s, label]}
											<button
												class="vp-step"
												class:vp-step-active={vol.orientationStatus === s || (s === 'scheduled' && volAwaitingDate.has(vol.id))}
												on:click={() => setVolStep(vol.id, s, vol.orientationDate)}
											>{label}</button>
										{/each}
										{#if vol.orientationStatus === 'no_showed' || vol.orientationStatus === 'answered_no'}
											<span class="vp-status {statusClass(vol.orientationStatus)}">{statusLabel(vol.orientationStatus)}</span>
										{/if}
									</div>
								{/if}

								<!-- Date picker -->
								{#if vol.orientationStatus === 'scheduled' || volAwaitingDate.has(vol.id)}
									<div class="vp-date-row">
										<label class="vp-field-label" for="vp-date-{vol.id}">
											{volAwaitingDate.has(vol.id) ? 'Pick a date to confirm' : (isIHV ? 'Training date' : 'Orientation date')}
										</label>
										<input id="vp-date-{vol.id}" class="vp-date-input" type="date"
											bind:value={volOrientationDraft[vol.id]}
											on:change={() => {
												if (volAwaitingDate.has(vol.id)) {
													confirmScheduled(vol.id, volOrientationDraft[vol.id] ?? '');
												} else {
													saveOrientationDate(vol.id, volOrientationDraft[vol.id] ?? '');
												}
											}}
										/>
									</div>
								{/if}
								{/if}<!-- end canEdit stepper -->

								<!-- Info grid -->
								<div class="vp-info-grid">
									{#if vol.phone}
										<div class="vp-field">
											<span class="vp-field-label">Phone</span>
											<a href="tel:{vol.phone}" class="vp-phone-link">{vol.phone}</a>
										</div>
									{/if}
									{#if vol.submittedAt}
										<div class="vp-field">
											<span class="vp-field-label">Submitted</span>
											<span class="vp-field-val">{vol.submittedAt}</span>
										</div>
									{/if}
									{#if !isIHV && !vol.isEstablished}
										<div class="vp-field">
											<span class="vp-field-label">Driver's license</span>
											<span class="vp-field-val">{vol.hasDriversLicense ? 'Yes' : 'No'}</span>
										</div>
										<div class="vp-field">
											<span class="vp-field-label">18+</span>
											<span class="vp-field-val">{vol.is18Plus ? 'Yes' : 'No'}</span>
										</div>
									{/if}
								</div>

								{#if !isIHV && vol.dogExperience}
									<div class="vp-field">
										<span class="vp-field-label">Dog experience</span>
										<span class="vp-field-val">{vol.dogExperience}</span>
									</div>
								{/if}
								{#if !isIHV && vol.adventurePlans}
									<div class="vp-field">
										<span class="vp-field-label">Adventure plans</span>
										<span class="vp-field-val">{vol.adventurePlans}</span>
									</div>
								{/if}

								<!-- IHV training steps -->
								{#if isIHV && vol.trainingSteps}
									<div class="vp-training">
										<span class="vp-field-label">Training steps</span>
										<div class="vp-training-steps">
											<span class="vp-training-step" class:done={vol.trainingSteps.point} class:pending={!vol.trainingSteps.point && vol.trainingSteps.pointPending}>Point {vol.trainingSteps.point ? '✓' : vol.trainingSteps.pointPending ? '…' : '—'}</span>
											<span class="vp-training-step" class:done={vol.trainingSteps.trained}>Trained {vol.trainingSteps.trained ? '✓' : '—'}</span>
											<span class="vp-training-step" class:done={vol.trainingSteps.computer}>Computer {vol.trainingSteps.computer ? '✓' : '—'}</span>
											<span class="vp-training-step" class:done={vol.trainingSteps.moved}>Moved {vol.trainingSteps.moved ? '✓' : '—'}</span>
										</div>
									</div>
								{/if}

								{#if isIHV && vol.sheetNotes}
									<div class="vp-field">
										<span class="vp-field-label">Sheet notes</span>
										<span class="vp-field-val">{vol.sheetNotes}</span>
									</div>
								{/if}

								<!-- Internal notes -->
								<div class="vp-field">
									<span class="vp-field-label">Internal notes</span>
									{#if canEdit}
										<textarea id="vp-notes-{vol.id}" class="vp-notes" rows="2"
											bind:value={volNotesDraft[vol.id]}
											placeholder="Staff notes…"></textarea>
									{:else}
										<span class="vp-field-val">{vol.internalNotes || '—'}</span>
									{/if}
								</div>

								<!-- Actions (edit only) -->
								{#if canEdit}
								<div class="vp-actions">
									<button class="vp-btn vp-btn-save" on:click={() => saveNotes(vol.id)}>Save notes</button>
									{#if !isIHV && !vol.isEstablished && vol.orientationStatus !== 'no_showed' && vol.orientationStatus !== 'answered_no'}
										<button class="vp-btn vp-btn-flag" on:click={() => changeStatus(vol.id, 'no_showed')}>No-showed</button>
										<button class="vp-btn vp-btn-flag" on:click={() => changeStatus(vol.id, 'answered_no')}>Answered No</button>
									{/if}
									<button class="vp-btn vp-btn-remove" on:click={() => removeVolunteer(vol.id)}>Remove</button>
								</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
{/if}
</div>

<style>
	.vp {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		width: 100%;
	}

	/* ── Restricted ── */
	.vp-restricted { padding: 3rem 1.5rem; text-align: center; }
	.vp-restricted-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 0.4rem; }
	.vp-restricted-sub { font-size: 0.85rem; color: #5f6368; margin: 0; }

	/* ── Top: stat cards + sync ── */
	.vp-top {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 0.6rem;
		align-items: center;
	}

	.vp-stat-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		padding: 0.9rem 1.1rem;
		border-radius: 10px;
		border: 2px solid transparent;
		cursor: pointer;
		text-align: left;
		transition: border-color 120ms, box-shadow 120ms;
	}

	.vp-stat-dtv {
		background: linear-gradient(135deg, #e8f4fd 0%, #d6ecfb 100%);
		border-color: #b8d7ee;
	}

	.vp-stat-dtv:hover, .vp-stat-dtv.vp-stat-active {
		border-color: #016aa5;
		box-shadow: 0 0 0 3px rgba(1, 106, 165, 0.12);
	}

	.vp-stat-ihv {
		background: linear-gradient(135deg, #edf7e8 0%, #ddf2d6 100%);
		border-color: #b8ddb0;
	}

	.vp-stat-ihv:hover, .vp-stat-ihv.vp-stat-active {
		border-color: #3aaf2a;
		box-shadow: 0 0 0 3px rgba(58, 175, 42, 0.12);
	}

	.vp-stat-big {
		font-size: 2.2rem;
		font-weight: 900;
		line-height: 1;
		color: #202124;
		letter-spacing: -0.02em;
	}

	.vp-stat-dtv .vp-stat-big { color: #016aa5; }
	.vp-stat-ihv .vp-stat-big { color: #2a8c1a; }

	.vp-stat-type-label {
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #5f6368;
		margin-bottom: 0.1rem;
	}

	.vp-stat-total {
		font-size: 0.65rem;
		color: #5f6368;
		font-weight: 500;
	}

	.vp-sync-area {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.3rem;
	}

	.vp-sync-btn {
		height: 2rem;
		padding: 0 1rem;
		border: 1px solid #b8d7ee;
		border-radius: 6px;
		background: #fff;
		color: #016aa5;
		font-size: 0.76rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}

	.vp-sync-btn:hover:not(:disabled) { background: #e8f4fd; }
	.vp-sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.vp-sync-danger {
		border-color: #f5c6cb;
		color: #a8200d;
		background: #fff4f3;
	}
	.vp-sync-danger:hover:not(:disabled) { background: #fde0de; }

	.vp-error { font-size: 0.7rem; font-weight: 600; color: #d93025; text-align: right; }
	.vp-loading { font-size: 0.85rem; color: #5f6368; padding: 1rem 0; }
	.vp-empty { font-size: 0.82rem; color: #9aa0a6; text-align: center; padding: 2rem 0; margin: 0; }

	/* ── Empty state ── */
	.vp-empty-state {
		text-align: center;
		padding: 2.5rem 1rem;
		border: 1.5px dashed #dadce0;
		border-radius: 10px;
	}

	.vp-empty-title { font-size: 0.95rem; font-weight: 600; color: #3c4043; margin: 0 0 0.3rem; }
	.vp-empty-sub { font-size: 0.78rem; color: #9aa0a6; margin: 0; }

	/* ── Hero ── */
	.vp-hero {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.85rem 1rem;
		background: linear-gradient(135deg, #f0f6ff 0%, #e8f4fd 100%);
		border: 1px solid #c4dff5;
		border-radius: 10px;
		flex-wrap: wrap;
	}

	.vp-hero-ihv {
		background: linear-gradient(135deg, #f0fbee 0%, #e4f5df 100%);
		border-color: #b8ddb0;
	}

	.vp-cal {
		display: flex;
		flex-direction: column;
		align-items: center;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid #c4dff5;
		min-width: 3.8rem;
		flex-shrink: 0;
		box-shadow: 0 2px 6px rgba(1,106,165,0.12);
	}

	.vp-cal-month {
		width: 100%;
		background: #016aa5;
		color: #fff;
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-align: center;
		padding: 0.22rem 0;
		text-transform: uppercase;
	}

	.vp-hero-ihv .vp-cal-month { background: #3aaf2a; }

	.vp-cal-day {
		background: #fff;
		width: 100%;
		text-align: center;
		font-size: 1.9rem;
		font-weight: 800;
		color: #202124;
		line-height: 1.1;
		padding: 0.1rem 0 0;
	}

	.vp-cal-weekday {
		background: #fff;
		width: 100%;
		text-align: center;
		font-size: 0.48rem;
		font-weight: 600;
		color: #5f6368;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0 0 0.22rem;
	}

	.vp-hero-body { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; min-width: 0; }

	.vp-hero-eyebrow {
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #016aa5;
	}

	.vp-hero-ihv .vp-hero-eyebrow { color: #2a8c1a; }

	.vp-hero-names { display: flex; flex-wrap: wrap; gap: 0.3rem; }

	.vp-hero-name {
		padding: 0.2rem 0.55rem;
		background: rgba(1,106,165,0.1);
		border: 1px solid rgba(1,106,165,0.2);
		border-radius: 999px;
		font-size: 0.76rem;
		font-weight: 600;
		color: #016aa5;
	}

	.vp-hero-ihv .vp-hero-name {
		background: rgba(58,175,42,0.1);
		border-color: rgba(58,175,42,0.2);
		color: #2a8c1a;
	}

	.vp-cal-btn {
		padding: 0.28rem 0.75rem;
		border-radius: 6px;
		border: 1px solid #aecbfa;
		background: #fff;
		font-size: 0.72rem;
		font-weight: 600;
		color: #016aa5;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		margin-left: auto;
	}

	.vp-cal-btn:hover { background: #e8f0fe; }

	.vp-upcoming {
		border: 1px solid #e0eaf5;
		border-radius: 8px;
		overflow: hidden;
	}

	.vp-upcoming-label {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5f6368;
		margin: 0;
		padding: 0.4rem 0.85rem;
		background: #f8f9fa;
		border-bottom: 1px solid #e8edf3;
	}

	.vp-upcoming-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.45rem 0.85rem;
		border-bottom: 1px solid #f1f3f4;
	}

	.vp-upcoming-row:last-child { border-bottom: none; }

	.vp-upcoming-date {
		font-size: 0.74rem;
		font-weight: 700;
		color: #016aa5;
		white-space: nowrap;
		min-width: 8rem;
	}

	.vp-upcoming-names { display: flex; flex-wrap: wrap; gap: 0.3rem; }

	.vp-upcoming-chip { font-size: 0.74rem; color: #202124; font-weight: 500; }
	.vp-upcoming-chip:not(:last-child)::after { content: ','; color: #9aa0a6; }

	/* ── Controls ── */
	.vp-controls {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.vp-search {
		height: 2.1rem;
		border: 1px solid #dadce0;
		border-radius: 6px;
		padding: 0 0.7rem;
		font-size: 0.82rem;
		color: #202124;
		background: #fff;
		width: 13rem;
		flex-shrink: 0;
	}

	.vp-search:focus { outline: none; border-color: #016aa5; box-shadow: 0 0 0 2px rgba(1,106,165,0.12); }

	.vp-pills { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }

	.vp-pill {
		padding: 0.22rem 0.7rem;
		border-radius: 999px;
		border: 1px solid #dadce0;
		background: #fff;
		font-size: 0.72rem;
		font-weight: 500;
		color: #5f6368;
		cursor: pointer;
		white-space: nowrap;
		line-height: 1.4;
	}

	.vp-pill:hover { background: #f1f3f4; color: #202124; }
	.vp-pill-active { background: #016aa5; border-color: #016aa5; color: #fff; }
	.vp-pill-active:hover { background: #015a8e; }
	.vp-pill-attention { border-color: #f9ab00; color: #7a5800; background: #fff8e1; }
	.vp-pill-attention.vp-pill-active { background: #f9ab00; border-color: #f9ab00; color: #fff; }
	.vp-pill-flagged { border-color: #fde68a; color: #b06000; }
	.vp-pill-flagged.vp-pill-active { background: #b06000; border-color: #b06000; color: #fff; }

	/* ── Card list ── */
	.vp-list { display: flex; flex-direction: column; gap: 0.28rem; }

	.vp-card {
		border: 1px solid #e8edf3;
		border-radius: 10px;
		overflow: hidden;
		background: #fff;
		box-shadow: 0 1px 2px rgba(0,0,0,0.04);
		transition: box-shadow 120ms;
	}

	.vp-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
	.vp-card-open { box-shadow: 0 4px 14px rgba(0,0,0,0.10); }
	.vp-card-alert { border-color: #f9ab00; box-shadow: 0 0 0 1.5px #f9ab00; }

	.vp-card-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.85rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.vp-card-row:hover { background: rgba(0,0,0,0.015); }

	/* ── Avatar ── */
	.vp-avatar {
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
		letter-spacing: 0.02em;
	}

	.vp-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.12rem; }

	.vp-card-name {
		font-size: 0.88rem;
		font-weight: 700;
		color: #202124;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.vp-card-contact {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		overflow: hidden;
	}

	.vp-card-contact-item {
		font-size: 0.72rem;
		color: #5f6368;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.vp-card-contact-sep { font-size: 0.65rem; color: #bdc1c6; flex-shrink: 0; }
	.vp-card-warn { font-size: 0.68rem; font-weight: 700; color: #b06000; background: #fff8e1; border: 1px solid #f9ab00; border-radius: 4px; padding: 0.08rem 0.35rem; }

	.vp-card-right { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
	.vp-chevron { font-size: 0.55rem; color: #bdc1c6; }

	.vp-badge-dual {
		display: inline-flex;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 700;
		background: #f3e8ff;
		color: #7c3aed;
		border: 1px solid #ddd6fe;
		white-space: nowrap;
	}

	.vp-alert-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.2rem;
		height: 1.2rem;
		background: #f9ab00;
		color: #fff;
		border-radius: 50%;
		font-size: 0.66rem;
		font-weight: 800;
		flex-shrink: 0;
	}

	.vp-alert-reason { font-size: 0.68rem; font-weight: 600; color: #7a5800; white-space: nowrap; }

	.vp-date-chip {
		font-size: 0.68rem;
		font-weight: 600;
		color: #016aa5;
		background: #e8f0fe;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		white-space: nowrap;
	}

	/* Status pills */
	.vp-status {
		display: inline-flex;
		padding: 0.14rem 0.5rem;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 700;
		white-space: nowrap;
		letter-spacing: 0.01em;
	}

	.vs-green  { background: #dcf2d8; color: #1a6b12; }
	.vs-blue   { background: #dceeff; color: #0b5ea8; }
	.vs-yellow { background: #fff3cc; color: #8a5a00; }
	.vs-red    { background: #fde0de; color: #a8200d; }
	.vs-gray   { background: #f1f3f4; color: #5f6368; }

	/* ── Detail panel ── */
	.vp-detail {
		padding: 0.85rem;
		border-top: 1px solid #f0f3f7;
		background: #f8fafd;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.vp-stepper { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }

	.vp-step {
		padding: 0.26rem 0.75rem;
		border-radius: 6px;
		border: 1.5px solid #dadce0;
		background: #fff;
		font-size: 0.74rem;
		font-weight: 600;
		color: #5f6368;
		cursor: pointer;
	}

	.vp-step:hover { background: #f1f3f4; color: #202124; border-color: #bdc1c6; }

	.vp-step-active {
		border-color: #016aa5;
		background: #016aa5;
		color: #fff;
	}

	.vp-step-active:hover { background: #015a8e; border-color: #015a8e; }

	.vp-date-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }

	.vp-date-input {
		height: 2.1rem;
		border: 1px solid #dadce0;
		border-radius: 6px;
		padding: 0 0.6rem;
		font-size: 0.82rem;
		color: #202124;
		background: #fff;
	}

	.vp-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; }

	.vp-field { display: flex; flex-direction: column; gap: 0.2rem; }

	.vp-field-label {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #9aa0a6;
	}

	.vp-field-val { font-size: 0.8rem; color: #202124; line-height: 1.4; }

	.vp-phone-link { font-size: 0.8rem; color: #016aa5; text-decoration: none; font-weight: 500; }
	.vp-phone-link:hover { text-decoration: underline; }

	/* Training steps */
	.vp-training { display: flex; flex-direction: column; gap: 0.3rem; }
	.vp-training-steps { display: flex; gap: 0.4rem; flex-wrap: wrap; }

	.vp-training-step {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.14rem 0.5rem;
		border-radius: 999px;
		font-size: 0.65rem;
		font-weight: 600;
		background: #f1f3f4;
		color: #9aa0a6;
		border: 1px solid #e8edf3;
	}

	.vp-training-step.done { background: #dcf2d8; color: #1a6b12; border-color: #b8e0b3; }
	.vp-training-step.pending { background: #fff8e1; color: #8a5a00; border-color: #f9d678; }

	/* Notes */
	.vp-notes {
		border: 1px solid #dadce0;
		border-radius: 6px;
		padding: 0.45rem 0.65rem;
		font-size: 0.8rem;
		color: #202124;
		font-family: inherit;
		resize: vertical;
		width: 100%;
		background: #fff;
	}

	.vp-notes:focus { outline: none; border-color: #016aa5; }

	/* Actions */
	.vp-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding-top: 0.3rem;
		border-top: 1px solid #edf1f7;
	}

	.vp-btn {
		display: inline-flex;
		align-items: center;
		height: 2rem;
		border: 1.5px solid #dadce0;
		border-radius: 6px;
		padding: 0 0.9rem;
		background: #fff;
		font-size: 0.76rem;
		font-weight: 600;
		color: #3c4043;
		cursor: pointer;
	}

	.vp-btn:hover:not(:disabled) { background: #f8f9fa; }

	.vp-btn-save { border-color: #3aaf2a; background: #dcf2d8; color: #1a6b12; }
	.vp-btn-save:hover { background: #c9ecbf; }

	.vp-btn-flag { color: #8a5a00; border-color: #f9d678; background: #fff9e6; }
	.vp-btn-flag:hover { background: #fff3cc; }

	.vp-btn-remove { color: #a8200d; border-color: #f5b8b3; background: #fff4f3; }
	.vp-btn-remove:hover { background: #fde0de; }

	/* ── Responsive ── */
	@media (max-width: 640px) {
		.vp-top { grid-template-columns: 1fr 1fr; }
		.vp-sync-area { grid-column: 1 / -1; flex-direction: row; align-items: center; }
		.vp-controls { flex-direction: column; align-items: stretch; }
		.vp-search { width: 100%; }
		.vp-card-row { gap: 0.55rem; }
		.vp-card-right { flex-wrap: wrap; gap: 0.3rem; }
		.vp-alert-reason { display: none; }
		.vp-stepper, .vp-actions, .vp-date-row { flex-direction: column; align-items: stretch; }
		.vp-step, .vp-btn, .vp-date-input { width: 100%; }
		.vp-info-grid { grid-template-columns: 1fr; }
	}
</style>
