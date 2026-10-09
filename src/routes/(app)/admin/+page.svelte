<script lang="ts">
	import toast from 'svelte-french-toast';
	import { listUserProfiles, updateUserProfile, setUserApproved, isProfileApproved } from '$lib/data/users';
	import { formatPhoneNumber, normalizePhoneNumber } from '$lib/utils/phone';
	import { authProfile, authReady, authUser } from '$lib/stores/auth';
	import type { Dog, UserProfile, UserRole } from '$lib/types';
	import { formatDate, formatDateTime, toDate } from '$lib/utils/dates';
	import { listDogs, mergeDogs, updateDog } from '$lib/data/dogs';
	import { matchDogOnDate, wasInShelterOn } from '$lib/utils/dogs';
	import CheckList from '$lib/components/admin/CheckList.svelte';
	import { listFosterEvents } from '$lib/data/syncEvents';
	import { fosterRepairCandidates, type FosterRepairCandidate } from '$lib/utils/fosterRepair';
	import { checkDeparture, findByCode, matchFromFeed, type AsmFeedAnimal } from '$lib/utils/departureCheck';
	import { listDogGroups, saveDogGroup, deleteDogGroup } from '$lib/data/dogGroups';
	import type { DogGroup } from '$lib/types';
	import { adoptionStays, turnaroundByMonth, turnaroundWindows } from '$lib/utils/adoptionTurnaround';

	type EditableUser = UserProfile & {
		draftDisplayName: string;
		draftRole: UserRole;
		draftPhone: string;
	};

	const roleOptions: UserRole[] = ['admin', 'manager', 'coordinator', 'staff', 'volunteer'];

	let dogGroups: DogGroup[] = [];
	let groupName = '';
	let groupDogNames = '';
	let groupBusy = false;
	let groupError = '';

	async function loadDogGroups() {
		groupError = '';
		try {
			dogGroups = await listDogGroups();
			if (!allDogsLoaded) {
				allDogs = await listDogs();
				allDogsLoaded = true;
			}
		} catch (error) {
			console.error(error);
			groupError = error instanceof Error ? error.message : 'Could not load groups.';
		}
	}

	/** Resolves the typed names to dogs, so a typo is caught here rather than silently. */
	function matchGroupDogs(input: string) {
		const wanted = input.split(/[,\n]/).map((n) => n.trim()).filter(Boolean);
		const found: Dog[] = [];
		const missing: string[] = [];
		for (const name of wanted) {
			const dog = allDogs.find((d) => d.name.toLowerCase() === name.toLowerCase());
			if (dog) found.push(dog);
			else missing.push(name);
		}
		return { found, missing };
	}

	$: groupMatch = matchGroupDogs(groupDogNames);

	async function addGroup() {
		if (!groupName.trim() || groupMatch.found.length === 0) return;
		groupBusy = true;
		try {
			await saveDogGroup({ name: groupName, dogIds: groupMatch.found.map((d) => d.id) });
			groupName = '';
			groupDogNames = '';
			await loadDogGroups();
			toast.success('Group saved.');
		} catch (error) {
			console.error(error);
			toast.error('Could not save that group.');
		} finally {
			groupBusy = false;
		}
	}

	async function removeGroup(group: DogGroup) {
		groupBusy = true;
		try {
			await deleteDogGroup(group.id);
			dogGroups = dogGroups.filter((g) => g.id !== group.id);
		} catch (error) {
			console.error(error);
			toast.error('Could not delete that group.');
		} finally {
			groupBusy = false;
		}
	}

	let users: EditableUser[] = [];
	let usersLoaded = false;
	let usersLoading = false;
	let usersError = '';
	let savingUserId: string | null = null;

	// One-time backfill: archived dogs missing a departure date
	type DateFix = { dog: Dog; date: string; source: string; status: Dog['status']; byName: boolean; shelterCode?: string };
	type DateUnknown = { dog: Dog; manualDate: string; reason: string | null; code: string };
	let backfillRunning = false;
	let backfillRan = false;
	let backfillMatched: DateFix[] = [];
	let backfillSelected: string[] = [];
	let backfillStillHere: { dog: Dog; label: string }[] = [];
	let backfillProgress = '';
	let backfillUnknown: DateUnknown[] = [];
	let backfillApplying = false;
	let backfillFixingId: string | null = null;
	/** What ASM returned on the last dry run, so a typed shelter code is matched without asking again. */
	let asmFeed: AsmFeedAnimal[] = [];

	async function loadAsmFeed() {
		const token = await $authUser?.getIdToken();
		const res = await fetch('/api/asm/departure-check', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify({ from: `${new Date().getFullYear()}-01-01` })
		});
		if (!res.ok) throw new Error(`ASM lookup failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
		const data = (await res.json()) as { animals: AsmFeedAnimal[] };
		asmFeed = data.animals;
	}

	/** Looks queries (shelter codes or names) up on ASM's website, which covers every animal. */
	let asmSearchProblem: string | null = null;
	async function searchAsm(queries: string[]): Promise<AsmFeedAnimal[]> {
		const token = await $authUser?.getIdToken();
		const out: AsmFeedAnimal[] = [];
		for (let i = 0; i < queries.length; i += 25) {
			const res = await fetch('/api/asm/departure-check', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
				body: JSON.stringify({ search: queries.slice(i, i + 25) })
			});
			if (!res.ok) throw new Error(`ASM search failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
			const data = (await res.json()) as { animals: AsmFeedAnimal[]; problem: string | null };
			out.push(...data.animals);
			if (data.problem) asmSearchProblem = data.problem;
		}
		return out;
	}

	$: notFoundReason = asmSearchProblem
		? `Couldn't search ASM: ${asmSearchProblem}`
		: 'ASM has no dog with this shelter code or name.';

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

	$: stays = adoptionStays(allDogs);
	$: turnaround = turnaroundWindows(stays);
	$: turnaroundMonths = turnaroundByMonth(stays);

	function formatDays(days: number | null) {
		if (days === null) return '—';
		const rounded = Math.round(days * 10) / 10;
		return `${rounded} day${rounded === 1 ? '' : 's'}`;
	}

	$: mergeKeepDog = allDogs.find((d) => d.id === mergeKeepId) ?? null;
	$: mergeDeleteDog = allDogs.find((d) => d.id === mergeDeleteId) ?? null;
	$: mergeValid = mergeKeepId && mergeDeleteId && mergeKeepId !== mergeDeleteId;

	// #dog-staff backfill: past baths and yard time (thread replies included), read and
	// written the way the live Slack poll does. Dry run first; every row starts ticked.
	// Feedings and surgery lists are not backfilled.
	type StaffKind = 'surgery' | 'bath' | 'yard' | 'feeding';
	type StaffRow = { key: string; kind: StaffKind; at: string; author: string; text: string; summary: string; uncertain: string[] };
	type StaffResult = {
		scanned: number;
		rows: StaffRow[];
		alreadyLogged: Record<StaffKind, number>;
		written: Record<StaffKind, number>;
		truncated: boolean;
		threadsSkipped: number;
		skipped?: string;
	};
	const STAFF_KIND_LABELS: Record<StaffKind, string> = { feeding: 'Feedings', surgery: 'Surgery lists', bath: 'Baths', yard: 'Yard time' };
	const STAFF_KIND_ORDER: StaffKind[] = ['bath', 'yard'];
	let staffSince = '2026-03-01';
	let staffKinds: StaffKind[] = ['bath', 'yard'];
	let staffBusy = false;
	let staffWasDryRun = true;
	let staffResult: StaffResult | null = null;
	let staffKeep: string[] = [];

	function toggleStaffKind(kind: StaffKind) {
		staffKinds = staffKinds.includes(kind) ? staffKinds.filter((k) => k !== kind) : [...staffKinds, kind];
	}

	async function runStaffBackfill(dryRun: boolean) {
		if (staffBusy) return;
		staffBusy = true;
		try {
			const token = await $authUser?.getIdToken();
			const res = await fetch('/api/slack/staff-backfill', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
				body: JSON.stringify({ since: staffSince, dryRun, kinds: staffKinds, ...(dryRun ? {} : { keep: staffKeep }) })
			});
			if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
			staffResult = await res.json();
			staffWasDryRun = dryRun;
			if (staffResult?.skipped) toast.error('Slack is not configured for #dog-staff.');
			else if (dryRun) staffKeep = (staffResult?.rows ?? []).filter((r) => r.uncertain.length === 0).map((r) => r.key);
			else {
				const w = staffResult?.written;
				toast.success(`Logged ${w?.bath ?? 0} baths, ${w?.yard ?? 0} yard times.`);
			}
		} catch (e) {
			toast.error('Backfill failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			staffBusy = false;
		}
	}

	function toggleStaffRow(key: string) {
		staffKeep = staffKeep.includes(key) ? staffKeep.filter((k) => k !== key) : [...staffKeep, key];
	}

	// Foster-return repair: before foster returns had their own stamp, coming back from
	// foster reset shelterSince (the length of stay). Dry run lists them; nothing is
	// written until applied, and only the ticked ones.
	let frRunning = false;
	let frRan = false;
	let frApplying = false;
	let frCandidates: FosterRepairCandidate[] = [];
	let frSelected: string[] = [];

	async function runFosterRepairDryRun() {
		frRunning = true;
		try {
			const [dogs, events] = await Promise.all([listDogs(), listFosterEvents()]);
			frCandidates = fosterRepairCandidates(dogs, events);
			// A recorded foster is ticked; a guess from the dates waits for a person.
			frSelected = frCandidates.filter((c) => c.confident).map((c) => c.dog.id);
			frRan = true;
		} catch (e) {
			toast.error('Dry run failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			frRunning = false;
		}
	}

	function toggleFosterRepair(id: string) {
		frSelected = frSelected.includes(id) ? frSelected.filter((x) => x !== id) : [...frSelected, id];
	}

	async function applyFosterRepair() {
		if (frApplying) return;
		frApplying = true;
		let done = 0;
		try {
			for (const c of frCandidates.filter((x) => frSelected.includes(x.dog.id))) {
				// The overwritten date was the return; the stay counts from intake again.
				await updateDog(c.dog.id, { fosterReturnedAt: c.returnedAt, shelterSince: null });
				done++;
			}
			frCandidates = frCandidates.filter((c) => !frSelected.includes(c.dog.id));
			frSelected = [];
			toast.success(`Repaired ${done} dog${done === 1 ? '' : 's'}.`);
		} catch (e) {
			toast.error('Stopped after an error: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			frApplying = false;
		}
	}

	// Slack playgroup backfill: the live poll only reaches two days back, so older
	// playgroups are pulled in from here. Dry run first; queueing needs a second click.
	type PlaygroupBackfill = {
		scanned: number;
		toQueue: number;
		alreadyQueued: number;
		queued: number;
		truncated: boolean;
		samples: { slackTs: string; dogNames: string[]; outcome: string; text: string }[];
		skipped?: string;
	};
	let pgSince = '2026-03-01';
	let pgBusy = false;
	let pgResult: PlaygroupBackfill | null = null;
	// The review list at the top of the page; reloaded after a backfill adds to it.
	let checkList: CheckList | undefined;
	let checkCount = 0;

	type AdminTab = 'check' | 'stats' | 'users' | 'groups' | 'cleanup';
	const TAB_KEY = 'admin-tab';
	const TABS: AdminTab[] = ['check', 'stats', 'users', 'groups', 'cleanup'];
	let tab: AdminTab = 'check';
	try {
		const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
		if (saved && (TABS as string[]).includes(saved)) tab = saved as AdminTab;
	} catch {
		/* storage blocked: start on the first tab */
	}
	function showTab(next: AdminTab) {
		tab = next;
		try {
			localStorage.setItem(TAB_KEY, next);
		} catch {
			/* not remembered, that's all */
		}
	}
	$: awaitingApprovalCount = users.filter((u) => !isProfileApproved(u)).length;
	let pgWasDryRun = true;
	// Review edits on the dry run, like the Playgroups page's own review: names removed
	// from one message, names removed from every message, and messages skipped outright.
	let pgRemoved: Record<string, string[]> = {};
	let pgRemovedEverywhere: string[] = [];
	let pgSkipped: string[] = [];

	const nameKey = (name: string) => name.toLowerCase();

	const slackDate = (ts: string) => new Date(Number(ts) * 1000);

	// Names repeat, so each is matched to the dog at the shelter when the message was posted.
	function pgNameState(name: string, when: Date): 'matched' | 'archived' | 'unmatched' {
		const dog = matchDogOnDate(name, allDogs, when);
		if (!dog) return 'unmatched';
		return wasInShelterOn(dog, when) || dog.status === 'active' ? 'matched' : 'archived';
	}

	// Read by the template, so it has to be reactive state rather than a function call:
	// Svelte would not re-render a call whose arguments did not change.
	$: pgRemovedSet = new Set([
		...pgRemovedEverywhere.map((n) => `*|${n}`),
		...Object.entries(pgRemoved).flatMap(([ts, names]) => names.map((n) => `${ts}|${n}`))
	]);
	const pgIsRemoved = (removed: Set<string>, ts: string, name: string) =>
		removed.has(`*|${nameKey(name)}`) || removed.has(`${ts}|${nameKey(name)}`);

	// Same for the colour of each name, which depends on the dog list.
	$: pgStates = new Map(
		(pgResult?.samples ?? []).flatMap((s) =>
			s.dogNames.map((n) => [`${s.slackTs}|${nameKey(n)}`, allDogs.length ? pgNameState(n, slackDate(s.slackTs)) : 'unmatched'])
		)
	);

	function pgToggleName(ts: string, name: string) {
		const key = nameKey(name);
		if (pgRemovedEverywhere.includes(key)) {
			pgRemovedEverywhere = pgRemovedEverywhere.filter((n) => n !== key);
			return;
		}
		const list = pgRemoved[ts] ?? [];
		pgRemoved = { ...pgRemoved, [ts]: list.includes(key) ? list.filter((n) => n !== key) : [...list, key] };
	}

	function pgToggleEverywhere(name: string) {
		const key = nameKey(name);
		pgRemovedEverywhere = pgRemovedEverywhere.includes(key)
			? pgRemovedEverywhere.filter((n) => n !== key)
			: [...pgRemovedEverywhere, key];
	}

	function pgToggleSkip(ts: string) {
		pgSkipped = pgSkipped.includes(ts) ? pgSkipped.filter((t) => t !== ts) : [...pgSkipped, ts];
	}

	// Recomputed whenever an edit changes, so the counts and the button stay honest.
	$: pgKept = (pgResult?.samples ?? [])
		.filter((s) => !pgSkipped.includes(s.slackTs))
		.map((s) => ({
			slackTs: s.slackTs,
			dogNames: s.dogNames.filter(
				(n) => !pgRemovedEverywhere.includes(nameKey(n)) && !(pgRemoved[s.slackTs] ?? []).includes(nameKey(n))
			)
		}))
		.filter((s) => s.dogNames.length > 0);

	// Names that are not a dog in the app, with how often each appears: usually staff
	// names or ordinary words the parser took for a name. One click removes one everywhere.
	$: pgUnmatched = (() => {
		const counts = new Map<string, { name: string; count: number }>();
		for (const s of pgResult?.samples ?? []) {
			for (const n of s.dogNames) {
				if (allDogs.length === 0 || pgNameState(n, slackDate(s.slackTs)) !== 'unmatched') continue;
				const entry = counts.get(nameKey(n)) ?? { name: n, count: 0 };
				entry.count++;
				counts.set(nameKey(n), entry);
			}
		}
		return [...counts.values()].sort((a, b) => b.count - a.count);
	})();

	async function runPlaygroupBackfill(dryRun: boolean) {
		if (pgBusy) return;
		pgBusy = true;
		try {
			const token = await $authUser?.getIdToken();
			const res = await fetch('/api/slack/playgroup-backfill', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
				body: JSON.stringify({ since: pgSince, dryRun, ...(dryRun ? {} : { entries: pgKept }) })
			});
			if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
			pgResult = await res.json();
			pgWasDryRun = dryRun;
			if (dryRun) {
				pgRemoved = {};
				pgRemovedEverywhere = [];
				pgSkipped = [];
			}
			if (pgResult?.skipped) toast.error('Slack is not configured for playgroups.');
			else if (!dryRun) {
				toast.success(`Added ${pgResult?.queued ?? 0} to "Check these" at the top of this page.`);
				await checkList?.load();
			}
		} catch (e) {
			toast.error('Playgroup backfill failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			pgBusy = false;
		}
	}

	function slackDay(ts: string) {
		return formatDate(new Date(Number(ts) * 1000));
	}

	// Dry run: every archived dog checked against ASM — the real departure date and
	// outcome from its last movement or death, not the day the sync noticed it was gone.
	// Asked in batches so each request stays inside the server's time limit. Reads only.
	async function runBackfillDryRun() {
		backfillRunning = true;
		backfillRan = false;
		backfillMatched = [];
		backfillSelected = [];
		backfillUnknown = [];
		backfillStillHere = [];
		try {
			const dogs = (await listDogs()).filter(
				(d) => d.status === 'adopted' || d.status === 'transferred' || d.status === 'euthanized'
			);
			backfillProgress = 'Loading departures from ASM…';
			asmSearchProblem = null;
			await loadAsmFeed();
			// Anything ASM's lists don't show (a death older than a month, mostly) is searched
			// for on ASM's website by shelter code, or by name when there is no code.
			const missing = dogs.filter((d) => !matchFromFeed(d, asmFeed));
			if (missing.length > 0) {
				backfillProgress = `Searching ASM for ${missing.length} more dog${missing.length === 1 ? '' : 's'}…`;
				const extra = await searchAsm(missing.map((d) => d.asmShelterCode?.trim() || d.name));
				const known = new Set(asmFeed.map((a) => a.id));
				asmFeed = [...asmFeed, ...extra.filter((a) => !known.has(a.id))];
			}
			if (asmSearchProblem) toast.error(`Couldn't search ASM's website: ${asmSearchProblem}`, { duration: 9000 });
			for (const dog of dogs) {
				const dep = matchFromFeed(dog, asmFeed) ?? { found: false, movementType: null, movementDate: null, deceasedDate: null, missReason: notFoundReason };
				const result = checkDeparture(dog, dep);
				if (result.kind === 'fix') {
					backfillMatched = [...backfillMatched, { dog, date: result.date, source: result.reason, status: result.status, byName: result.byName }];
				} else if (result.kind === 'still-here') {
					backfillStillHere = [...backfillStillHere, { dog, label: result.label }];
				} else if (result.kind === 'not-found' && !toDate(dog.leftShelterDate)) {
					// Not in ASM and no date on record — pre-fill with the day the sync
					// archived the dog (usually within a day of the real departure). Editable.
					const archivedAt = toDate(dog.lastSyncedAt);
					const approx = archivedAt
						? `${archivedAt.getFullYear()}-${String(archivedAt.getMonth() + 1).padStart(2, '0')}-${String(archivedAt.getDate()).padStart(2, '0')}`
						: '';
					backfillUnknown = [...backfillUnknown, { dog, manualDate: approx, reason: result.reason, code: dog.asmShelterCode ?? '' }];
				}
			}
			backfillMatched.sort((a, b) => a.dog.name.localeCompare(b.dog.name));
			// Name-only matches start unticked: someone should confirm it is the same dog.
			backfillSelected = backfillMatched.filter((f) => !f.byName).map((f) => f.dog.id);
			backfillUnknown.sort((a, b) => a.dog.name.localeCompare(b.dog.name));
			backfillProgress = `Checked all ${dogs.length} archived dogs in ASM.`;
			backfillRan = true;
		} catch (e) {
			toast.error('Dry run failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			backfillRunning = false;
		}
	}

	function toggleBackfill(id: string) {
		backfillSelected = backfillSelected.includes(id) ? backfillSelected.filter((x) => x !== id) : [...backfillSelected, id];
	}

	async function applyBackfillMatches() {
		if (backfillApplying) return;
		const chosen = backfillMatched.filter((f) => backfillSelected.includes(f.dog.id));
		if (chosen.length === 0) return;
		backfillApplying = true;
		let applied = 0;
		try {
			for (const fix of chosen) {
				await updateDog(fix.dog.id, {
					leftShelterDate: toDate(fix.date),
					...(fix.status !== fix.dog.status ? { status: fix.status } : {}),
					// A code typed in by hand is kept, so the next check and the sync find the dog.
					...(fix.shelterCode ? { asmShelterCode: fix.shelterCode } : {})
				});
				applied += 1;
			}
			backfillMatched = backfillMatched.filter((f) => !backfillSelected.includes(f.dog.id));
			backfillSelected = [];
			toast.success(`Updated ${applied} dog${applied === 1 ? '' : 's'} from ASM.`);
		} catch (e) {
			toast.error(`Stopped after ${applied} — ` + (e instanceof Error ? e.message : String(e)));
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

	// Looks the dog up in ASM by a shelter code typed in by hand. A hit moves it to the
	// fixes list above (ticked, since a person named the code); nothing is saved until applied.
	async function lookupByShelterCode(entry: DateUnknown) {
		const code = entry.code.trim();
		if (!code) {
			toast.error('Type the shelter code from ASM first.');
			return;
		}
		backfillFixingId = entry.dog.id;
		try {
			if (asmFeed.length === 0) await loadAsmFeed();
			let dep = findByCode(code, asmFeed);
			if (!dep) {
				asmSearchProblem = null;
				const extra = await searchAsm([code]);
				asmFeed = [...asmFeed, ...extra];
				dep = findByCode(code, extra);
			}
			dep ??= { found: false, movementType: null, movementDate: null, deceasedDate: null, missReason: notFoundReason };
			const result = checkDeparture(entry.dog, dep);
			if (result.kind === 'fix') {
				backfillMatched = [
					...backfillMatched,
					{ dog: entry.dog, date: result.date, source: `Shelter code ${code}. ${result.reason}`, status: result.status, byName: false, shelterCode: code }
				].sort((a, b) => a.dog.name.localeCompare(b.dog.name));
				backfillSelected = [...backfillSelected, entry.dog.id];
				backfillUnknown = backfillUnknown.filter((u) => u.dog.id !== entry.dog.id);
				toast.success(`${entry.dog.name}: found as ${code} — review it in the list above, then apply.`);
			} else if (result.kind === 'still-here') {
				toast.error(`ASM has ${code} ${result.label}, not departed.`);
			} else if (result.kind === 'ok') {
				toast.error(`ASM has ${code}, but no departure or death date on it.`);
			} else {
				backfillUnknown = backfillUnknown.map((u) => (u.dog.id === entry.dog.id ? { ...u, reason: result.reason } : u));
				toast.error(`${code}: ${result.reason ?? notFoundReason}`, { duration: 9000 });
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			backfillFixingId = null;
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

	$: if ($authReady && $authProfile?.role === 'admin' && !pendingLoaded) {
		pendingLoaded = true;
		void loadDogGroups();
	}
	let pendingLoaded = false;

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
		<div class="admin-toolbar">
			<div class="admin-tabs" role="tablist" aria-label="Admin sections">
				<button class={`sort-chip ${tab === 'check' ? 'sort-chip-active' : ''}`} role="tab" aria-selected={tab === 'check'} on:click={() => showTab('check')}>
					Check these{#if checkCount > 0}<span class="tab-count">{checkCount}</span>{/if}
				</button>
				<button class={`sort-chip ${tab === 'stats' ? 'sort-chip-active' : ''}`} role="tab" aria-selected={tab === 'stats'} on:click={() => showTab('stats')}>Stats</button>
				<button class={`sort-chip ${tab === 'users' ? 'sort-chip-active' : ''}`} role="tab" aria-selected={tab === 'users'} on:click={() => showTab('users')}>
					Users{#if awaitingApprovalCount > 0}<span class="tab-count">{awaitingApprovalCount}</span>{/if}
				</button>
				<button class={`sort-chip ${tab === 'groups' ? 'sort-chip-active' : ''}`} role="tab" aria-selected={tab === 'groups'} on:click={() => showTab('groups')}>Dog groups</button>
				<button class={`sort-chip ${tab === 'cleanup' ? 'sort-chip-active' : ''}`} role="tab" aria-selected={tab === 'cleanup'} on:click={() => showTab('cleanup')}>Cleanup tools</button>
			</div>
			<div class="admin-counts">
				<span class="count-chip count-chip-blue">Users: {users.length}</span>
				{#if pendingUserCount > 0}<span class="count-chip count-chip-amber">Unsaved: {pendingUserCount}</span>{/if}
			</div>
		</div>

		<div class="admin-panel-stack" hidden={tab !== 'check'}>
			<CheckList bind:this={checkList} bind:count={checkCount} dogs={allDogs} profile={$authProfile} />
		</div>

		<div class="admin-panel-stack" hidden={tab !== 'stats'}>

			<section class="admin-card panel-sky">
				<div class="card-header">
					<div>
						<p class="section-kicker">Stats</p>
						<h3 class="section-title">Adoption turnaround</h3>
						<p class="section-copy">How long dogs stay before they are adopted.</p>
						<details class="how-it-works"><summary>How it works</summary><p>Days from a dog's latest intake to its adoption, grouped by adoption date. Foster time counts; a dog adopted, returned and adopted again counts its last stay only.</p></details>
					</div>
				</div>

				{#if !allDogsLoaded || allDogs.length === 0}
					<p class="empty-note">Loading dogs…</p>
				{:else}
					<div class="stat-tiles">
						{#each turnaround as w (w.label)}
							<div class="stat-tile">
								<p class="stat-label">{w.label}</p>
								<p class="stat-value">{formatDays(w.medianDays)}</p>
								<p class="stat-sub">
									median · avg {formatDays(w.averageDays)} · {w.count} adoption{w.count === 1 ? '' : 's'}
								</p>
							</div>
						{/each}
					</div>

					<details class="stat-months">
						<summary>By month</summary>
						<table class="stat-table">
							<thead>
								<tr><th scope="col">Month</th><th scope="col">Adoptions</th><th scope="col">Median</th><th scope="col">Average</th></tr>
							</thead>
							<tbody>
								{#each turnaroundMonths as m (m.month.getTime())}
									<tr>
										<th scope="row">{m.month.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</th>
										<td>{m.count}</td>
										<td>{formatDays(m.medianDays)}</td>
										<td>{formatDays(m.averageDays)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</details>
				{/if}
			</section>
		</div>

		<div class="admin-panel-stack" hidden={tab !== 'groups'}>
			<section class="admin-card panel-sage">
				<div class="card-header">
					<div>
						<p class="section-kicker">Names</p>
						<h3 class="section-title">Dog groups</h3>
						<p class="section-copy">One name for several dogs, like “the hat puppies”.</p>
						<details class="how-it-works"><summary>How it works</summary><p>A name that stands for several dogs. Litters get called "the hat puppies" long before anyone types out every name, and a surgery list saying that would otherwise match nobody. Individual nicknames live on each dog's own page.</p></details>
					</div>
				</div>

				{#if groupError}
					<p class="error-note">{groupError}</p>
				{/if}

				<div class="group-form">
					<input class="group-input" placeholder="Group name — e.g. hat puppies" bind:value={groupName} />
					<input class="group-input" placeholder="Dogs, comma separated" bind:value={groupDogNames} />
					<button class="action-btn" type="button" on:click={addGroup}
						disabled={groupBusy || !groupName.trim() || groupMatch.found.length === 0}>
						{groupBusy ? 'Saving…' : 'Add group'}
					</button>
				</div>
				{#if groupDogNames.trim()}
					<p class="group-match">
						Matched {groupMatch.found.length}: {groupMatch.found.map((d) => d.name).join(', ') || 'none'}
						{#if groupMatch.missing.length > 0}
							<span class="group-missing">· not found: {groupMatch.missing.join(', ')}</span>
						{/if}
					</p>
				{/if}

				{#if dogGroups.length === 0}
					<p class="empty-note">No groups yet.</p>
				{:else}
					<ul class="pending-list">
						{#each dogGroups as group (group.id)}
							<li class="pending-item">
								<p class="pending-meta"><strong>{group.name}</strong><span>{group.dogIds.length} dogs</span></p>
								<p class="pending-amount">
									{group.dogIds.map((id) => allDogs.find((d) => d.id === id)?.name ?? id).join(', ')}
								</p>
								<div class="pending-actions">
									<button class="ghost-btn" type="button" on:click={() => removeGroup(group)} disabled={groupBusy}>
										Delete
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

		</div>

		<div class="admin-panel-stack" hidden={tab !== 'users'}>
			<section class="admin-card panel-lilac">
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

		<div class="admin-tools" hidden={tab !== 'cleanup'}>
			<section class="admin-card panel-steel">
				<div class="card-header">
					<div>
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Departure dates and outcomes from ASM</h3>
						<p class="section-copy">Fix departure dates and outcomes using ASM.</p>
						<details class="how-it-works"><summary>How it works</summary><p>Checks every adopted, transferred and deceased dog against ASM — its last movement and date, or its death — and lists each one where the app differs: a wrong date (usually the day the sync noticed rather than the day the dog left) or a wrong outcome. <strong>Nothing changes until you apply, and only ticked dogs.</strong> Reads this year's adoptions and ASM's recent changes, and searches ASM for any dog those don't show.</p></details>
					</div>
					<button class="action-btn" type="button" on:click={runBackfillDryRun} disabled={backfillRunning}>
						{backfillRunning ? 'Checking…' : 'Dry run'}
					</button>
				</div>
				{#if backfillProgress}
					<p class="status-meta">{backfillProgress}</p>
				{/if}
				{#if backfillRan && backfillMatched.length === 0 && backfillUnknown.length === 0 && backfillStillHere.length === 0}
					<p class="empty-note">Every archived dog matches ASM — nothing to fix.</p>
				{/if}
				{#if backfillMatched.length > 0}
					<div class="status-row-plain">
						<span class="status-meta">{backfillMatched.length} dog{backfillMatched.length === 1 ? '' : 's'} where ASM says otherwise:</span>
					</div>
					<ul class="user-list">
						{#each backfillMatched as fix (fix.dog.id)}
							<li class="user-row">
								<label class="user-main fr-row">
									<input type="checkbox" checked={backfillSelected.includes(fix.dog.id)} on:change={() => toggleBackfill(fix.dog.id)} />
									<span>
										<span class="suspect-name">{fix.dog.name}</span>
										<span class="suspect-detail">{fix.source}</span>
									</span>
								</label>
							</li>
						{/each}
					</ul>
					<button class="action-btn backfill-apply" type="button" on:click={applyBackfillMatches} disabled={backfillApplying || backfillSelected.length === 0}>
						{backfillApplying ? 'Applying…' : `Apply ${backfillSelected.length} fix${backfillSelected.length === 1 ? '' : 'es'}`}
					</button>
				{/if}
				{#if backfillStillHere.length > 0}
					<div class="status-row-plain">
						<span class="status-meta">
							{backfillStillHere.length} archived dog{backfillStillHere.length === 1 ? '' : 's'} ASM still has on the
							shelter or in foster — not changed here; check these in ASM:
							{backfillStillHere.map((x) => `${x.dog.name} (${x.label})`).join(', ')}
						</span>
					</div>
				{/if}
				{#if backfillUnknown.length > 0}
					<div class="status-row-plain">
						<span class="status-meta">
							{backfillUnknown.length} dog{backfillUnknown.length === 1 ? '' : 's'} not matched in ASM, so no date from there (the reason is under each name).
							Type a dog's shelter code from ASM and press Find in ASM to pull its real date, or use the
							pre-filled date (the day the sync archived the dog, usually within a day of the real departure) and set individually or all at once.
						</span>
					</div>
					<ul class="user-list">
						{#each backfillUnknown as entry (entry.dog.id)}
							<li class="user-row">
								<div class="user-main">
									<p class="suspect-name">{entry.dog.name}</p>
									<p class="suspect-detail">{entry.dog.status} · {entry.manualDate ? 'approximate date from archive time' : 'no date on record — set by hand'}</p>
									{#if entry.reason}<p class="suspect-detail">{entry.reason}</p>{/if}
								</div>
								<div class="repair-actions">
									<input
										class="field-input backfill-date-input backfill-code-input"
										placeholder="Shelter code"
										aria-label={`ASM shelter code for ${entry.dog.name}`}
										bind:value={entry.code}
										on:keydown={(e) => e.key === 'Enter' && lookupByShelterCode(entry)}
									/>
									<button
										class="ghost-btn action-btn-small"
										type="button"
										disabled={backfillFixingId === entry.dog.id || !entry.code.trim()}
										on:click={() => lookupByShelterCode(entry)}
									>{backfillFixingId === entry.dog.id ? 'Finding…' : 'Find in ASM'}</button>
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

			<section class="admin-card panel-steel">
				<div class="card-header">
					<div>
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Backfill #dog-staff from Slack</h3>
						<p class="section-copy">Log past baths and yard time from #dog-staff.</p>
						<details class="how-it-works"><summary>How it works</summary><p>Reads #dog-staff, thread replies included, from the date below and logs what it finds the way the live Slack poll does: baths and yard time. Anything already logged is left alone, and last-bath / last-yard dates only move forward. <strong>Dry run first — nothing is logged until you apply, and only ticked rows.</strong></p></details>
					</div>
				</div>
				<div class="repair-actions">
					{#each STAFF_KIND_ORDER as k}
						<label class="staff-kind">
							<input type="checkbox" checked={staffKinds.includes(k)} on:change={() => toggleStaffKind(k)} />
							{STAFF_KIND_LABELS[k]}
						</label>
					{/each}
				</div>
				<div class="repair-actions">
					<input type="date" class="field-input backfill-date-input" bind:value={staffSince} max={new Date().toISOString().slice(0, 10)} />
					<button class="action-btn" type="button" on:click={() => runStaffBackfill(true)} disabled={staffBusy || !staffSince || staffKinds.length === 0}>
						{staffBusy && staffWasDryRun ? 'Checking…' : 'Dry run'}
					</button>
				</div>
				{#if staffResult && !staffResult.skipped}
					<div class="status-row-plain">
						<span class="status-meta">
							{#if staffWasDryRun}
								{staffResult.scanned} messages and thread replies since {formatDate(staffSince)}:
								<strong>{staffResult.rows.length}</strong> to log.
								Already logged: {staffResult.alreadyLogged.bath} baths,
								{staffResult.alreadyLogged.yard} yard.
							{:else}
								Logged {staffResult.written.bath} baths,
								{staffResult.written.yard} yard times.
							{/if}
							{#if staffResult.truncated}
								Over 3,000 messages in that range: only the newest were read, so the earliest were
								missed. Pick a later start date.
							{/if}
							{#if staffResult.threadsSkipped > 0}
								{staffResult.threadsSkipped} older thread{staffResult.threadsSkipped === 1 ? '' : 's'} not read
								(too many for one run) — pick a later start date to include them.
							{/if}
						</span>
					</div>
					{#if staffWasDryRun && staffResult.rows.length > 0}
						<div class="repair-actions">
							<button class="ghost-btn action-btn-small" type="button" on:click={() => (staffKeep = (staffResult?.rows ?? []).map((r) => r.key))}>Tick all</button>
							<button class="ghost-btn action-btn-small" type="button" on:click={() => (staffKeep = [])}>Untick all</button>
						</div>
						<ul class="user-list">
							{#each staffResult.rows as r (r.key)}
								<li class="user-row">
									<label class="user-main fr-row">
										<input type="checkbox" checked={staffKeep.includes(r.key)} on:change={() => toggleStaffRow(r.key)} />
										<span>
											<span class="suspect-name"><span class="staff-tag staff-tag-{r.kind}">{STAFF_KIND_LABELS[r.kind]}</span> {formatDate(r.at)} · {r.summary}</span>
											<span class="suspect-detail">{r.author}: “{r.text}”</span>
											{#if r.uncertain.length > 0}
												<span class="suspect-detail staff-unsure">Unsure: {r.uncertain.join(' · ')}</span>
											{/if}
										</span>
									</label>
								</li>
							{/each}
						</ul>
						<button class="action-btn backfill-apply" type="button" on:click={() => runStaffBackfill(false)} disabled={staffBusy || staffKeep.length === 0}>
							{staffBusy ? 'Logging…' : `Log ${staffKeep.length} report${staffKeep.length === 1 ? '' : 's'}`}
						</button>
					{:else if staffWasDryRun}
						<p class="empty-note">Nothing new to log in that range.</p>
					{/if}
				{/if}
			</section>

			<section class="admin-card panel-steel">
				<div class="card-header">
					<div>
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Repair foster returns</h3>
						<p class="section-copy">Stop foster returns from resetting length of stay.</p>
						<details class="how-it-works"><summary>How it works</summary><p>Coming back from foster used to reset the dog's length of stay. This finds those dogs and moves that date to its own "back from foster" stamp, so the stay counts from intake again (a transfer's floor date, if it had one, was already lost). <strong>Nothing changes until you apply, and only ticked dogs.</strong> Guesses from the dates start unticked.</p></details>
					</div>
					<button class="action-btn" type="button" on:click={runFosterRepairDryRun} disabled={frRunning}>
						{frRunning ? 'Checking…' : 'Dry run'}
					</button>
				</div>
				{#if frRan && frCandidates.length === 0}
					<p class="empty-note">No dogs need repairing.</p>
				{:else if frCandidates.length > 0}
					<ul class="user-list">
						{#each frCandidates as c (c.dog.id)}
							<li class="user-row">
								<label class="user-main fr-row">
									<input type="checkbox" checked={frSelected.includes(c.dog.id)} on:change={() => toggleFosterRepair(c.dog.id)} />
									<span>
										<span class="suspect-name">{c.dog.name}{c.confident ? '' : ' · guess'}</span>
										<span class="suspect-detail">{c.reason}. Intake {formatDate(c.dog.intakeDate)}.</span>
									</span>
								</label>
							</li>
						{/each}
					</ul>
					<button class="action-btn backfill-apply" type="button" on:click={applyFosterRepair} disabled={frApplying || frSelected.length === 0}>
						{frApplying ? 'Repairing…' : `Repair ${frSelected.length} dog${frSelected.length === 1 ? '' : 's'}`}
					</button>
				{/if}
			</section>

			<section class="admin-card panel-steel">
				<div class="card-header">
					<div>
						<p class="section-kicker">Data</p>
						<h3 class="section-title">Backfill playgroups from Slack</h3>
						<p class="section-copy">Pull past playgroup reports from Slack into review.</p>
						<details class="how-it-works"><summary>How it works</summary><p>The Slack poll only reaches two days back. This reads the playgroups channel from the date below and adds reports naming dogs to the review list on the Playgroups page. Anything already in that list, reviewed or not, is left alone. <strong>Dry run first — nothing is added until you queue them.</strong></p></details>
					</div>
				</div>
				<div class="repair-actions">
					<input type="date" class="field-input backfill-date-input" bind:value={pgSince} max={new Date().toISOString().slice(0, 10)} />
					<button class="action-btn" type="button" on:click={() => runPlaygroupBackfill(true)} disabled={pgBusy || !pgSince}>
						{pgBusy && pgWasDryRun ? 'Checking…' : 'Dry run'}
					</button>
				</div>
				{#if pgResult && !pgResult.skipped}
					<div class="status-row-plain">
						<span class="status-meta">
							{#if pgWasDryRun}
								{pgResult.scanned} messages since {formatDate(pgSince)}: <strong>{pgResult.toQueue}</strong> to add,
								{pgResult.alreadyQueued} already in the review list.
							{:else}
								Added {pgResult.queued} to “Check these” at the top of this page — confirm each one there to log it.
							{/if}
							{#if pgResult.truncated}
								Over 3,000 messages in that range: only the newest were read, so the earliest
								playgroups were missed. Pick a later start date.
							{/if}
						</span>
					</div>
					{#if pgWasDryRun && pgResult.toQueue > 0}
						<p class="pg-legend">
							Click a name to remove it. <span class="pg-pill pill-matched">Green</span> at the shelter ·
							<span class="pg-pill pill-archived">Amber</span> no longer at the shelter ·
							<span class="pg-pill pill-unmatched">Gray</span> not a dog in the app.
						</p>
						{#if pgUnmatched.length > 0}
							<div class="pg-everywhere">
								<span class="status-meta">Not dogs in the app — remove from every message:</span>
								<div class="pg-pills">
									{#each pgUnmatched as u (u.name)}
										<button
											type="button"
											class={`pg-pill ${pgRemovedEverywhere.includes(nameKey(u.name)) ? 'pill-excluded' : 'pill-unmatched'}`}
											on:click={() => pgToggleEverywhere(u.name)}
											title={pgRemovedEverywhere.includes(nameKey(u.name)) ? 'Click to put back' : 'Click to remove everywhere'}
										>{u.name} ×{u.count}</button>
									{/each}
								</div>
							</div>
						{/if}
						<ul class="user-list">
							{#each pgResult.samples as s (s.slackTs)}
								{@const skipped = pgSkipped.includes(s.slackTs)}
								<li class="user-row" class:pg-skipped={skipped}>
									<div class="user-main">
										<p class="suspect-name">{slackDay(s.slackTs)} · {s.outcome}</p>
										<div class="pg-pills">
											{#each s.dogNames as n (n)}
												<button
													type="button"
													class={`pg-pill ${pgIsRemoved(pgRemovedSet, s.slackTs, n) ? 'pill-excluded' : `pill-${pgStates.get(`${s.slackTs}|${nameKey(n)}`) ?? 'unmatched'}`}`}
													on:click={() => pgToggleName(s.slackTs, n)}
													disabled={skipped}
													title={pgIsRemoved(pgRemovedSet, s.slackTs, n) ? 'Click to put back' : 'Click to remove'}
												>{n}</button>
											{/each}
										</div>
										<p class="suspect-detail">“{s.text}”</p>
									</div>
									<button class="action-btn action-btn-small" type="button" on:click={() => pgToggleSkip(s.slackTs)}>
										{skipped ? 'Include' : 'Skip'}
									</button>
								</li>
							{/each}
						</ul>
						<button
							class="action-btn backfill-apply"
							type="button"
							on:click={() => runPlaygroupBackfill(false)}
							disabled={pgBusy || pgKept.length === 0}
						>
							{pgBusy ? 'Adding…' : `Add ${pgKept.length} to the review list`}
						</button>
					{:else if pgWasDryRun}
						<p class="empty-note">Nothing to add — every playgroup report in that range is already in the review list.</p>
					{/if}
				{/if}
			</section>

			<section class="admin-card panel-steel admin-wide">
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
		</div>
	</section>
{/if}

<style>
	.admin-page {
		display: grid;
		/* minmax(0, …) so the scrolling tab row on phones can't widen the whole column. */
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
		width: 100%;
		max-width: 72rem;
		margin: 0 auto;
	}

	.admin-card {
		border: 1px solid rgba(46, 56, 69, 0.06);
		border-radius: 0.92rem;
		background: #ffffff;
	}

	.admin-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.admin-tabs,
	.admin-counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	/* Same chips as the Dogs page filters. */
	.sort-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2rem;
		border: 1px solid #d2dbe8;
		border-radius: 0.52rem;
		background: #ffffff;
		padding: 0.26rem 0.7rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #2f425b;
		cursor: pointer;
	}

	.sort-chip-active {
		border-color: #2e84b7;
		background: #e8f3ff;
		color: #1e4f72;
	}

	.tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: #3a7eb8;
		color: #ffffff;
		font-size: 0.6rem;
	}

	/* Same as the Dogs page count chips. */
	.count-chip {
		display: inline-flex;
		align-items: center;
		border: 1.5px solid;
		border-radius: 999px;
		padding: 0.18rem 0.6rem;
		font-family: var(--font-typewriter);
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.count-chip-blue {
		background: #e8f4fc;
		color: #016aa5;
		border-color: #7ec2e8;
	}

	.count-chip-amber {
		background: #fff8e5;
		color: #7a6200;
		border-color: #e3cf80;
	}

	.admin-panel-stack {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}

	.admin-tools {
		display: grid;
		gap: 1rem;
		grid-template-columns: minmax(0, 1fr);
	}

	@media (min-width: 60rem) {
		.admin-tools {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	[hidden] {
		display: none !important;
	}

	@media (max-width: 40rem) {
		.admin-tabs {
			flex-wrap: nowrap;
			overflow-x: auto;
			width: 100%;
			padding-bottom: 0.2rem;
		}

		.admin-tabs .sort-chip {
			flex: 0 0 auto;
		}
	}

	.admin-tools {
		align-items: start;
	}

	/* Every tool reads the same way: title, line, how it works, then its controls. */
	.admin-tools .card-header {
		flex-direction: column;
	}

	.admin-tools .backfill-date-input {
		width: auto;
		min-width: 11rem;
	}

	/* The Slack check list is its own component; give it the same panel look. */
	.admin-panel-stack :global(.check-card) {
		border: 1px solid rgba(46, 56, 69, 0.06);
		border-radius: 0.92rem;
		background: linear-gradient(180deg, #f4dde4 0%, #f0d8df 100%);
		padding: 1.15rem 1.3rem;
	}

	.admin-panel-stack :global(.check-kicker) {
		display: none;
	}

	.admin-panel-stack :global(.check-title) {
		margin: 0;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: 1.45rem;
		font-weight: 500;
		color: #2e3845;
	}

	/* Dashboard-style panels: a soft tint per section, no hard border. */
	.panel-sky {
		background: linear-gradient(180deg, #daeaf7 0%, #d4e4f2 100%);
	}

	.panel-lilac {
		background: linear-gradient(180deg, #ece8f3 0%, #e7e3ef 100%);
	}

	.panel-sage {
		background: linear-gradient(180deg, #ddeedd 0%, #d7e9d7 100%);
	}

	.panel-steel {
		background: linear-gradient(180deg, #e6edf4 0%, #dfe7ef 100%);
	}

	.how-it-works {
		margin-top: 0.3rem;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: #4f6377;
	}

	.how-it-works summary {
		cursor: pointer;
		font-weight: 700;
		color: #2e6f9e;
		width: fit-content;
	}

	.how-it-works p {
		margin: 0.35rem 0 0;
		max-width: 64ch;
		line-height: 1.5;
	}

	/* Serif headings, like the Dashboard lists. */
	.section-title {
		margin: 0;
		font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
		font-size: 1.45rem;
		font-weight: 500;
		line-height: 1.1;
		color: #2e3845;
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
		margin: 0.3rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.86rem;
		line-height: 1.5;
		color: #5a7186;
		max-width: 64ch;
	}

	/* The card titles say what each tool is; the small kicker above them only repeated it. */
	.admin-card .section-kicker {
		display: none;
	}

	.role-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

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

	/* One column: cards of uneven height in an auto-fit grid left ragged gaps. */
	.admin-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: minmax(0, 1fr);
	}

	@media (min-width: 60rem) {
		.admin-grid-tools {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.admin-card {
		padding: 1.15rem 1.3rem;
	}

	.admin-wide {
		grid-column: 1 / -1;
		min-width: 0;
	}

	.stat-tiles {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		margin-top: 0.9rem;
	}

	.stat-tile {
		padding: 0.8rem 0.9rem;
		border: 1px solid #d3dfeb;
		border-radius: 0.8rem;
		background: var(--board-sheen);
		font-family: var(--font-ui);
	}

	.stat-label,
	.stat-sub {
		margin: 0;
		font-size: 0.8rem;
		color: #526b81;
	}

	.stat-value {
		margin: 0.2rem 0;
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--ink-main);
		font-variant-numeric: tabular-nums;
	}

	.stat-months {
		margin-top: 0.9rem;
		font-family: var(--font-ui);
		font-size: 0.86rem;
	}

	.stat-months summary {
		cursor: pointer;
		color: var(--marker-blue);
		font-weight: 600;
	}

	.stat-table {
		width: 100%;
		margin-top: 0.5rem;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	.stat-table th,
	.stat-table td {
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid #e3ebf3;
		text-align: right;
		color: var(--ink-main);
	}

	.stat-table th:first-child {
		text-align: left;
		font-weight: 600;
	}

	.stat-table thead th {
		color: #526b81;
		font-weight: 600;
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
		border: 1px solid #016ba5;
		background: #016ba5;
		color: #ffffff;
	}

	.action-btn:hover:not(:disabled) {
		background: #015a8b;
	}

	.ghost-btn {
		border: 1px solid #cad8e6;
		background: #ffffff;
		color: #214866;
	}

	.ghost-btn:hover:not(:disabled) {
		background: #f2f7fb;
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

	.staff-kind {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.86rem;
	}

	.staff-tag {
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
		padding: 0.08rem 0.4rem;
		margin-right: 0.2rem;
		background: #eef3f8;
		color: #214866;
	}

	.staff-tag-feeding { background: #fff4cc; color: #7a4f00; }
	.staff-tag-surgery { background: #fde7e7; color: #9b2c2c; }
	.staff-tag-bath { background: #e3f0fb; color: #1a4f7a; }
	.staff-tag-yard { background: #e9f6ec; color: #256640; }

	.staff-unsure {
		color: #a8501b;
		font-weight: 600;
	}

	.fr-row {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		cursor: pointer;
	}

	.fr-row .suspect-name,
	.fr-row .suspect-detail {
		display: block;
	}

	.pg-legend {
		margin: 0.4rem 0;
		font-size: 0.72rem;
		color: #526b81;
	}

	.pg-everywhere {
		display: grid;
		gap: 0.3rem;
		margin: 0.4rem 0 0.6rem;
	}

	.pg-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0.25rem 0;
	}

	.pg-pill {
		border-radius: 999px;
		padding: 0.14rem 0.5rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		font-family: inherit;
		cursor: pointer;
	}

	.pg-pill:disabled {
		cursor: default;
	}

	.pill-matched {
		background: #e9f6ec;
		color: #256640;
		border: 1px solid #abd5b4;
	}

	.pill-archived {
		background: #fef3e2;
		color: #7a4f10;
		border: 1px solid #f0c87a;
	}

	.pill-unmatched {
		background: #f0f2f5;
		color: #7a8fa6;
		border: 1px solid #c8d3df;
	}

	.pill-excluded {
		background: #f5f5f5;
		color: #b0b0b0;
		border: 1px solid #d4d4d4;
		text-decoration: line-through;
		opacity: 0.6;
	}

	.pg-skipped {
		opacity: 0.45;
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

	.backfill-date-input.backfill-code-input {
		width: 7.5rem;
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
	.pending-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 14px;
	}
	.pending-item {
		border: 1px solid var(--line, #d8d2c4);
		border-radius: 4px;
		padding: 12px 14px;
		display: grid;
		gap: 9px;
	}
	.pending-meta {
		margin: 0;
		display: flex;
		gap: 10px;
		align-items: baseline;
		font-size: 0.78rem;
		color: #6b6459;
	}
	.pending-amount {
		color: #6b6459;
	}
	.group-form {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}
	.group-input {
		flex: 1 1 200px;
		padding: 7px 10px;
		border: 1px solid var(--line, #d8d2c4);
		border-radius: 3px;
		font: inherit;
		font-size: 0.88rem;
	}
	.group-match {
		margin: 0 0 10px;
		font-size: 0.82rem;
		color: #6b6459;
	}
	.group-missing {
		color: #a8501b;
	}
	.pending-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

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
