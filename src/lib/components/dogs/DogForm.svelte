<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type {
		Compatibility,
		DateValue,
		DayTripIneligibleReason,
		DayTripStatus,
		Dog,
		DogSex,
		DogStatus,
		EnergyLevel,
		IsolationStatus,
		PottyTrainedStatus
	} from '$lib/types';
	import { isMondayOrThursday, formatDate, toDate } from '$lib/utils/dates';
	import { estimateFoodAmountPerMeal } from '$lib/utils/feeding';
	import { deleteDogPhotoByUrl, uploadDogPhotoDataUrl } from '$lib/firebase/storage';
	import { getStorageUploadErrorMessage } from '$lib/firebase/errors';

	export let value: Dog;
	export let disabled = false;
	const dispatch = createEventDispatcher();

	let surgeryError = '';
	let suggestedFoodAmount = '';
	let lastAutoFoodAmount = '';
	let photoUploadError = '';
	let photoUploading = false;
	const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
	const MAX_PHOTO_DATA_URL_LENGTH = 900_000;
	const MAX_PHOTO_SIDE = 1200;

	const foodTypes = ['Normal', 'No Chicken or Fish', 'Puppy Food'];
	const sexOptions: { value: DogSex; label: string }[] = [
		{ value: 'unknown', label: 'Unknown' },
		{ value: 'male', label: 'Male' },
		{ value: 'female', label: 'Female' }
	];
	const pottyOptions: { value: PottyTrainedStatus; label: string }[] = [
		{ value: 'unknown', label: 'Unknown' },
		{ value: 'yes', label: 'Yes' },
		{ value: 'working_on_it', label: 'Working on it' },
		{ value: 'no', label: 'No' }
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
	const dayTripStatuses: { value: DayTripStatus; label: string; description: string }[] = [
		{ value: 'eligible', label: 'Eligible', description: 'Anyone can take on day trips' },
		{ value: 'difficult', label: 'Difficult', description: 'Adults only' },
		{ value: 'ineligible', label: 'No Day Trips', description: 'Blocked for day trips' }
	];
	const managerOnlyReasons: { value: DayTripIneligibleReason; label: string }[] = [
		{ value: 'behavior', label: 'Behavior' },
		{ value: 'medical', label: 'Medical' },
		{ value: 'other', label: 'Other' }
	];
	const ineligibleReasons: { value: DayTripIneligibleReason; label: string }[] = [
		{ value: 'other', label: 'No day trips' }
	];
	const statusOptions: { value: DogStatus; label: string }[] = [
		{ value: 'active', label: 'Active' },
		{ value: 'adopted', label: 'Adopted' }
	];
	const isolationStatuses: { value: IsolationStatus; label: string }[] = [
		{ value: 'none', label: 'Not in Isolation' },
		{ value: 'sick', label: 'Sick' },
		{ value: 'bite_quarantine', label: 'Bite Quarantine' }
	];

	$: isInIsolation = value.isolationStatus !== 'none';
	$: isManagerOnly = value.dayTripManagerOnly === true && !isInIsolation;
	$: isManualIneligible = value.dayTripStatus === 'ineligible' && !isInIsolation && !isManagerOnly;
	$: selectedIneligibleReason = value.dayTripIneligibleReason ?? 'other';
	$: selectedManagerOnlyReason = value.dayTripManagerOnlyReason ?? 'other';
	$: needsReason = value.dayTripStatus === 'difficult' || isManualIneligible || isManagerOnly;
	$: suggestedFoodAmount = estimateFoodAmountPerMeal({
		weightLbs: value.weightLbs,
		dateOfBirth: value.dateOfBirth,
		foodType: value.foodType
	});

	function handleDateChange(field: keyof Dog, dateValue: string) {
		const date = dateValue ? new Date(dateValue) : null;
		const next = { ...value, [field]: date } as Dog;
		value = field === 'dateOfBirth' ? maybeAutofillFoodAmount(value, next) : next;
		if (field === 'surgeryDate') {
			surgeryError = date && !isMondayOrThursday(date) ? 'Surgery must be scheduled on Monday or Thursday.' : '';
		}
		dispatch('change', { value, valid: !surgeryError });
	}

	function handleDateTimeChange(field: keyof Dog, dateValue: string) {
		const date = dateValue ? new Date(dateValue) : null;
		value = { ...value, [field]: date } as Dog;
		dispatch('change', { value, valid: !surgeryError });
	}

	function handleInput(field: keyof Dog, newValue: string) {
		value = { ...value, [field]: newValue } as Dog;
		if (field === 'foodAmount') {
			const current = (newValue ?? '').trim();
			if (!current) {
				lastAutoFoodAmount = '';
			} else if (current === suggestedFoodAmount) {
				lastAutoFoodAmount = suggestedFoodAmount;
			}
		}
		dispatch('change', { value, valid: !surgeryError });
	}

	function handleCheckbox(field: keyof Dog, checked: boolean) {
		value = { ...value, [field]: checked } as Dog;
		dispatch('change', { value, valid: !surgeryError });
	}

	function handleOwnFoodChange(checked: boolean) {
		value = {
			...value,
			hasOwnFood: checked,
			transitionToHills: checked ? (value.transitionToHills ?? null) : null
		} as Dog;
		dispatch('change', { value, valid: !surgeryError });
	}

	function handleTransitionToHillsSelect(newValue: string) {
		const transitionToHills = newValue === 'yes' ? true : newValue === 'no' ? false : null;
		value = { ...value, transitionToHills } as Dog;
		dispatch('change', { value, valid: !surgeryError });
	}

	function handleSelect(field: keyof Dog, newValue: string) {
		if (field === 'dayTripStatus') {
			const nextStatus = newValue as DayTripStatus;
			value = {
				...value,
				dayTripStatus: nextStatus,
				dayTripIneligibleReason:
					nextStatus === 'ineligible'
						? (value.dayTripManagerOnly ? null : (value.dayTripIneligibleReason ?? 'other'))
						: null
			} as Dog;
			dispatch('change', { value, valid: !surgeryError });
			return;
		}

		const next = { ...value, [field]: newValue } as Dog;
		value = field === 'foodType' ? maybeAutofillFoodAmount(value, next) : next;
		dispatch('change', { value, valid: !surgeryError });
	}

	async function handlePhotoUpload(event: Event) {
		const input = event.currentTarget as HTMLInputElement | null;
		const file = input?.files?.[0];
		photoUploadError = '';

		if (!file) return;
		if (!file.type.startsWith('image/')) {
			photoUploadError = 'Please choose an image file.';
			if (input) input.value = '';
			return;
		}
		if (file.size > MAX_PHOTO_BYTES) {
			photoUploadError = 'Photo is too large. Use an image under 8MB.';
			if (input) input.value = '';
			return;
		}

		try {
			photoUploading = true;
			const source = await readFileAsDataUrl(file);
			const optimized = await optimizePhoto(source, file.type);
			if (optimized.length > MAX_PHOTO_DATA_URL_LENGTH) {
				photoUploadError = 'Photo is still too large after compression. Try a smaller image.';
				return;
			}
			const previousPhotoUrl = value.photoUrl;
			const uploadedUrl = await uploadDogPhotoDataUrl(optimized, {
				dogId: value.id && value.id !== 'draft' ? value.id : null,
				mimeType: file.type
			});
			value = { ...value, photoUrl: uploadedUrl } as Dog;
			dispatch('change', { value, valid: !surgeryError });
			if (previousPhotoUrl && previousPhotoUrl !== uploadedUrl) {
				try {
					await deleteDogPhotoByUrl(previousPhotoUrl);
				} catch (cleanupError) {
					console.warn('Previous dog photo cleanup failed', cleanupError);
				}
			}
		} catch (error) {
			console.error(error);
			photoUploadError = getStorageUploadErrorMessage(error);
		} finally {
			photoUploading = false;
			if (input) input.value = '';
		}
	}

	async function clearPhoto() {
		photoUploadError = '';
		const previousPhotoUrl = value.photoUrl;
		if (!previousPhotoUrl) return;
		try {
			photoUploading = true;
			await deleteDogPhotoByUrl(previousPhotoUrl);
		} catch (error) {
			console.error(error);
		} finally {
			photoUploading = false;
		}
		value = { ...value, photoUrl: null } as Dog;
		dispatch('change', { value, valid: !surgeryError });
	}

	function readFileAsDataUrl(file: File) {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				if (typeof reader.result === 'string') resolve(reader.result);
				else reject(new Error('Could not read image file.'));
			};
			reader.onerror = () => reject(reader.error ?? new Error('Could not read image file.'));
			reader.readAsDataURL(file);
		});
	}

	function loadImage(dataUrl: string) {
		return new Promise<HTMLImageElement>((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error('Could not load image.'));
			image.src = dataUrl;
		});
	}

	async function optimizePhoto(dataUrl: string, mimeType: string) {
		const image = await loadImage(dataUrl);
		const longestSide = Math.max(image.width || 1, image.height || 1);
		const scale = Math.min(1, MAX_PHOTO_SIDE / longestSide);
		const width = Math.max(1, Math.round((image.width || 1) * scale));
		const height = Math.max(1, Math.round((image.height || 1) * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Could not process image.');
		context.drawImage(image, 0, 0, width, height);
		const outputType = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
		return outputType === 'image/png'
			? canvas.toDataURL(outputType)
			: canvas.toDataURL(outputType, 0.82);
	}

	function handleManagerOnlyToggle(checked: boolean) {
		const shouldRestoreEligible = !checked && value.dayTripStatus === 'ineligible' && value.dayTripIneligibleReason === null;
		const next: Dog = {
			...value,
			dayTripManagerOnly: checked,
			dayTripManagerOnlyReason: checked ? (value.dayTripManagerOnlyReason ?? 'behavior') : null,
			dayTripStatus: checked ? 'ineligible' : shouldRestoreEligible ? 'eligible' : value.dayTripStatus,
			dayTripIneligibleReason: checked ? null : value.dayTripIneligibleReason
		};
		value = next;
		dispatch('change', { value, valid: !surgeryError });
	}

	function handleManagerOnlyReasonSelect(reason: DayTripIneligibleReason) {
		const next: Dog = {
			...value,
			dayTripManagerOnly: true,
			dayTripManagerOnlyReason: reason,
			dayTripStatus: 'ineligible',
			dayTripIneligibleReason: null
		};
		value = next;
		dispatch('change', { value, valid: !surgeryError });
	}

	function handleIneligibleReasonSelect(reason: DayTripIneligibleReason) {
		value = {
			...value,
			dayTripStatus: 'ineligible',
			dayTripIneligibleReason: reason
		} as Dog;
		dispatch('change', { value, valid: !surgeryError });
	}

	function parseWeightLbs(input: string): number | null {
		const parsed = Number(input);
		if (!Number.isFinite(parsed) || parsed <= 0) return null;
		return Math.round(parsed * 10) / 10;
	}

	function handleWeightInput(input: string) {
		const next = { ...value, weightLbs: parseWeightLbs(input) } as Dog;
		value = maybeAutofillFoodAmount(value, next);
		dispatch('change', { value, valid: !surgeryError });
	}

	function maybeAutofillFoodAmount(previous: Dog, next: Dog): Dog {
		const nextSuggestion = estimateFoodAmountPerMeal({
			weightLbs: next.weightLbs,
			dateOfBirth: next.dateOfBirth,
			foodType: next.foodType
		});
		const previousSuggestion = estimateFoodAmountPerMeal({
			weightLbs: previous.weightLbs,
			dateOfBirth: previous.dateOfBirth,
			foodType: previous.foodType
		});
		const currentFoodAmount = (next.foodAmount ?? '').trim();
		const shouldAutofill =
			!currentFoodAmount ||
			currentFoodAmount === lastAutoFoodAmount ||
			(previousSuggestion !== '' && currentFoodAmount === previousSuggestion);

		if (nextSuggestion && shouldAutofill) {
			lastAutoFoodAmount = nextSuggestion;
			if (currentFoodAmount === nextSuggestion) return next;
			return { ...next, foodAmount: nextSuggestion } as Dog;
		}

		if (!nextSuggestion && shouldAutofill && currentFoodAmount) {
			lastAutoFoodAmount = '';
			return { ...next, foodAmount: '' } as Dog;
		}

		if (!currentFoodAmount || currentFoodAmount === nextSuggestion) {
			lastAutoFoodAmount = nextSuggestion;
		}

		return next;
	}

	function setReentryDate(index: number, dateValue: string) {
		const next = [...(value.reentryDates ?? [])];
		if (!dateValue) {
			next.splice(index, 1);
		} else {
			next[index] = new Date(dateValue);
		}
		value = { ...value, reentryDates: normalizeReentryDates(next) };
		dispatch('change', { value, valid: !surgeryError });
	}

	function addReentryDate() {
		const seed = toDate(value.intakeDate) ?? new Date();
		const next = [...(value.reentryDates ?? []), seed];
		value = { ...value, reentryDates: normalizeReentryDates(next) };
		dispatch('change', { value, valid: !surgeryError });
	}

	function removeReentryDate(index: number) {
		const next = [...(value.reentryDates ?? [])];
		next.splice(index, 1);
		value = { ...value, reentryDates: normalizeReentryDates(next) };
		dispatch('change', { value, valid: !surgeryError });
	}

	function normalizeReentryDates(values: Array<DateValue | string | null | undefined>) {
		return values
			.map((item) => toDate(item))
			.filter((item): item is Date => Boolean(item))
			.sort((a, b) => a.getTime() - b.getTime());
	}
</script>

<div class="grid gap-4 md:grid-cols-2">
	<div class="form-field">
		<label class="form-label typewriter">Name</label>
		<input
			class="form-input"
			disabled={disabled}
			bind:value={value.name}
			on:input={(event) => handleInput('name', event.currentTarget.value)}
		/>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Breed</label>
		<input
			class="form-input"
			disabled={disabled}
			bind:value={value.breed}
			on:input={(event) => handleInput('breed', event.currentTarget.value)}
		/>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Sex</label>
		<select
			class="form-input"
			disabled={disabled}
			bind:value={value.sex}
			on:change={(event) => handleSelect('sex', event.currentTarget.value)}
		>
			{#each sexOptions as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Outdoor Kennel</label>
		<input
			class="form-input"
			disabled={disabled}
			bind:value={value.outdoorKennelAssignment}
			on:input={(event) => handleInput('outdoorKennelAssignment', event.currentTarget.value)}
		/>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Date of Birth</label>
		<input
			type="date"
			class="form-input"
			disabled={disabled}
			value={toDate(value.dateOfBirth)?.toISOString().slice(0, 10) ?? ''}
			on:change={(event) => handleDateChange('dateOfBirth', event.currentTarget.value)}
		/>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Weight (lbs)</label>
		<input
			type="number"
			min="0"
			step="0.1"
			class="form-input"
			disabled={disabled}
			value={value.weightLbs ?? ''}
			on:input={(event) => handleWeightInput(event.currentTarget.value)}
		/>
		{#if suggestedFoodAmount}
			<p class="form-hint">Chart suggestion: {suggestedFoodAmount} per meal.</p>
		{/if}
	</div>
	<div class="form-field md:col-span-2">
		<label class="form-label typewriter">Photo</label>
		<div class="form-photo-shell">
			<div class="form-photo-preview-wrap">
				{#if value.photoUrl}
					<img
						class="form-photo-preview"
						src={value.photoUrl}
						alt={`Photo of ${value.name || 'dog'}`}
						loading="lazy"
					/>
				{:else}
					<div class="form-photo-placeholder typewriter">No photo uploaded</div>
				{/if}
			</div>
				<div class="form-photo-actions">
					<input
						type="file"
						accept="image/*"
						class="form-input form-file-input"
						disabled={disabled || photoUploading}
						on:change={handlePhotoUpload}
					/>
					{#if value.photoUrl}
						<button
							type="button"
							class="form-choice-btn"
							disabled={disabled || photoUploading}
							on:click={clearPhoto}
						>
							Remove Photo
						</button>
					{/if}
				</div>
			</div>
			<p class="form-hint">
				{#if photoUploading}
					Uploading to Firebase...
				{:else}
					Upload from your phone or computer. Saved to Firebase with this dog profile.
				{/if}
			</p>
			{#if photoUploadError}
				<p class="form-error">{photoUploadError}</p>
			{/if}
		</div>
	<div class="form-section md:col-span-2">
		<h4 class="form-section-title permanent-marker">Shelter Entry History</h4>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="form-field">
				<label class="form-label typewriter">Original Entry Date</label>
				<input
					type="date"
					class="form-input"
					disabled={disabled}
					value={toDate(value.originalIntakeDate)?.toISOString().slice(0, 10) ?? ''}
					on:change={(event) => handleDateChange('originalIntakeDate', event.currentTarget.value)}
				/>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Current Entry Date</label>
				<input
					type="date"
					class="form-input"
					disabled={disabled}
					value={toDate(value.intakeDate)?.toISOString().slice(0, 10) ?? ''}
					on:change={(event) => handleDateChange('intakeDate', event.currentTarget.value)}
				/>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Left Shelter Date</label>
				<input
					type="date"
					class="form-input"
					disabled={disabled}
					value={toDate(value.leftShelterDate)?.toISOString().slice(0, 10) ?? ''}
					on:change={(event) => handleDateChange('leftShelterDate', event.currentTarget.value)}
				/>
			</div>
		</div>
		<div class="form-field">
			<label class="form-label typewriter">Re-entry Dates (Returns)</label>
			{#if (value.reentryDates ?? []).length === 0}
				<p class="form-hint">No re-entry dates logged yet.</p>
			{:else}
				<div class="entry-history-list">
					{#each value.reentryDates as reentryDate, index}
						<div class="entry-history-row">
							<input
								type="date"
								class="form-input"
								disabled={disabled}
								value={toDate(reentryDate)?.toISOString().slice(0, 10) ?? ''}
								on:change={(event) => setReentryDate(index, event.currentTarget.value)}
							/>
							<button
								type="button"
								class="entry-history-remove"
								disabled={disabled}
								on:click={() => removeReentryDate(index)}
							>
								Remove
							</button>
						</div>
					{/each}
				</div>
			{/if}
			<button
				type="button"
				class="form-choice-btn entry-history-add"
				disabled={disabled}
				on:click={addReentryDate}
			>
				Add Re-entry Date
			</button>
			<p class="form-hint">Use one row for each time this dog was brought back to the shelter.</p>
		</div>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Food Type</label>
		<select
			class="form-input"
			disabled={disabled}
			bind:value={value.foodType}
			on:change={(event) => handleSelect('foodType', event.currentTarget.value)}
		>
			{#each foodTypes as food}
				<option value={food}>{food}</option>
			{/each}
		</select>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Food Amount</label>
		<input
			class="form-input"
			disabled={disabled}
			bind:value={value.foodAmount}
			on:input={(event) => handleInput('foodAmount', event.currentTarget.value)}
		/>
		{#if suggestedFoodAmount}
			<p class="form-hint">Auto-filled from chart using current weight.</p>
		{/if}
	</div>
	<div class="form-field md:col-span-2">
		<label class="form-label typewriter">Dietary Notes</label>
		<textarea
			class="form-textarea"
			disabled={disabled}
			bind:value={value.dietaryNotes}
			on:input={(event) => handleInput('dietaryNotes', event.currentTarget.value)}
		></textarea>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Has Own Food</label>
		<label class="flex items-center gap-2 cursor-pointer">
			<input
				type="checkbox"
				class="form-checkbox"
				disabled={disabled}
				checked={value.hasOwnFood ?? false}
				on:change={(event) => handleOwnFoodChange(event.currentTarget.checked)}
			/>
			<span class="text-sm" style="color: var(--marker-black);">Dog came with personal food</span>
		</label>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Transition to Hills</label>
		<select
			class="form-input"
			disabled={disabled || !(value.hasOwnFood ?? false)}
			value={value.transitionToHills === true ? 'yes' : value.transitionToHills === false ? 'no' : ''}
			on:change={(event) => handleTransitionToHillsSelect(event.currentTarget.value)}
		>
			<option value="">Select plan</option>
			<option value="yes">Yes, transition to Hills</option>
			<option value="no">No, keep own food</option>
		</select>
		{#if !(value.hasOwnFood ?? false)}
			<p class="form-hint">Only applies when dog has own food.</p>
		{/if}
	</div>
	<div class="form-section md:col-span-2">
		<h4 class="form-section-title permanent-marker">Meet and Greet Profile</h4>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="form-field">
				<label class="form-label typewriter">Where They Came From</label>
				<input
					class="form-input"
					disabled={disabled}
					placeholder="Owner surrender, transfer, stray, etc."
					bind:value={value.origin}
					on:input={(event) => handleInput('origin', event.currentTarget.value)}
				/>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Potty Trained</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.pottyTrained}
					on:change={(event) => handleSelect('pottyTrained', event.currentTarget.value)}
				>
					{#each pottyOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Good With Dogs</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.goodWithDogs}
					on:change={(event) => handleSelect('goodWithDogs', event.currentTarget.value)}
				>
					{#each compatibilityOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Good With Cats</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.goodWithCats}
					on:change={(event) => handleSelect('goodWithCats', event.currentTarget.value)}
				>
					{#each compatibilityOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Good With Children</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.goodWithKids}
					on:change={(event) => handleSelect('goodWithKids', event.currentTarget.value)}
				>
					{#each compatibilityOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Good With Elderly</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.goodWithElderly}
					on:change={(event) => handleSelect('goodWithElderly', event.currentTarget.value)}
				>
					{#each compatibilityOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Good On Lead</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.goodOnLead}
					on:change={(event) => handleSelect('goodOnLead', event.currentTarget.value)}
				>
					{#each compatibilityOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Good Traveller</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.goodTraveller}
					on:change={(event) => handleSelect('goodTraveller', event.currentTarget.value)}
				>
					{#each compatibilityOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Crate Trained</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.crateTrained}
					on:change={(event) => handleSelect('crateTrained', event.currentTarget.value)}
				>
					{#each compatibilityOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Energy Level</label>
				<select
					class="form-input"
					disabled={disabled}
					bind:value={value.energyLevel}
					on:change={(event) => handleSelect('energyLevel', event.currentTarget.value)}
				>
					{#each energyOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-field md:col-span-2">
				<label class="form-label typewriter">Best Home Fit</label>
				<textarea
					class="form-textarea"
					disabled={disabled}
					placeholder="Describe what kind of home is best for this dog."
					bind:value={value.idealHome}
					on:input={(event) => handleInput('idealHome', event.currentTarget.value)}
				></textarea>
			</div>
		</div>
	</div>
	<div class="form-section md:col-span-2">
		<h4 class="form-section-title permanent-marker">Behavior and Notes</h4>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="form-field md:col-span-2">
				<label class="form-label typewriter">Description</label>
				<textarea
					class="form-textarea"
					disabled={disabled}
					placeholder="Public-facing dog description."
					value={value.description ?? ''}
					on:input={(event) => handleInput('description', event.currentTarget.value)}
				></textarea>
			</div>
			<div class="form-field md:col-span-2">
				<label class="form-label typewriter">Markings</label>
				<textarea
					class="form-textarea"
					disabled={disabled}
					placeholder="Distinctive markings or appearance notes."
					value={value.markings ?? ''}
					on:input={(event) => handleInput('markings', event.currentTarget.value)}
				></textarea>
			</div>
			<div class="form-field md:col-span-2">
				<label class="form-label typewriter">Warning Notes</label>
				<textarea
					class="form-textarea"
					disabled={disabled}
					placeholder="Handling warnings for staff/volunteers."
					value={value.warningNotes ?? ''}
					on:input={(event) => handleInput('warningNotes', event.currentTarget.value)}
				></textarea>
			</div>
			<div class="form-field md:col-span-2">
				<label class="form-label typewriter">Hold Notes</label>
				<textarea
					class="form-textarea"
					disabled={disabled}
					placeholder="Adoption or care hold notes."
					value={value.holdNotes ?? ''}
					on:input={(event) => handleInput('holdNotes', event.currentTarget.value)}
				></textarea>
			</div>
			<div class="form-field md:col-span-2">
				<label class="form-label typewriter">Hidden Comments (Staff)</label>
				<textarea
					class="form-textarea"
					disabled={disabled}
					placeholder="Internal staff-only comments."
					value={value.hiddenComments ?? ''}
					on:input={(event) => handleInput('hiddenComments', event.currentTarget.value)}
				></textarea>
			</div>
		</div>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Surgery Date</label>
		<input
			type="date"
			class={`form-input ${surgeryError ? 'form-input-error' : ''}`}
			disabled={disabled}
			value={toDate(value.surgeryDate)?.toISOString().slice(0, 10) ?? ''}
			on:change={(event) => handleDateChange('surgeryDate', event.currentTarget.value)}
		/>
		{#if value.surgeryDate}
			<p class="form-hint">Currently: {formatDate(value.surgeryDate)}</p>
		{/if}
		{#if surgeryError}
			<p class="form-error">{surgeryError}</p>
		{/if}
	</div>

	<div class="form-section md:col-span-2">
		<h4 class="form-section-title permanent-marker">Medical Status</h4>
			<div class="grid gap-4 md:grid-cols-2">
				<div class="form-inline-row">
					<label class="flex items-center gap-2 cursor-pointer min-w-0">
						<input
							type="checkbox"
							class="form-checkbox"
							disabled={disabled}
							checked={value.isMicrochipped}
							on:change={(event) => handleCheckbox('isMicrochipped', event.currentTarget.checked)}
						/>
						<span class="text-sm" style="color: var(--marker-black);">Microchipped</span>
					</label>
					{#if value.isMicrochipped}
						<input
							type="date"
							class="form-input form-inline-date"
							disabled={disabled}
							placeholder="Date"
							value={toDate(value.microchipDate)?.toISOString().slice(0, 10) ?? ''}
							on:change={(event) => handleDateChange('microchipDate', event.currentTarget.value)}
						/>
					{/if}
				</div>
				<div class="form-inline-row">
					<label class="flex items-center gap-2 cursor-pointer min-w-0">
						<input
							type="checkbox"
							class="form-checkbox"
						disabled={disabled}
						checked={value.isVaccinated}
						on:change={(event) => handleCheckbox('isVaccinated', event.currentTarget.checked)}
					/>
					<span class="text-sm" style="color: var(--marker-black);">Vaccinated</span>
				</label>
					{#if value.isVaccinated}
						<input
							type="date"
							class="form-input form-inline-date"
							disabled={disabled}
							placeholder="Date"
							value={toDate(value.vaccinatedDate)?.toISOString().slice(0, 10) ?? ''}
							on:change={(event) => handleDateChange('vaccinatedDate', event.currentTarget.value)}
						/>
					{/if}
				</div>
				<div class="form-inline-row">
					<label class="flex items-center gap-2 cursor-pointer min-w-0">
						<input
							type="checkbox"
							class="form-checkbox"
						disabled={disabled}
						checked={value.isFixed}
						on:change={(event) => handleCheckbox('isFixed', event.currentTarget.checked)}
					/>
					<span class="text-sm" style="color: var(--marker-black);">Spayed/Neutered</span>
				</label>
					{#if value.isFixed}
						<input
							type="date"
							class="form-input form-inline-date"
							disabled={disabled}
							placeholder="Date"
							value={toDate(value.fixedDate)?.toISOString().slice(0, 10) ?? ''}
							on:change={(event) => handleDateChange('fixedDate', event.currentTarget.value)}
						/>
					{/if}
				</div>
			<div class="form-field md:col-span-2">
				<label class="form-label typewriter">Health Problems</label>
				<textarea
					class="form-textarea"
					disabled={disabled}
					placeholder="Known health issues or monitoring needs."
					value={value.healthProblems ?? ''}
					on:input={(event) => handleInput('healthProblems', event.currentTarget.value)}
				></textarea>
			</div>
		</div>
	</div>

	<div class="form-section md:col-span-2">
		<h4 class="form-section-title permanent-marker">Isolation Status</h4>
		<div class="flex flex-wrap gap-2">
			{#each isolationStatuses as iso}
				<button
					type="button"
					class={`form-choice-btn ${
						value.isolationStatus === iso.value
							? iso.value === 'none' ? 'form-choice-green'
							: 'form-choice-red'
							: ''
					}`}
					disabled={disabled}
					on:click={() => handleSelect('isolationStatus', iso.value)}
				>
					{iso.label}
				</button>
			{/each}
		</div>
			<div class="form-inline-row mt-3">
				<label class="form-hint">Start Date:</label>
				<input
					type="date"
					class="form-input form-inline-date"
					disabled={disabled}
					value={toDate(value.isolationStartDate)?.toISOString().slice(0, 10) ?? ''}
					on:change={(event) => handleDateChange('isolationStartDate', event.currentTarget.value)}
			/>
		</div>
	</div>

	<div class="form-field md:col-span-2">
		<label class="form-label typewriter">Foster Status</label>
		<label class="flex items-center gap-2 cursor-pointer">
			<input
				type="checkbox"
				class="form-checkbox"
				disabled={disabled}
				checked={value.inFoster}
				on:change={(event) => handleCheckbox('inFoster', event.currentTarget.checked)}
			/>
			<span class="text-sm" style="color: var(--marker-black);">Currently in foster</span>
		</label>
		<p class="form-hint">If checked, this dog appears in the dashboard foster list.</p>
	</div>
	<div class="form-field">
		<label class="form-label typewriter">Record Status</label>
		<select
			class="form-input"
			disabled={disabled}
			bind:value={value.status}
			on:change={(event) => handleSelect('status', event.currentTarget.value)}
		>
			{#each statusOptions as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</div>

	<div class="form-field md:col-span-2">
		<label class="form-label typewriter">Day Trip Status</label>
		{#if isInIsolation}
			<p class="form-error">Automatically ineligible due to isolation ({value.isolationStatus === 'sick' ? 'Sick' : 'Bite Quarantine'})</p>
		{:else}
			<label class="flex items-center gap-2 cursor-pointer mb-2">
				<input
					type="checkbox"
					class="form-checkbox"
					disabled={disabled}
					checked={isManagerOnly}
					on:change={(event) => handleManagerOnlyToggle(event.currentTarget.checked)}
				/>
				<span class="text-sm" style="color: var(--marker-black);">Manager only</span>
			</label>

			{#if isManagerOnly}
				<div class="mb-2">
					<p class="form-hint mb-1">Manager-only reason:</p>
					<div class="flex flex-wrap gap-2">
						{#each managerOnlyReasons as reason}
							<button
								type="button"
								class={`form-choice-btn ${selectedManagerOnlyReason === reason.value ? 'form-choice-purple' : ''}`}
								disabled={disabled}
								on:click={() => handleManagerOnlyReasonSelect(reason.value)}
							>
								{reason.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<div class="flex flex-wrap gap-2">
				{#each dayTripStatuses as status}
					<button
						type="button"
						class={`form-choice-btn ${
							value.dayTripStatus === status.value
								? status.value === 'eligible' ? 'form-choice-green'
								: status.value === 'difficult' ? 'form-choice-yellow'
								: 'form-choice-red'
								: ''
						}`}
						disabled={disabled || isManagerOnly}
						on:click={() => handleSelect('dayTripStatus', status.value)}
					>
						{status.label}
					</button>
				{/each}
			</div>

			{#if isManualIneligible}
				<div class="mt-2">
					<p class="form-hint mb-1">No day-trip reason:</p>
					<div class="flex flex-wrap gap-2">
						{#each ineligibleReasons as reason}
							<button
								type="button"
								class={`form-choice-btn ${selectedIneligibleReason === reason.value ? 'form-choice-red' : ''}`}
								disabled={disabled}
								on:click={() => handleIneligibleReasonSelect(reason.value)}
							>
								{reason.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}
			<p class="form-hint mt-1">
				{#if isManagerOnly}
					Manager only automatically means no day trips
				{:else if value.dayTripStatus === 'ineligible'}
					Blocked from day trips
				{:else if value.dayTripStatus === 'eligible'}
					Anyone can take on day trips
				{:else}
					Adults only
				{/if}
			</p>
		{/if}
		<div class="mt-2">
			<label class="form-hint">Reason {needsReason && !isInIsolation ? '(required)' : '(optional)'}:</label>
			<input
				type="text"
				class="form-input mt-1"
				disabled={disabled}
				placeholder={
					isManagerOnly
						? 'Why is this dog manager only?'
						: isManualIneligible
							? 'Why are day trips blocked?'
							: value.dayTripStatus === 'difficult'
								? 'Reason for adults-only status'
								: 'Reason for status (optional)'
				}
				value={value.dayTripNotes ?? ''}
				on:input={(event) => handleInput('dayTripNotes', event.currentTarget.value)}
			/>
		</div>
	</div>

	<div class="form-section md:col-span-2">
		<h4 class="form-section-title permanent-marker">Activity Overrides</h4>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="form-field">
				<label class="form-label typewriter">Last Bath Date</label>
				<input
					type="date"
					class="form-input"
					disabled={disabled}
					value={toDate(value.lastBathDate)?.toISOString().slice(0, 10) ?? ''}
					on:change={(event) => handleDateChange('lastBathDate', event.currentTarget.value)}
				/>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Last Bath By</label>
				<input
					class="form-input"
					disabled={disabled}
					value={value.lastBathBy ?? ''}
					on:input={(event) => handleInput('lastBathBy', event.currentTarget.value)}
				/>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Last Day Trip Date</label>
				<input
					type="date"
					class="form-input"
					disabled={disabled}
					value={toDate(value.lastDayTripDate)?.toISOString().slice(0, 10) ?? ''}
					on:change={(event) => handleDateChange('lastDayTripDate', event.currentTarget.value)}
				/>
			</div>
			<div class="form-field">
				<label class="form-label typewriter">Out On Day Trip</label>
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						class="form-checkbox"
						disabled={disabled}
						checked={value.isOutOnDayTrip}
						on:change={(event) => handleCheckbox('isOutOnDayTrip', event.currentTarget.checked)}
					/>
					<span class="text-sm" style="color: var(--marker-black);">Currently out</span>
				</label>
			</div>
			<div class="form-field md:col-span-2">
				<label class="form-label typewriter">Current Day Trip Started At</label>
				<input
					type="datetime-local"
					class="form-input"
					disabled={disabled}
					value={toDate(value.currentDayTripStartedAt)?.toISOString().slice(0, 16) ?? ''}
					on:change={(event) => handleDateTimeChange('currentDayTripStartedAt', event.currentTarget.value)}
				/>
			</div>
		</div>
	</div>
</div>

<style>
	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
		max-width: 100%;
	}

	.form-label {
		font-size: 0.56rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.form-input {
		width: 100%;
		border: 1.5px solid #c0c8d2;
		border-radius: 0.25rem;
		padding: 0.55rem 0.7rem;
		font-size: 0.85rem;
		color: var(--marker-black);
		background: #ffffff;
	}

	.form-input:focus {
		outline: none;
		border-color: var(--marker-blue);
		box-shadow: 0 0 0 2px rgba(26, 107, 181, 0.12);
	}

	.form-input-error {
		border-color: var(--marker-red);
	}

	.form-textarea {
		width: 100%;
		min-height: 80px;
		border: 1.5px solid #c0c8d2;
		border-radius: 0.25rem;
		padding: 0.55rem 0.7rem;
		font-size: 0.85rem;
		color: var(--marker-black);
		background: #ffffff;
		resize: vertical;
	}

	.form-textarea:focus {
		outline: none;
		border-color: var(--marker-blue);
		box-shadow: 0 0 0 2px rgba(26, 107, 181, 0.12);
	}

	.form-checkbox {
		width: 1.15rem;
		height: 1.15rem;
		border: 1.5px solid #c0c8d2;
		border-radius: 0.18rem;
	}

	.form-hint {
		font-size: 0.7rem;
		color: var(--ink-soft);
	}

	.form-error {
		font-size: 0.7rem;
		color: var(--marker-red);
	}

	.form-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-top: 0.5rem;
		min-width: 0;
		max-width: 100%;
	}

	.form-inline-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		max-width: 100%;
	}

	.form-inline-date {
		flex: 1 1 10rem;
		min-width: 0;
	}

	.form-photo-shell {
		display: grid;
		gap: 0.6rem;
	}

	.form-photo-preview-wrap {
		display: flex;
		justify-content: flex-start;
	}

	.form-photo-preview {
		width: min(14rem, 100%);
		aspect-ratio: 3 / 4;
		object-fit: cover;
		border: 1.5px solid #c0c8d2;
		border-radius: 0.28rem;
		background: #edf2f7;
	}

	.form-photo-placeholder {
		width: min(14rem, 100%);
		aspect-ratio: 3 / 4;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1.5px dashed #bcc6d3;
		border-radius: 0.28rem;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6d7f97;
		background: #f7f9fc;
		text-align: center;
		padding: 0.6rem;
	}

	.form-photo-actions {
		display: grid;
		gap: 0.5rem;
		max-width: min(22rem, 100%);
	}

	.form-file-input {
		padding: 0.45rem 0.55rem;
	}

	.form-section-title {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		color: var(--marker-black);
		padding-bottom: 0.35rem;
		border-bottom: 1.5px solid #d8dde4;
	}

	.form-choice-btn {
		border: 1.5px solid #c0c8d2;
		border-radius: 0.2rem;
		padding: 0.4rem 0.8rem;
		font-family: var(--font-typewriter);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--ink-soft);
		background: #ffffff;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.form-choice-btn:hover:not(:disabled) {
		background: #f0f4f8;
	}

	.form-choice-btn:disabled {
		opacity: 0.5;
	}

	.form-choice-green {
		background: #dcfce7;
		border-color: var(--marker-green);
		color: var(--marker-green);
	}

	.form-choice-yellow {
		background: #fef9c3;
		border-color: var(--marker-orange);
		color: var(--marker-orange);
	}

	.form-choice-red {
		background: #fecaca;
		border-color: var(--marker-red);
		color: var(--marker-red);
	}

	.form-choice-purple {
		background: #ede9fe;
		border-color: #7656a8;
		color: #5d3f8f;
	}

	.entry-history-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.entry-history-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: center;
	}

	.entry-history-remove {
		border: 1.5px solid #e2b3b3;
		border-radius: 0.25rem;
		padding: 0.42rem 0.72rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: #8a2d2d;
		background: #fff5f5;
	}

	.entry-history-remove:disabled {
		opacity: 0.5;
	}

	.entry-history-add {
		width: fit-content;
	}

	@media (max-width: 640px) {
		.form-inline-date {
			flex-basis: 100%;
			width: 100%;
		}
	}
</style>
