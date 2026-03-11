<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import toast from 'svelte-french-toast';
	import { authProfile } from '$lib/stores/auth';
	import { localRole } from '$lib/stores/role';
	import { listDogs, createDog, updateDog } from '$lib/data/dogs';
	import { canEditDogs, resolveRole } from '$lib/utils/permissions';
	import { estimateFoodAmountPerMeal } from '$lib/utils/feeding';
	import type {
		Compatibility,
		Dog,
		DogSex,
		EnergyLevel,
		PottyTrainedStatus,
		UserRole
	} from '$lib/types';

	type IntakeAction = 'create' | 'update' | 'ignore';
	type Confidence = 'high' | 'medium' | 'low';
	type MedicalStatus = 'yes' | 'no' | 'unknown';

	type SuggestionFields = {
		name: string;
		breed: string;
		color: string;
		sex: DogSex;
		origin: string;
		dateOfBirth: string;
		originalIntakeDate: string;
		currentIntakeDate: string;
		reentryDates: string[];
		leftShelterDate: string;
		weightLbs: number | null;
		microchipDate: string;
		pottyTrained: PottyTrainedStatus;
		goodWithDogs: Compatibility;
		goodWithCats: Compatibility;
		goodWithKids: Compatibility;
		goodWithElderly: Compatibility;
		goodOnLead: Compatibility;
		goodTraveller: Compatibility;
		crateTrained: Compatibility;
		idealHome: string;
		energyLevel: EnergyLevel;
		dietaryNotes: string;
		markings: string;
		hiddenComments: string;
		description: string;
		warningNotes: string;
		holdNotes: string;
		outdoorKennelAssignment: string;
		inFosterStatus: MedicalStatus;
		microchippedStatus: MedicalStatus;
		vaccinationStatus: MedicalStatus;
		vaccinatedDate: string;
		fixedStatus: MedicalStatus;
		fixedDate: string;
		surgeryDate: string;
		healthProblems: string;
	};

	type IntakeSuggestion = {
		action: IntakeAction;
		matchName: string;
		confidence: Confidence;
		reason: string;
		fields: SuggestionFields;
	};

	type EditableSuggestion = IntakeSuggestion & {
		id: string;
		selected: boolean;
		matchDogId: string;
		reentryDateDraft: string;
		showAllFields: boolean;
	};

	const pottyOptions: { value: PottyTrainedStatus; label: string }[] = [
		{ value: 'unknown', label: 'Unknown' },
		{ value: 'yes', label: 'Yes' },
		{ value: 'working_on_it', label: 'Working on it' },
		{ value: 'no', label: 'No' }
	];
	const sexOptions: { value: DogSex; label: string }[] = [
		{ value: 'unknown', label: 'Unknown' },
		{ value: 'male', label: 'Male' },
		{ value: 'female', label: 'Female' }
	];
	const compatibilityOptions: { value: Compatibility; label: string }[] = [
		{ value: 'unknown', label: 'Unknown' },
		{ value: 'yes', label: 'Yes' },
		{ value: 'no', label: 'No' }
	];
	const energyOptions: { value: EnergyLevel; label: string }[] = [
		{ value: 'unknown', label: 'Unknown' },
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' },
		{ value: 'very_high', label: 'Very high' }
	];
	const medicalOptions: { value: MedicalStatus; label: string }[] = [
		{ value: 'unknown', label: 'Unknown' },
		{ value: 'yes', label: 'Yes' },
		{ value: 'no', label: 'No' }
	];
	const coreFieldLabels = ['Name', 'Entered shelter date', 'Last entered shelter date', 'In foster status'];

	let dogs: Dog[] = [];
	let loadingDogs = true;

	let file: File | null = null;
	let intakeText = '';
	let previewUrl = '';
	let analyzing = false;
	let applying = false;
	let apiError = '';
	let analysisModel = '';
	let notes: string[] = [];
	let suggestions: EditableSuggestion[] = [];
	let suggestionUpdatePatches: Record<string, Partial<Dog>> = {};

	onMount(async () => {
		await refreshDogs();
	});

	onDestroy(() => {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
	});

	$: role = resolveRole($authProfile, $localRole as UserRole);
	$: canRunIntake = canEditDogs(role);
	$: activeDogs = dogs.filter((dog) => dog.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
	$: selectedCount = suggestions.filter((item) => item.selected && item.action !== 'ignore').length;
	$: suggestionUpdatePatches = Object.fromEntries(
		suggestions.map((suggestion) => [
			suggestion.id,
			suggestion.action === 'update'
				? buildUpdatePatch(suggestion.fields, resolveSuggestionTargetDog(suggestion))
				: {}
		])
	) as Record<string, Partial<Dog>>;

	async function refreshDogs() {
		loadingDogs = true;
		dogs = await listDogs();
		loadingDogs = false;
	}

	function handleFileChange(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const next = target.files?.[0] ?? null;
		setFile(next);
	}

	function setFile(next: File | null) {
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = '';
		}
		file = next;
		if (file) previewUrl = URL.createObjectURL(file);
	}

	function resetAnalysis() {
		suggestions = [];
		notes = [];
		analysisModel = '';
		apiError = '';
		intakeText = '';
	}

	async function analyzePhoto() {
		const hasTextInput = Boolean(cleanText(intakeText));
		if (!file && !hasTextInput) {
			toast.error('Upload a photo or paste profile text first.');
			return;
		}
		analyzing = true;
		apiError = '';
		suggestions = [];
		notes = [];
		analysisModel = '';

		try {
			const formData = new FormData();
			if (file) formData.append('photo', file);
			if (hasTextInput) formData.append('intakeText', intakeText);
			formData.append(
				'existingDogs',
				JSON.stringify(dogs.map((dog) => ({ id: dog.id, name: dog.name })))
			);
			const response = await fetch('/intake', {
				method: 'POST',
				body: formData
			});
			const payload = (await response.json()) as {
				error?: string;
				model?: string;
				notes?: string[];
				suggestions?: IntakeSuggestion[];
			};
			if (!response.ok) {
				throw new Error(payload.error || 'Failed to analyze image.');
			}

			analysisModel = payload.model ?? '';
			notes = Array.isArray(payload.notes) ? payload.notes : [];
			const incoming = Array.isArray(payload.suggestions) ? payload.suggestions : [];
			const hydrated = incoming.map((item, index) => hydrateSuggestion(item, index));
			const deduped = applyDuplicateSuggestionGuard(hydrated);
			const skippedCount = deduped.filter((item) => item.action === 'ignore').length;
			suggestions = deduped.filter((item) => item.action !== 'ignore');
			if (skippedCount > 0) {
				notes = [...notes, `Skipped ${skippedCount} ignored or duplicate suggestion(s).`];
			}

			if (suggestions.length === 0) {
				if (incoming.length > 0 && skippedCount > 0) {
					toast('No actionable suggestions found. Ignored items were skipped.');
				} else {
					toast('No actions suggested. Try a closer or clearer photo.');
				}
			} else {
				toast.success(`Loaded ${suggestions.length} suggestion(s).`);
			}
		} catch (error) {
			console.error(error);
			apiError = error instanceof Error ? error.message : 'Failed to analyze image.';
			toast.error(apiError);
		} finally {
			analyzing = false;
		}
	}

	function hydrateSuggestion(item: IntakeSuggestion, index: number): EditableSuggestion {
		const name = cleanText(item.fields?.name);
		const incomingAction = normalizeAction(item.action);
		const matchByName = findDogByName(cleanText(item.matchName) || name);
		const action: IntakeAction =
			matchByName ? 'update' : incomingAction;
		const reason = cleanText(item.reason) || 'No reason provided.';
		const safeReason =
			matchByName
				? appendReason(reason, `Matched existing dog "${matchByName.name}" and switched to update.`)
				: reason;
		return {
			id: `suggestion-${Date.now()}-${index}`,
			selected: action !== 'ignore',
			action,
			matchName: cleanText(item.matchName) || matchByName?.name || '',
			matchDogId: matchByName?.id ?? '',
			reentryDateDraft: '',
			showAllFields: false,
			confidence: normalizeConfidence(item.confidence),
			reason: safeReason,
				fields: {
					name,
					breed: cleanText(item.fields?.breed),
					color: cleanText(item.fields?.color),
					sex: normalizeSex(item.fields?.sex),
				origin: cleanText(item.fields?.origin),
				dateOfBirth: normalizeDateText(item.fields?.dateOfBirth),
				originalIntakeDate: normalizeDateText(item.fields?.originalIntakeDate),
				currentIntakeDate: normalizeDateText(item.fields?.currentIntakeDate),
				reentryDates: normalizeDateList(item.fields?.reentryDates),
				leftShelterDate: normalizeDateText(item.fields?.leftShelterDate),
				weightLbs: normalizeWeightLbs(item.fields?.weightLbs),
				microchipDate: normalizeDateText(item.fields?.microchipDate),
				pottyTrained: normalizePotty(item.fields?.pottyTrained),
				goodWithDogs: normalizeCompatibility(item.fields?.goodWithDogs),
				goodWithCats: normalizeCompatibility(item.fields?.goodWithCats),
				goodWithKids: normalizeCompatibility(item.fields?.goodWithKids),
				goodWithElderly: normalizeCompatibility(item.fields?.goodWithElderly),
				goodOnLead: normalizeCompatibility(item.fields?.goodOnLead),
				goodTraveller: normalizeCompatibility(item.fields?.goodTraveller),
				crateTrained: normalizeCompatibility(item.fields?.crateTrained),
				idealHome: cleanText(item.fields?.idealHome),
				energyLevel: normalizeEnergy(item.fields?.energyLevel),
				dietaryNotes: cleanText(item.fields?.dietaryNotes),
				markings: cleanText(item.fields?.markings),
				hiddenComments: cleanText(item.fields?.hiddenComments),
				description: cleanText(item.fields?.description),
				warningNotes: cleanText(item.fields?.warningNotes),
				holdNotes: cleanText(item.fields?.holdNotes),
				outdoorKennelAssignment: cleanText(item.fields?.outdoorKennelAssignment),
				inFosterStatus: normalizeFosterStatus(item.fields?.inFosterStatus),
				microchippedStatus: normalizeMedical(item.fields?.microchippedStatus),
				vaccinationStatus: normalizeMedical(item.fields?.vaccinationStatus),
				vaccinatedDate: normalizeDateText(item.fields?.vaccinatedDate),
				fixedStatus: normalizeMedical(item.fields?.fixedStatus),
				fixedDate: normalizeDateText(item.fields?.fixedDate),
				surgeryDate: normalizeDateText(item.fields?.surgeryDate),
				healthProblems: cleanText(item.fields?.healthProblems)
			}
		};
	}

	function updateSuggestion(id: string, updater: (current: EditableSuggestion) => EditableSuggestion) {
		suggestions = suggestions.map((suggestion) =>
			suggestion.id === id ? updater(suggestion) : suggestion
		);
	}

	function findDogByName(name: string) {
		const normalized = normalizeNameKey(name);
		if (!normalized) return null;

		const exactMatches = dogs.filter((dog) => normalizeNameKey(dog.name) === normalized);
		if (exactMatches.length > 0) return exactMatches[0] ?? null;

		const primary = firstNameKey(name);
		if (primary) {
			const primaryMatches = dogs.filter((dog) => firstNameKey(dog.name) === primary);
			if (primaryMatches.length === 1) return primaryMatches[0] ?? null;
		}

		const fuzzyFull = findClosestDogMatch(normalized, false);
		if (fuzzyFull) return fuzzyFull;
		if (primary && primary !== normalized) {
			const fuzzyPrimary = findClosestDogMatch(primary, true);
			if (fuzzyPrimary) return fuzzyPrimary;
		}

		return null;
	}

	function getDogById(dogId: string) {
		const targetId = cleanText(dogId);
		if (!targetId) return null;
		return dogs.find((dog) => dog.id === targetId) ?? null;
	}

	function resolveSuggestionTargetDog(suggestion: EditableSuggestion) {
		return (
			getDogById(suggestion.matchDogId) ??
			findDogByName(suggestion.matchName || suggestion.fields.name)
		);
	}

	function normalizeAction(value: unknown): IntakeAction {
		return value === 'update' || value === 'ignore' ? value : 'create';
	}

	function normalizeConfidence(value: unknown): Confidence {
		return value === 'high' || value === 'low' ? value : 'medium';
	}

	function normalizePotty(value: unknown): PottyTrainedStatus {
		return value === 'yes' || value === 'no' || value === 'working_on_it' ? value : 'unknown';
	}

	function normalizeCompatibility(value: unknown): Compatibility {
		return value === 'yes' || value === 'no' ? value : 'unknown';
	}

	function normalizeEnergy(value: unknown): EnergyLevel {
		return value === 'low' || value === 'medium' || value === 'high' || value === 'very_high'
			? value
			: 'unknown';
	}

	function normalizeSex(value: unknown): DogSex {
		return value === 'male' || value === 'female' ? value : 'unknown';
	}

	function normalizeMedical(value: unknown): MedicalStatus {
		return value === 'yes' || value === 'no' ? value : 'unknown';
	}

	function normalizeFosterStatus(value: unknown): MedicalStatus {
		return normalizeMedical(value);
	}

	function normalizeWeightLbs(value: unknown): number | null {
		const asNumber = typeof value === 'number' ? value : Number(cleanText(value));
		if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
		return Math.round(asNumber * 10) / 10;
	}

	function normalizeDateText(value: unknown) {
		return normalizeDateString(cleanText(value));
	}

	function normalizeDateList(value: unknown): string[] {
		if (Array.isArray(value)) {
			return dedupeAndSortDateStrings(value.map((item) => normalizeDateText(item)).filter(Boolean));
		}
		return parseDateListInput(cleanText(value));
	}

	function parseDateListInput(value: string): string[] {
		if (!value) return [];
		const tokenPattern = /\b(\d{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})\b/g;
		const tokens = [...value.matchAll(tokenPattern)].map((match) => match[1] ?? '');
		if (tokens.length > 0) {
			return dedupeAndSortDateStrings(tokens.map((token) => normalizeDateString(token)).filter(Boolean));
		}

		return dedupeAndSortDateStrings(
			value
				.split(/[,\n;|]+/g)
				.map((token) => normalizeDateString(token))
				.filter(Boolean)
		);
	}

	function updateReentryDateDraft(id: string, value: string) {
		updateSuggestion(id, (current) => ({
			...current,
			reentryDateDraft: normalizeDateString(value)
		}));
	}

	function addReentryDate(id: string) {
		updateSuggestion(id, (current) => {
			const nextDate = normalizeDateString(current.reentryDateDraft);
			if (!nextDate) return current;
			return {
				...current,
				reentryDateDraft: '',
				fields: {
					...current.fields,
					reentryDates: dedupeAndSortDateStrings([...current.fields.reentryDates, nextDate])
				}
			};
		});
	}

	function removeReentryDate(id: string, value: string) {
		updateSuggestion(id, (current) => ({
			...current,
			fields: {
				...current.fields,
				reentryDates: current.fields.reentryDates.filter((date) => date !== value)
			}
		}));
	}

	function handleReentryDateKeydown(event: KeyboardEvent, id: string) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		addReentryDate(id);
	}

	function getMissingCoreFields(fields: SuggestionFields) {
		const missing: string[] = [];
		if (!cleanText(fields.name)) missing.push('Name');
		if (!normalizeDateText(fields.originalIntakeDate)) missing.push('Entered shelter date');
		if (!normalizeDateText(fields.currentIntakeDate)) missing.push('Last entered shelter date');
		if (fields.inFosterStatus === 'unknown') missing.push('In foster status');
		return missing;
	}

	function patchHasField(patch: Partial<Dog>, key: keyof Dog) {
		return Object.prototype.hasOwnProperty.call(patch, key);
	}

	function shouldSurfaceField(suggestion: EditableSuggestion, field: keyof SuggestionFields) {
		if (suggestion.showAllFields) return true;
		if (suggestion.action === 'create') {
			return shouldSurfaceCreateField(suggestion.fields, field);
		}
		if (suggestion.action === 'update') {
			return shouldSurfaceUpdateField(suggestion, field);
		}
		return false;
	}

	function shouldSurfaceCreateField(fields: SuggestionFields, field: keyof SuggestionFields) {
			switch (field) {
				case 'name':
					return Boolean(cleanText(fields.name));
				case 'breed':
					return Boolean(cleanText(fields.breed));
				case 'color':
					return Boolean(cleanText(fields.color));
				case 'sex':
					return fields.sex !== 'unknown';
			case 'weightLbs':
				return fields.weightLbs !== null;
			case 'origin':
			case 'idealHome':
			case 'dietaryNotes':
			case 'markings':
			case 'hiddenComments':
			case 'description':
			case 'warningNotes':
			case 'holdNotes':
			case 'healthProblems':
			case 'outdoorKennelAssignment':
				return Boolean(cleanText(fields[field]));
			case 'originalIntakeDate':
			case 'currentIntakeDate':
			case 'dateOfBirth':
			case 'leftShelterDate':
			case 'microchipDate':
			case 'vaccinatedDate':
			case 'fixedDate':
			case 'surgeryDate':
				return Boolean(normalizeDateText(fields[field]));
			case 'reentryDates':
				return normalizeDateList(fields.reentryDates).length > 0;
			case 'pottyTrained':
				return fields.pottyTrained !== 'unknown';
			case 'goodWithDogs':
			case 'goodWithCats':
			case 'goodWithKids':
			case 'goodWithElderly':
			case 'goodOnLead':
			case 'goodTraveller':
			case 'crateTrained':
				return fields[field] !== 'unknown';
			case 'energyLevel':
				return fields.energyLevel !== 'unknown';
			case 'inFosterStatus':
			case 'microchippedStatus':
			case 'vaccinationStatus':
			case 'fixedStatus':
				return fields[field] !== 'unknown';
			default:
				return false;
		}
	}

	function shouldSurfaceUpdateField(suggestion: EditableSuggestion, field: keyof SuggestionFields) {
		const patch = suggestionUpdatePatches[suggestion.id] ?? {};
			switch (field) {
				case 'name':
					return patchHasField(patch, 'name');
				case 'breed':
					return patchHasField(patch, 'breed');
				case 'color':
					return patchHasField(patch, 'markings');
				case 'sex':
					return patchHasField(patch, 'sex');
			case 'weightLbs':
				return patchHasField(patch, 'weightLbs');
			case 'origin':
				return patchHasField(patch, 'origin');
			case 'dateOfBirth':
				return patchHasField(patch, 'dateOfBirth');
			case 'originalIntakeDate':
				return patchHasField(patch, 'originalIntakeDate');
			case 'currentIntakeDate':
				return patchHasField(patch, 'intakeDate');
			case 'leftShelterDate':
				return patchHasField(patch, 'leftShelterDate');
			case 'reentryDates':
				return patchHasField(patch, 'reentryDates');
			case 'microchipDate':
				return patchHasField(patch, 'microchipDate');
			case 'pottyTrained':
				return patchHasField(patch, 'pottyTrained');
			case 'goodWithDogs':
				return patchHasField(patch, 'goodWithDogs');
			case 'goodWithCats':
				return patchHasField(patch, 'goodWithCats');
			case 'goodWithKids':
				return patchHasField(patch, 'goodWithKids');
			case 'goodWithElderly':
				return patchHasField(patch, 'goodWithElderly');
			case 'goodOnLead':
				return patchHasField(patch, 'goodOnLead');
			case 'goodTraveller':
				return patchHasField(patch, 'goodTraveller');
			case 'crateTrained':
				return patchHasField(patch, 'crateTrained');
			case 'idealHome':
				return patchHasField(patch, 'idealHome');
			case 'energyLevel':
				return patchHasField(patch, 'energyLevel');
			case 'dietaryNotes':
				return patchHasField(patch, 'dietaryNotes');
			case 'markings':
				return patchHasField(patch, 'markings');
			case 'hiddenComments':
				return patchHasField(patch, 'hiddenComments');
			case 'description':
				return patchHasField(patch, 'description');
			case 'warningNotes':
				return patchHasField(patch, 'warningNotes');
			case 'holdNotes':
				return patchHasField(patch, 'holdNotes');
			case 'healthProblems':
				return patchHasField(patch, 'healthProblems');
			case 'outdoorKennelAssignment':
				return patchHasField(patch, 'outdoorKennelAssignment');
			case 'inFosterStatus':
				return patchHasField(patch, 'inFoster');
			case 'microchippedStatus':
				return patchHasField(patch, 'isMicrochipped');
			case 'vaccinationStatus':
				return patchHasField(patch, 'isVaccinated');
			case 'vaccinatedDate':
				return patchHasField(patch, 'vaccinatedDate');
			case 'fixedStatus':
				return patchHasField(patch, 'isFixed');
			case 'fixedDate':
				return patchHasField(patch, 'fixedDate');
			case 'surgeryDate':
				return patchHasField(patch, 'surgeryDate');
			default:
				return false;
		}
	}

	function normalizeDateString(value: string) {
		const cleaned = cleanText(value).replace(/[.,]/g, ' ');
		if (!cleaned) return '';
		const match = cleaned.match(/\b(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})\b/);
		if (!match) return '';

		const first = Number(match[1]);
		const second = Number(match[2]);
		const third = Number(match[3]);
		if (![first, second, third].every((part) => Number.isFinite(part))) return '';

		let year = 0;
		let month = 0;
		let day = 0;

		if ((match[1] ?? '').length === 4) {
			year = first;
			month = second;
			day = third;
		} else if ((match[3] ?? '').length === 4) {
			month = first;
			day = second;
			year = third;
		} else {
			month = first;
			day = second;
			year = third >= 70 ? 1900 + third : 2000 + third;
		}

		if (year < 1900 || year > 2100) return '';
		if (month < 1 || month > 12) return '';
		if (day < 1 || day > 31) return '';

		const check = new Date(Date.UTC(year, month - 1, day));
		if (
			check.getUTCFullYear() !== year ||
			check.getUTCMonth() !== month - 1 ||
			check.getUTCDate() !== day
		) {
			return '';
		}

		const yyyy = String(year).padStart(4, '0');
		const mm = String(month).padStart(2, '0');
		const dd = String(day).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	function parseIsoDate(value: string): Date | null {
		const iso = normalizeDateString(value);
		if (!iso) return null;
		const [yearRaw, monthRaw, dayRaw] = iso.split('-');
		const year = Number(yearRaw);
		const month = Number(monthRaw);
		const day = Number(dayRaw);
		if (!year || !month || !day) return null;
		return new Date(year, month - 1, day);
	}

	function dedupeAndSortDateStrings(values: string[]): string[] {
		const deduped = [...new Set(values.filter(Boolean))];
		return deduped.sort((a, b) => a.localeCompare(b));
	}

	function toComparableDate(value: unknown): Date | null {
		if (!value) return null;
		if (value instanceof Date) {
			return Number.isNaN(value.getTime()) ? null : value;
		}
		if (typeof value === 'string') {
			const normalized = normalizeDateString(value);
			return normalized ? parseIsoDate(normalized) : null;
		}
		if (typeof value === 'object' && value && 'toDate' in value) {
			const maybeTimestamp = value as { toDate?: () => Date };
			if (typeof maybeTimestamp.toDate === 'function') {
				const asDate = maybeTimestamp.toDate();
				return Number.isNaN(asDate.getTime()) ? null : asDate;
			}
		}
		return null;
	}

	function dateToKey(value: unknown): string {
		const date = toComparableDate(value);
		if (!date) return '';
		const yyyy = String(date.getFullYear()).padStart(4, '0');
		const mm = String(date.getMonth() + 1).padStart(2, '0');
		const dd = String(date.getDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	function sameDateValue(left: unknown, right: unknown) {
		const leftKey = dateToKey(left);
		const rightKey = dateToKey(right);
		return Boolean(leftKey) && leftKey === rightKey;
	}

	function toDateKeyList(values: unknown): string[] {
		if (!Array.isArray(values)) return [];
		return dedupeAndSortDateStrings(values.map((value) => dateToKey(value)).filter(Boolean));
	}

	function sameDateList(leftValues: unknown, rightIsoValues: string[]) {
		const left = toDateKeyList(leftValues);
		const right = dedupeAndSortDateStrings(rightIsoValues.map((value) => normalizeDateString(value)).filter(Boolean));
		return left.length === right.length && left.every((value, index) => value === right[index]);
	}

	function buildEntryTimeline(fields: SuggestionFields) {
		const parsedOriginal = normalizeDateString(fields.originalIntakeDate);
		const parsedCurrent = normalizeDateString(fields.currentIntakeDate);
		const parsedReentry = normalizeDateList(fields.reentryDates);
		const originalIso = parsedOriginal || parsedCurrent;
		const currentIso = parsedCurrent || parsedOriginal;
		const reentryIso = dedupeAndSortDateStrings([
			...parsedReentry,
			...(originalIso && currentIso && currentIso !== originalIso ? [currentIso] : [])
		]).filter((value) => !originalIso || value !== originalIso);

		return {
			originalIso,
			currentIso,
			reentryIso,
			hasTimelineInput: Boolean(parsedOriginal || parsedCurrent || parsedReentry.length)
		};
	}

	function cleanText(value: unknown) {
		return typeof value === 'string' ? value.trim() : '';
	}

	function normalizeNameKey(value: string) {
		return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
	}

	function firstNameKey(value: string) {
		const first = cleanText(value).split(/\s+/)[0] ?? '';
		return normalizeNameKey(first);
	}

	function appendReason(base: string, extra: string) {
		const trimmedBase = cleanText(base);
		if (!trimmedBase) return extra;
		if (trimmedBase.toLowerCase().includes(extra.toLowerCase())) return trimmedBase;
		return `${trimmedBase} ${extra}`;
	}

	function applyDuplicateSuggestionGuard(items: EditableSuggestion[]): EditableSuggestion[] {
		const seenCreateNames = new Set<string>();
		return items.map((item): EditableSuggestion => {
			if (item.action !== 'create') return item;
			const key = normalizeNameKey(item.fields.name || item.matchName);
			if (!key) return item;
			if (!seenCreateNames.has(key)) {
				seenCreateNames.add(key);
				return item;
			}
			return {
				...item,
				action: 'ignore' as IntakeAction,
				selected: false,
				reason: appendReason(item.reason, 'Auto-ignored duplicate create suggestion for this name.')
			};
		});
	}

	function findClosestDogMatch(candidateKey: string, usePrimaryOnly: boolean) {
		if (!candidateKey || candidateKey.length < 4) return null;
		const maxDistance = candidateKey.length >= 8 ? 2 : 1;
		let best: Dog | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		let ambiguous = false;

		for (const dog of dogs) {
			const dogKey = usePrimaryOnly ? firstNameKey(dog.name) : normalizeNameKey(dog.name);
			if (!dogKey || dogKey.length < 3) continue;
			if (dogKey[0] !== candidateKey[0]) continue;
			if (Math.abs(dogKey.length - candidateKey.length) > maxDistance) continue;

			const distance = boundedLevenshtein(candidateKey, dogKey, maxDistance);
			if (distance > maxDistance) continue;

			if (distance < bestDistance) {
				bestDistance = distance;
				best = dog;
				ambiguous = false;
				continue;
			}

			if (distance === bestDistance) ambiguous = true;
		}

		if (!best || ambiguous) return null;
		return best;
	}

	function boundedLevenshtein(a: string, b: string, maxDistance: number) {
		if (a === b) return 0;
		if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

		const prev = new Array<number>(b.length + 1);
		const curr = new Array<number>(b.length + 1);
		for (let j = 0; j <= b.length; j += 1) prev[j] = j;

		for (let i = 1; i <= a.length; i += 1) {
			curr[0] = i;
			let minInRow = curr[0];

			for (let j = 1; j <= b.length; j += 1) {
				const cost = a[i - 1] === b[j - 1] ? 0 : 1;
				curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
				if (curr[j] < minInRow) minInRow = curr[j];
			}

			if (minInRow > maxDistance) return maxDistance + 1;

			for (let j = 0; j <= b.length; j += 1) {
				prev[j] = curr[j];
			}
		}

		return prev[b.length] ?? maxDistance + 1;
	}

	function composeMarkingsValue(color: string, markings: string) {
		const colorText = cleanText(color);
		const markingsText = cleanText(markings);
		if (colorText && markingsText) return `Color: ${colorText}. ${markingsText}`;
		if (colorText) return `Color: ${colorText}`;
		return markingsText;
	}

	function buildCreatePayload(fields: SuggestionFields): Omit<Dog, 'id' | 'createdAt' | 'updatedAt'> {
		const now = new Date();
		const dateOfBirth = parseIsoDate(fields.dateOfBirth) ?? now;
		const surgeryDate = parseIsoDate(fields.surgeryDate);
		const fixedDate = parseIsoDate(fields.fixedDate);
		const vaccinatedDate = parseIsoDate(fields.vaccinatedDate);
		const leftShelterDate = parseIsoDate(fields.leftShelterDate);
		const microchipDate = parseIsoDate(fields.microchipDate);
		const weightLbs = normalizeWeightLbs(fields.weightLbs);
		const entryTimeline = buildEntryTimeline(fields);
		const intakeDate = parseIsoDate(entryTimeline.currentIso) ?? now;
		const originalIntakeDate = parseIsoDate(entryTimeline.originalIso) ?? intakeDate;
		const reentryDates = entryTimeline.reentryIso
			.map((value) => parseIsoDate(value))
			.filter((value): value is Date => Boolean(value));
		const isMicrochipped = fields.microchippedStatus === 'yes';
		const isFixed = fields.fixedStatus === 'yes';
		const isVaccinated = fields.vaccinationStatus === 'yes';
		const inFoster = fields.inFosterStatus === 'yes';
		const foodType = 'Normal';
		const foodAmount =
			estimateFoodAmountPerMeal({
				weightLbs,
				foodType,
				dateOfBirth
			}) || '';
		return {
			name: cleanText(fields.name) || 'Unnamed dog',
			breed: cleanText(fields.breed),
			sex: normalizeSex(fields.sex),
			intakeDate,
			originalIntakeDate,
			reentryDates,
			leftShelterDate,
			dateOfBirth,
			weightLbs,
			foodType,
			foodAmount,
			dietaryNotes: cleanText(fields.dietaryNotes),
			photoUrl: null,
			hasOwnFood: false,
			transitionToHills: null,
			origin: cleanText(fields.origin),
			markings: composeMarkingsValue(fields.color, fields.markings),
			hiddenComments: cleanText(fields.hiddenComments),
			description: cleanText(fields.description),
			warningNotes: cleanText(fields.warningNotes),
			holdNotes: cleanText(fields.holdNotes),
			pottyTrained: normalizePotty(fields.pottyTrained),
			goodWithDogs: normalizeCompatibility(fields.goodWithDogs),
			goodWithCats: normalizeCompatibility(fields.goodWithCats),
			goodWithKids: normalizeCompatibility(fields.goodWithKids),
			goodWithElderly: normalizeCompatibility(fields.goodWithElderly),
			goodOnLead: normalizeCompatibility(fields.goodOnLead),
			goodTraveller: normalizeCompatibility(fields.goodTraveller),
			crateTrained: normalizeCompatibility(fields.crateTrained),
			idealHome: cleanText(fields.idealHome),
			energyLevel: normalizeEnergy(fields.energyLevel),
			outdoorKennelAssignment: cleanText(fields.outdoorKennelAssignment),
			microchipDate,
			healthProblems: cleanText(fields.healthProblems),
			lastBathDate: null,
			lastBathBy: null,
			lastDayTripDate: null,
			isOutOnDayTrip: false,
			currentDayTripStartedAt: null,
			surgeryDate,
			isMicrochipped,
			isFixed,
			fixedDate: isFixed ? fixedDate : null,
			isVaccinated,
			vaccinatedDate: isVaccinated ? vaccinatedDate : null,
			dayTripStatus: 'eligible',
			dayTripIneligibleReason: null,
			dayTripManagerOnly: false,
			dayTripManagerOnlyReason: null,
			dayTripNotes: null,
			handlingLevel: 'volunteer',
			inFoster,
			isolationStatus: 'none',
			isolationStartDate: null,
			status: 'active'
		};
	}

	function buildUpdatePatch(fields: SuggestionFields, currentDog: Dog | null = null): Partial<Dog> {
		const patch: Partial<Dog> = {};
		const entryTimeline = buildEntryTimeline(fields);
		const incomingWeightLbs = normalizeWeightLbs(fields.weightLbs);
		if (
			incomingWeightLbs !== null &&
			(!currentDog || normalizeWeightLbs(currentDog.weightLbs) !== incomingWeightLbs)
		) {
			patch.weightLbs = incomingWeightLbs;
		}
		const name = cleanText(fields.name);
		if (name && (!currentDog || name !== cleanText(currentDog.name))) {
			patch.name = name;
		}

		const breed = cleanText(fields.breed);
		if (breed && (!currentDog || breed !== cleanText(currentDog.breed))) {
			patch.breed = breed;
		}

		const sex = normalizeSex(fields.sex);
		if (sex !== 'unknown' && (!currentDog || currentDog.sex !== sex)) {
			patch.sex = sex;
		}

		const origin = cleanText(fields.origin);
		if (origin && (!currentDog || origin !== cleanText(currentDog.origin))) {
			patch.origin = origin;
		}

		const dateOfBirth = parseIsoDate(fields.dateOfBirth);
		if (dateOfBirth && (!currentDog || !sameDateValue(currentDog.dateOfBirth, dateOfBirth))) {
			patch.dateOfBirth = dateOfBirth;
		}

		const idealHome = cleanText(fields.idealHome);
		if (idealHome && (!currentDog || idealHome !== cleanText(currentDog.idealHome))) {
			patch.idealHome = idealHome;
		}

		const dietaryNotes = cleanText(fields.dietaryNotes);
		if (dietaryNotes && (!currentDog || dietaryNotes !== cleanText(currentDog.dietaryNotes))) {
			patch.dietaryNotes = dietaryNotes;
		}

		const markings = cleanText(fields.markings);
		const composedMarkings = composeMarkingsValue(fields.color, markings);
		if (composedMarkings && (!currentDog || composedMarkings !== cleanText(currentDog.markings))) {
			patch.markings = composedMarkings;
		}

		const hiddenComments = cleanText(fields.hiddenComments);
		if (hiddenComments && (!currentDog || hiddenComments !== cleanText(currentDog.hiddenComments))) {
			patch.hiddenComments = hiddenComments;
		}

		const description = cleanText(fields.description);
		if (description && (!currentDog || description !== cleanText(currentDog.description))) {
			patch.description = description;
		}

		const warningNotes = cleanText(fields.warningNotes);
		if (warningNotes && (!currentDog || warningNotes !== cleanText(currentDog.warningNotes))) {
			patch.warningNotes = warningNotes;
		}

		const holdNotes = cleanText(fields.holdNotes);
		if (holdNotes && (!currentDog || holdNotes !== cleanText(currentDog.holdNotes))) {
			patch.holdNotes = holdNotes;
		}

		const healthProblems = cleanText(fields.healthProblems);
		if (healthProblems && (!currentDog || healthProblems !== cleanText(currentDog.healthProblems))) {
			patch.healthProblems = healthProblems;
		}

		const outdoorKennel = cleanText(fields.outdoorKennelAssignment);
		if (
			outdoorKennel &&
			(!currentDog || outdoorKennel !== cleanText(currentDog.outdoorKennelAssignment))
		) {
			patch.outdoorKennelAssignment = outdoorKennel;
		}

		if (fields.inFosterStatus === 'yes') {
			if (!currentDog || currentDog.inFoster !== true) patch.inFoster = true;
		} else if (fields.inFosterStatus === 'no') {
			if (!currentDog || currentDog.inFoster !== false) patch.inFoster = false;
		}

		if (
			fields.pottyTrained !== 'unknown' &&
			(!currentDog || currentDog.pottyTrained !== fields.pottyTrained)
		) {
			patch.pottyTrained = fields.pottyTrained;
		}
		if (
			fields.goodWithDogs !== 'unknown' &&
			(!currentDog || currentDog.goodWithDogs !== fields.goodWithDogs)
		) {
			patch.goodWithDogs = fields.goodWithDogs;
		}
		if (
			fields.goodWithCats !== 'unknown' &&
			(!currentDog || currentDog.goodWithCats !== fields.goodWithCats)
		) {
			patch.goodWithCats = fields.goodWithCats;
		}
		if (
			fields.goodWithKids !== 'unknown' &&
			(!currentDog || currentDog.goodWithKids !== fields.goodWithKids)
		) {
			patch.goodWithKids = fields.goodWithKids;
		}
		if (
			fields.goodWithElderly !== 'unknown' &&
			(!currentDog || currentDog.goodWithElderly !== fields.goodWithElderly)
		) {
			patch.goodWithElderly = fields.goodWithElderly;
		}
		if (
			fields.goodOnLead !== 'unknown' &&
			(!currentDog || currentDog.goodOnLead !== fields.goodOnLead)
		) {
			patch.goodOnLead = fields.goodOnLead;
		}
		if (
			fields.goodTraveller !== 'unknown' &&
			(!currentDog || currentDog.goodTraveller !== fields.goodTraveller)
		) {
			patch.goodTraveller = fields.goodTraveller;
		}
		if (
			fields.crateTrained !== 'unknown' &&
			(!currentDog || currentDog.crateTrained !== fields.crateTrained)
		) {
			patch.crateTrained = fields.crateTrained;
		}
		if (
			fields.energyLevel !== 'unknown' &&
			(!currentDog || currentDog.energyLevel !== fields.energyLevel)
		) {
			patch.energyLevel = fields.energyLevel;
		}
		if (fields.microchippedStatus === 'yes') {
			if (!currentDog || currentDog.isMicrochipped !== true) patch.isMicrochipped = true;
		} else if (fields.microchippedStatus === 'no') {
			if (!currentDog || currentDog.isMicrochipped !== false) patch.isMicrochipped = false;
		}

		const surgeryDate = parseIsoDate(fields.surgeryDate);
		if (surgeryDate && (!currentDog || !sameDateValue(currentDog.surgeryDate, surgeryDate))) {
			patch.surgeryDate = surgeryDate;
		}

		const leftShelterDate = parseIsoDate(fields.leftShelterDate);
		if (
			leftShelterDate &&
			(!currentDog || !sameDateValue(currentDog.leftShelterDate, leftShelterDate))
		) {
			patch.leftShelterDate = leftShelterDate;
		}

		const microchipDate = parseIsoDate(fields.microchipDate);
		if (
			microchipDate &&
			(!currentDog || !sameDateValue(currentDog.microchipDate, microchipDate))
		) {
			patch.microchipDate = microchipDate;
		}

		const fixedDate = parseIsoDate(fields.fixedDate);
		if (fields.fixedStatus === 'yes') {
			if (!currentDog || currentDog.isFixed !== true) patch.isFixed = true;
			if (fixedDate && (!currentDog || !sameDateValue(currentDog.fixedDate, fixedDate))) {
				patch.fixedDate = fixedDate;
			}
		} else if (fields.fixedStatus === 'no') {
			if (!currentDog || currentDog.isFixed !== false) patch.isFixed = false;
			if (!currentDog || currentDog.fixedDate !== null) patch.fixedDate = null;
		}

		const vaccinatedDate = parseIsoDate(fields.vaccinatedDate);
		if (fields.vaccinationStatus === 'yes') {
			if (!currentDog || currentDog.isVaccinated !== true) patch.isVaccinated = true;
			if (
				vaccinatedDate &&
				(!currentDog || !sameDateValue(currentDog.vaccinatedDate, vaccinatedDate))
			) {
				patch.vaccinatedDate = vaccinatedDate;
			}
		} else if (fields.vaccinationStatus === 'no') {
			if (!currentDog || currentDog.isVaccinated !== false) patch.isVaccinated = false;
			if (!currentDog || currentDog.vaccinatedDate !== null) patch.vaccinatedDate = null;
		}

		if (entryTimeline.hasTimelineInput) {
			const originalEntry = parseIsoDate(entryTimeline.originalIso);
			const currentEntry = parseIsoDate(entryTimeline.currentIso);
			if (
				originalEntry &&
				(!currentDog || !sameDateValue(currentDog.originalIntakeDate, originalEntry))
			) {
				patch.originalIntakeDate = originalEntry;
			}
			if (currentEntry && (!currentDog || !sameDateValue(currentDog.intakeDate, currentEntry))) {
				patch.intakeDate = currentEntry;
			}

			if (
				entryTimeline.reentryIso.length > 0 ||
				(entryTimeline.originalIso &&
					entryTimeline.currentIso &&
					entryTimeline.originalIso !== entryTimeline.currentIso)
			) {
				const parsedReentryDates = entryTimeline.reentryIso
					.map((value) => parseIsoDate(value))
					.filter((value): value is Date => Boolean(value));
				if (!currentDog || !sameDateList(currentDog.reentryDates, entryTimeline.reentryIso)) {
					patch.reentryDates = parsedReentryDates;
				}
			}
		}

		const nextWeightLbs = normalizeWeightLbs(patch.weightLbs ?? currentDog?.weightLbs);
		const nextFoodType = cleanText(currentDog?.foodType) || 'Normal';
		const nextDob = (patch.dateOfBirth ?? currentDog?.dateOfBirth) ?? null;
		const suggestedFoodAmount = estimateFoodAmountPerMeal({
			weightLbs: nextWeightLbs,
			dateOfBirth: nextDob,
			foodType: nextFoodType
		});
		if (suggestedFoodAmount) {
			if (!currentDog) {
				patch.foodAmount = suggestedFoodAmount;
			} else {
				const currentFoodAmount = cleanText(currentDog.foodAmount);
				const currentSuggestedAmount = estimateFoodAmountPerMeal({
					weightLbs: currentDog.weightLbs,
					dateOfBirth: currentDog.dateOfBirth,
					foodType: currentDog.foodType
				});
				const shouldAutofill = !currentFoodAmount || currentFoodAmount === currentSuggestedAmount;
				if (shouldAutofill && currentFoodAmount !== suggestedFoodAmount) {
					patch.foodAmount = suggestedFoodAmount;
				}
			}
		}

		return patch;
	}

	async function applySuggestions() {
		if (!canRunIntake) {
			toast.error('You do not have permission to apply intake actions.');
			return;
		}

		const selected = suggestions.filter((item) => item.selected && item.action !== 'ignore');
		if (selected.length === 0) {
			toast('Select at least one action to apply.');
			return;
		}

		applying = true;
		let created = 0;
		let updated = 0;
		let skipped = 0;
		let deduped = 0;
		let failed = 0;
		const createdNameKeys = new Set<string>();

		for (const suggestion of selected) {
			try {
				if (suggestion.action === 'create') {
					const incomingName = cleanText(suggestion.fields.name);
					const incomingNameKey = normalizeNameKey(incomingName);
					if (incomingNameKey && createdNameKeys.has(incomingNameKey)) {
						skipped += 1;
						deduped += 1;
						continue;
					}

					const existingDog = findDogByName(incomingName);
					if (existingDog) {
						const patch = buildUpdatePatch(suggestion.fields, existingDog);
						if (Object.keys(patch).length === 0) {
							skipped += 1;
							deduped += 1;
							continue;
						}
						await updateDog(existingDog.id, patch);
						updated += 1;
						continue;
					}

					await createDog(buildCreatePayload(suggestion.fields));
					created += 1;
					if (incomingNameKey) createdNameKeys.add(incomingNameKey);
					continue;
				}

				if (suggestion.action === 'update') {
					const targetDog = resolveSuggestionTargetDog(suggestion);
					if (!targetDog) {
						skipped += 1;
						continue;
					}
					const patch = buildUpdatePatch(suggestion.fields, targetDog);
					if (Object.keys(patch).length === 0) {
						skipped += 1;
						continue;
					}
					await updateDog(targetDog.id, patch);
					updated += 1;
				}
			} catch (error) {
				console.error(error);
				failed += 1;
			}
		}

		await refreshDogs();
		applying = false;
		toast.success(
			`Applied intake actions. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}, Deduped: ${deduped}.`
		);
		if (failed > 0) {
			toast.error(`${failed} action(s) failed. Check console for details.`);
		}
	}
</script>

<section class="intake-board" aria-label="AI intake">
	{#if !canRunIntake}
		<p class="intake-warning">
			This interface is for managers/admins. Current role: <strong>{role}</strong>.
		</p>
	{:else}
		<div class="intake-grid">
			<section class="intake-upload">
				<h3>1) Upload Photo or Paste Text</h3>
				<input type="file" accept="image/*" on:change={handleFileChange} />
				<label class="suggestion-field intake-text-input">
					<span>Or Paste Profile Text</span>
					<textarea
						rows="5"
						placeholder="Paste ASM profile text here..."
						value={intakeText}
						on:input={(event) => (intakeText = event.currentTarget.value)}
					></textarea>
				</label>
				<div class="intake-upload-actions">
					<button
						class="intake-btn intake-btn-fill"
						on:click={analyzePhoto}
						disabled={(!file && !cleanText(intakeText)) || analyzing}
					>
						{analyzing ? 'Analyzing...' : 'Analyze Intake'}
					</button>
					<button
						class="intake-btn"
						on:click={() => {
							setFile(null);
							resetAnalysis();
						}}
						disabled={analyzing || applying}
					>
						Clear
					</button>
				</div>

				{#if apiError}
					<p class="intake-error">{apiError}</p>
				{/if}

				{#if previewUrl}
					<div class="intake-preview">
						<img src={previewUrl} alt="Uploaded intake board" />
					</div>
				{/if}

				{#if analysisModel}
					<p class="intake-model typewriter">Model: {analysisModel}</p>
				{/if}

				{#if notes.length > 0}
					<div class="intake-notes">
						<p class="typewriter">Model notes</p>
						<ul>
							{#each notes as note}
								<li>{note}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</section>

			<section class="intake-review">
				<div class="intake-review-head">
					<h3>2) Review Suggested Actions</h3>
					<span class="typewriter">
						{#if loadingDogs}loading dogs...{:else}{selectedCount} selected{/if}
					</span>
				</div>
				<p class="intake-priority-note typewriter">
					Core fields: {coreFieldLabels.join(' | ')}. Everything else is optional enrichment.
				</p>

				{#if suggestions.length === 0}
					<p class="intake-empty typewriter">No suggestions yet.</p>
				{:else}
					<div class="intake-suggestions">
						{#each suggestions as suggestion}
							<article class="suggestion-card">
								<div class="suggestion-top">
									<label class="typewriter suggestion-checkbox">
										<input
											type="checkbox"
											checked={suggestion.selected}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													selected: event.currentTarget.checked
												}))}
										/>
										apply
									</label>

									<label class="suggestion-field">
										<span>Action</span>
										<select
											value={suggestion.action}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													action: normalizeAction(event.currentTarget.value)
												}))}
										>
											<option value="create">Create</option>
											<option value="update">Update</option>
											<option value="ignore">Ignore</option>
										</select>
									</label>

									<label class="suggestion-field">
										<span>Confidence</span>
										<select
											value={suggestion.confidence}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													confidence: normalizeConfidence(event.currentTarget.value)
												}))}
										>
											<option value="high">High</option>
											<option value="medium">Medium</option>
											<option value="low">Low</option>
										</select>
									</label>
								</div>

								{#if suggestion.action === 'update'}
									<label class="suggestion-field">
										<span>Update Target Dog</span>
										<select
											value={suggestion.matchDogId}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													matchDogId: event.currentTarget.value
												}))}
										>
											<option value="">Choose dog</option>
											{#each activeDogs as dog}
												<option value={dog.id}>{dog.name}</option>
											{/each}
										</select>
									</label>
								{/if}

								<label class="suggestion-field">
									<span>Why This Action</span>
									<input
										value={suggestion.reason}
										on:input={(event) =>
											updateSuggestion(suggestion.id, (current) => ({
												...current,
												reason: event.currentTarget.value
										}))}
									/>
								</label>
								<button
									type="button"
									class="intake-btn intake-btn-toggle"
									on:click={() =>
										updateSuggestion(suggestion.id, (current) => ({
											...current,
											showAllFields: !current.showAllFields
										}))}
								>
									{suggestion.showAllFields ? 'Only Show Changes' : 'Show All Fields'}
								</button>
								<p
									class={`suggestion-core-note ${getMissingCoreFields(suggestion.fields).length > 0 ? 'suggestion-core-missing' : ''}`}
								>
									{#if getMissingCoreFields(suggestion.fields).length > 0}
										Missing core: {getMissingCoreFields(suggestion.fields).join(', ')}
									{:else}
										Core fields complete
									{/if}
								</p>

								<div class="suggestion-grid">
									{#if !suggestion.showAllFields && suggestion.action === 'update' && Object.keys(suggestionUpdatePatches[suggestion.id] ?? {}).length === 0}
										<p class="suggestion-diff-empty suggestion-wide">
											No detected field changes for this dog. Use "Show All Fields" to edit manually or set action to Ignore.
										</p>
									{/if}
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'name')}>
										<span>Name</span>
										<input
											value={suggestion.fields.name}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, name: event.currentTarget.value }
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'breed')}>
										<span>Breed</span>
										<input
											value={suggestion.fields.breed}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, breed: event.currentTarget.value }
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'color')}>
										<span>Color</span>
										<input
											value={suggestion.fields.color}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, color: event.currentTarget.value }
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'sex')}>
										<span>Sex</span>
										<select
											value={suggestion.fields.sex}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														sex: normalizeSex(event.currentTarget.value)
													}
												}))}
										>
											{#each sexOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'dateOfBirth')}
									>
										<span>Date of Birth</span>
										<input
											type="date"
											value={suggestion.fields.dateOfBirth}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														dateOfBirth: normalizeDateString(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'weightLbs')}>
										<span>Weight (lbs)</span>
										<input
											type="number"
											min="0"
											step="0.1"
											value={suggestion.fields.weightLbs ?? ''}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														weightLbs: normalizeWeightLbs(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'origin')}>
										<span>Origin</span>
										<input
											value={suggestion.fields.origin}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, origin: event.currentTarget.value }
												}))}
										/>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'originalIntakeDate')}
									>
										<span>Original Entry Date</span>
										<input
											type="date"
											value={suggestion.fields.originalIntakeDate}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														originalIntakeDate: normalizeDateString(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'currentIntakeDate')}
									>
										<span>Current Entry Date</span>
										<input
											type="date"
											value={suggestion.fields.currentIntakeDate}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														currentIntakeDate: normalizeDateString(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'leftShelterDate')}
									>
										<span>Left Shelter Date</span>
										<input
											type="date"
											value={suggestion.fields.leftShelterDate}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														leftShelterDate: normalizeDateString(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'pottyTrained')}>
										<span>Potty Trained</span>
										<select
											value={suggestion.fields.pottyTrained}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														pottyTrained: normalizePotty(event.currentTarget.value)
													}
												}))}
										>
											{#each pottyOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'energyLevel')}>
										<span>Energy</span>
										<select
											value={suggestion.fields.energyLevel}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														energyLevel: normalizeEnergy(event.currentTarget.value)
													}
												}))}
										>
											{#each energyOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'goodWithDogs')}>
										<span>Good With Dogs</span>
										<select
											value={suggestion.fields.goodWithDogs}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														goodWithDogs: normalizeCompatibility(event.currentTarget.value)
													}
												}))}
										>
											{#each compatibilityOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'goodWithCats')}>
										<span>Good With Cats</span>
										<select
											value={suggestion.fields.goodWithCats}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														goodWithCats: normalizeCompatibility(event.currentTarget.value)
													}
												}))}
										>
											{#each compatibilityOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'goodWithKids')}>
										<span>Good With Kids</span>
										<select
											value={suggestion.fields.goodWithKids}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														goodWithKids: normalizeCompatibility(event.currentTarget.value)
													}
												}))}
										>
											{#each compatibilityOptions as option}
												<option value={option.value}>{option.label}</option>
												{/each}
											</select>
										</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'goodWithElderly')}
									>
										<span>Good With Elderly</span>
										<select
											value={suggestion.fields.goodWithElderly}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														goodWithElderly: normalizeCompatibility(event.currentTarget.value)
													}
												}))}
										>
											{#each compatibilityOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'goodOnLead')}>
										<span>Good on Lead</span>
										<select
											value={suggestion.fields.goodOnLead}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														goodOnLead: normalizeCompatibility(event.currentTarget.value)
													}
												}))}
										>
											{#each compatibilityOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'goodTraveller')}
									>
										<span>Good Traveller</span>
										<select
											value={suggestion.fields.goodTraveller}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														goodTraveller: normalizeCompatibility(event.currentTarget.value)
													}
												}))}
										>
											{#each compatibilityOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'crateTrained')}
									>
										<span>Crate Trained</span>
										<select
											value={suggestion.fields.crateTrained}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														crateTrained: normalizeCompatibility(event.currentTarget.value)
													}
												}))}
										>
											{#each compatibilityOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'outdoorKennelAssignment')}
									>
										<span>Kennel</span>
										<input
											value={suggestion.fields.outdoorKennelAssignment}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														outdoorKennelAssignment: event.currentTarget.value
													}
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'inFosterStatus')}>
										<span>In Foster</span>
										<select
											value={suggestion.fields.inFosterStatus}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														inFosterStatus: normalizeFosterStatus(event.currentTarget.value)
													}
												}))}
										>
											{#each medicalOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'microchippedStatus')}
									>
										<span>Microchipped</span>
										<select
											value={suggestion.fields.microchippedStatus}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														microchippedStatus: normalizeMedical(event.currentTarget.value)
													}
												}))}
										>
											{#each medicalOptions as option}
												<option value={option.value}>{option.label}</option>
												{/each}
											</select>
										</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'microchipDate')}
									>
										<span>Microchip Date</span>
										<input
											type="date"
											value={suggestion.fields.microchipDate}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														microchipDate: normalizeDateString(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'vaccinationStatus')}
									>
										<span>Vaccinated</span>
										<select
											value={suggestion.fields.vaccinationStatus}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														vaccinationStatus: normalizeMedical(event.currentTarget.value)
													}
												}))}
										>
											{#each medicalOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label
										class="suggestion-field"
										class:is-hidden={!shouldSurfaceField(suggestion, 'vaccinatedDate')}
									>
										<span>Vaccination Date</span>
										<input
											type="date"
											value={suggestion.fields.vaccinatedDate}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														vaccinatedDate: normalizeDateString(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'fixedStatus')}>
										<span>Spayed/Neutered</span>
										<select
											value={suggestion.fields.fixedStatus}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														fixedStatus: normalizeMedical(event.currentTarget.value)
													}
												}))}
										>
											{#each medicalOptions as option}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'fixedDate')}>
										<span>Fixed Date</span>
										<input
											type="date"
											value={suggestion.fields.fixedDate}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														fixedDate: normalizeDateString(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<label class="suggestion-field" class:is-hidden={!shouldSurfaceField(suggestion, 'surgeryDate')}>
										<span>Surgery Date</span>
										<input
											type="date"
											value={suggestion.fields.surgeryDate}
											on:change={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: {
														...current.fields,
														surgeryDate: normalizeDateString(event.currentTarget.value)
													}
												}))}
										/>
									</label>
									<div
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'reentryDates')}
									>
										<span>Re-entry Dates</span>
										<div class="reentry-editor">
											<div class="reentry-controls">
												<input
													type="date"
													value={suggestion.reentryDateDraft}
													on:change={(event) =>
														updateReentryDateDraft(suggestion.id, event.currentTarget.value)}
													on:keydown={(event) => handleReentryDateKeydown(event, suggestion.id)}
												/>
												<button
													type="button"
													class="intake-btn reentry-add-btn"
													on:click={() => addReentryDate(suggestion.id)}
													disabled={!normalizeDateString(suggestion.reentryDateDraft)}
												>
													Add
												</button>
											</div>
											{#if suggestion.fields.reentryDates.length === 0}
												<p class="reentry-empty">No re-entry dates yet.</p>
											{:else}
												<div class="reentry-chip-list">
													{#each suggestion.fields.reentryDates as reentryDate}
														<div class="reentry-chip">
															<span>{reentryDate}</span>
															<button
																type="button"
																on:click={() => removeReentryDate(suggestion.id, reentryDate)}
																aria-label={`Remove re-entry date ${reentryDate}`}
															>
																x
															</button>
														</div>
													{/each}
												</div>
											{/if}
										</div>
									</div>
									<label
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'idealHome')}
									>
										<span>Best Home Fit</span>
										<textarea
											rows="2"
											value={suggestion.fields.idealHome}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, idealHome: event.currentTarget.value }
												}))}
										></textarea>
									</label>
									<label
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'dietaryNotes')}
									>
										<span>Dietary Notes</span>
										<textarea
											rows="2"
											value={suggestion.fields.dietaryNotes}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, dietaryNotes: event.currentTarget.value }
												}))}
										></textarea>
									</label>
									<label
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'markings')}
									>
										<span>Markings</span>
										<textarea
											rows="2"
											value={suggestion.fields.markings}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, markings: event.currentTarget.value }
												}))}
										></textarea>
									</label>
									<label
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'hiddenComments')}
									>
										<span>Hidden Comments</span>
										<textarea
											rows="2"
											value={suggestion.fields.hiddenComments}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, hiddenComments: event.currentTarget.value }
												}))}
										></textarea>
									</label>
									<label
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'description')}
									>
										<span>Description</span>
										<textarea
											rows="2"
											value={suggestion.fields.description}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, description: event.currentTarget.value }
												}))}
										></textarea>
									</label>
									<label
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'warningNotes')}
									>
										<span>Warning Notes</span>
										<textarea
											rows="2"
											value={suggestion.fields.warningNotes}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, warningNotes: event.currentTarget.value }
												}))}
										></textarea>
									</label>
									<label
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'holdNotes')}
									>
										<span>Hold Notes</span>
										<textarea
											rows="2"
											value={suggestion.fields.holdNotes}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, holdNotes: event.currentTarget.value }
												}))}
										></textarea>
									</label>
									<label
										class="suggestion-field suggestion-wide"
										class:is-hidden={!shouldSurfaceField(suggestion, 'healthProblems')}
									>
										<span>Health Problems</span>
										<textarea
											rows="2"
											value={suggestion.fields.healthProblems}
											on:input={(event) =>
												updateSuggestion(suggestion.id, (current) => ({
													...current,
													fields: { ...current.fields, healthProblems: event.currentTarget.value }
												}))}
										></textarea>
									</label>
								</div>
							</article>
						{/each}
					</div>
				{/if}

				<div class="intake-apply">
					<button
						class="intake-btn intake-btn-fill"
						on:click={applySuggestions}
						disabled={suggestions.length === 0 || applying || analyzing}
					>
						{applying ? 'Applying...' : 'Apply Selected Actions'}
					</button>
				</div>
			</section>
		</div>
	{/if}
</section>

<style>
	.intake-board {
		border: 1px solid #d5e0ea;
		background: rgba(255, 255, 255, 0.9);
		max-width: 100%;
		min-width: 0;
		overflow-x: clip;
		box-sizing: border-box;
	}

	.intake-header {
		padding: 0.84rem;
		border-bottom: 1px solid #d5e0ea;
	}

	.intake-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: clamp(1.35rem, 5.1vw, 1.92rem);
		text-transform: uppercase;
	}

	.intake-sub {
		margin: 0.24rem 0 0;
		font-size: 0.98rem;
	}

	.intake-warning {
		margin: 0;
		padding: 0.9rem;
		color: #7f312f;
		background: #fff1ef;
		border-top: 1px solid #e6c5c0;
	}

	.intake-grid {
		display: grid;
		gap: 0;
		min-width: 0;
	}

	.intake-upload,
	.intake-review {
		border-top: 1px solid #d5e0ea;
		padding: 0.82rem;
		background: #ffffff;
		min-width: 0;
		box-sizing: border-box;
	}

	.intake-upload h3,
	.intake-review h3 {
		margin: 0 0 0.6rem;
		font-family: var(--font-ui);
		font-size: clamp(1.28rem, 5.8vw, 1.8rem);
		font-weight: 400;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		line-height: 1.02;
	}

	.intake-upload-actions {
		margin-top: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.38rem;
	}

	.intake-text-input {
		margin-top: 0.58rem;
	}

	.intake-text-input textarea {
		font-family: var(--font-typewriter);
		font-size: 0.72rem;
		line-height: 1.35;
	}

	.intake-btn {
		min-height: 2.04rem;
		border: 1px solid #d5e0ea;
		border-radius: 0.24rem;
		padding: 0.22rem 0.66rem;
		background: #ffffff;
		font-family: var(--font-typewriter);
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #223246;
		font-weight: 700;
	}

	.intake-btn-fill {
		background: #dcebf8;
	}

	.intake-btn-toggle {
		width: fit-content;
	}

	.intake-btn:disabled {
		opacity: 0.58;
		cursor: not-allowed;
	}

	.intake-error {
		margin: 0.54rem 0 0;
		padding: 0.42rem 0.48rem;
		border: 1px solid #e5b9b2;
		background: #fff1ee;
		color: #8f3f3b;
		font-size: 0.78rem;
	}

	.intake-preview {
		margin-top: 0.58rem;
		border: 2px solid rgba(32, 48, 70, 0.32);
		background: #f6f9fc;
		overflow: hidden;
	}

	.intake-preview img {
		width: 100%;
		display: block;
		max-height: 18rem;
		object-fit: contain;
	}

	.intake-model {
		margin: 0.5rem 0 0;
		font-size: 0.56rem;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #465d79;
	}

	.intake-notes {
		margin-top: 0.5rem;
		border: 1px dashed #bdc8d8;
		padding: 0.4rem 0.45rem;
		background: #fbfdff;
	}

	.intake-notes p {
		margin: 0 0 0.18rem;
		font-size: 0.55rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #4c627d;
	}

	.intake-notes ul {
		margin: 0;
		padding-left: 0.95rem;
		font-size: 0.7rem;
		color: #2c3c52;
	}

	.intake-review-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.intake-review-head span {
		font-size: 0.56rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #435a76;
	}

	.intake-priority-note {
		margin: 0.34rem 0 0;
		font-size: 0.54rem;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #3f5774;
		overflow-wrap: anywhere;
	}

	.intake-empty {
		margin: 0.42rem 0 0;
		color: #586e89;
		font-size: 0.62rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.intake-suggestions {
		margin-top: 0.48rem;
		display: grid;
		gap: 0.58rem;
		max-height: 34rem;
		overflow: auto;
		padding-right: 0.22rem;
		min-width: 0;
	}

	.suggestion-card {
		border: 2px solid rgba(32, 48, 70, 0.33);
		background: #fdfefe;
		padding: 0.5rem;
		display: grid;
		gap: 0.42rem;
		min-width: 0;
	}

	.suggestion-top {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: stretch;
		gap: 0.35rem;
		min-width: 0;
	}

	.suggestion-checkbox {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		min-height: 1.9rem;
		font-size: 0.56rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #334a66;
	}

	.suggestion-field {
		display: grid;
		gap: 0.16rem;
		min-width: 0;
		width: 100%;
	}

	.suggestion-field span {
		font-size: 0.52rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #4c627d;
	}

	.suggestion-field input,
	.suggestion-field select,
	.suggestion-field textarea {
		width: 100%;
		border: 1.5px solid #bec9d8;
		border-radius: 0.22rem;
		padding: 0.38rem 0.45rem;
		font-size: 1rem;
		color: #24374f;
		background: #ffffff;
	}

	.suggestion-core-note {
		margin: 0;
		font-size: 0.56rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #2d5d42;
		overflow-wrap: anywhere;
	}

	.suggestion-core-missing {
		color: #8b3d3a;
	}

	.suggestion-diff-empty {
		margin: 0;
		padding: 0.44rem 0.5rem;
		border: 1px dashed #c4d0df;
		background: #f7fbff;
		font-size: 0.66rem;
		color: #45607f;
		overflow-wrap: anywhere;
	}

	.suggestion-grid {
		display: grid;
		gap: 0.34rem;
		min-width: 0;
	}

	.suggestion-wide {
		grid-column: 1 / -1;
	}

	.is-hidden {
		display: none;
	}

	.reentry-editor {
		border: 1.5px dashed #bcc9d8;
		background: #f8fbff;
		border-radius: 0.24rem;
		padding: 0.42rem;
	}

	.reentry-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.34rem;
		align-items: center;
	}

	.reentry-controls input[type='date'] {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.reentry-add-btn {
		min-height: 2.1rem;
		padding-inline: 0.68rem;
	}

	.reentry-empty {
		margin: 0.42rem 0 0;
		font-size: 0.66rem;
		color: #4f6582;
	}

	.reentry-chip-list {
		margin-top: 0.42rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.32rem;
	}

	.reentry-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.24rem;
		border: 1.5px solid #abc2dc;
		background: #e9f3ff;
		color: #1f3550;
		border-radius: 999px;
		padding: 0.18rem 0.24rem 0.18rem 0.5rem;
		font-size: 0.69rem;
	}

	.reentry-chip button {
		border: 0;
		background: #ffffff;
		color: #274766;
		border-radius: 999px;
		width: 1.1rem;
		height: 1.1rem;
		line-height: 1;
		font-size: 0.68rem;
		font-weight: 700;
		cursor: pointer;
	}

	.intake-apply {
		margin-top: 0.58rem;
	}

	@media (min-width: 1080px) {
		.intake-grid {
			grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
			align-items: start;
		}

		.intake-review {
			border-top: none;
			border-left: 3px solid #016ba5;
		}

		.suggestion-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 680px) {
		.suggestion-top {
			grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
			align-items: end;
		}
	}
</style>
