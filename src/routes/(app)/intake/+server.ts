import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { createWorker, PSM } from 'tesseract.js';
import type { RequestHandler } from './$types';

type IntakeAction = 'create' | 'update' | 'ignore';
type Confidence = 'high' | 'medium' | 'low';
type PottyTrainedStatus = 'yes' | 'no' | 'working_on_it' | 'unknown';
type Compatibility = 'yes' | 'no' | 'unknown';
type EnergyLevel = 'low' | 'medium' | 'high' | 'very_high' | 'unknown';
type MedicalStatus = 'yes' | 'no' | 'unknown';
type FosterStatus = 'yes' | 'no' | 'unknown';
type DogSex = 'male' | 'female' | 'unknown';

type IntakeSuggestion = {
	action: IntakeAction;
	matchName: string;
	confidence: Confidence;
	reason: string;
	fields: {
		name: string;
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
		inFosterStatus: FosterStatus;
		microchippedStatus: MedicalStatus;
		vaccinationStatus: MedicalStatus;
		vaccinatedDate: string;
		fixedStatus: MedicalStatus;
		fixedDate: string;
		surgeryDate: string;
		healthProblems: string;
	};
};

type ExistingDog = {
	id: string;
	name: string;
};

type ManualRosterEntry = {
	code: string;
	name: string;
	details: string;
	context: string;
	enteredShelterDate: string;
	lastChangedDate: string;
	lastChangedBy: string;
	sex: string;
	breed: string;
	age: string;
};

type Rectangle = {
	left: number;
	top: number;
	width: number;
	height: number;
};

type ImageDimensions = {
	width: number;
	height: number;
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const photo = form.get('photo');
	const existingDogs = parseExistingDogs(form.get('existingDogs'));
	const intakeText = normalizeContextText(cleanText(form.get('intakeText')));
	if (intakeText) {
		const { suggestions, notes } = buildSuggestionsFromManualText(intakeText, existingDogs);
		return json({
			notes: ['Manual text intake mode is active.', ...notes],
			suggestions,
			model: 'manual-text'
		});
	}

	if (!(photo instanceof File)) {
		return json({ error: 'Upload a photo or paste profile text to analyze.' }, { status: 400 });
	}

	if (photo.size <= 0) {
		return json({ error: 'Uploaded file is empty.' }, { status: 400 });
	}

	if (photo.size > MAX_IMAGE_BYTES) {
		return json({ error: 'Photo is too large. Use an image under 12MB.' }, { status: 400 });
	}

	const mimeType = photo.type || 'image/jpeg';
	if (!mimeType.startsWith('image/')) {
		return json({ error: 'Unsupported file type. Please upload an image.' }, { status: 400 });
	}

	const imageBuffer = Buffer.from(await photo.arrayBuffer());
	const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

	const apiKey = env.OPENAI_API_KEY;
	const model = env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';
	if (apiKey) {
		try {
			const result = await analyzeWithOpenAI(imageDataUrl, apiKey, model);
			return json(result);
		} catch (error) {
			console.error('OpenAI analysis failed; falling back to local OCR.', error);
		}
	}

	try {
		const local = await analyzeWithLocalOcr(imageBuffer, existingDogs);
		return json(local);
	} catch (error) {
		console.error(error);
		return json(
			{
				error:
					'Unable to analyze image. Set OPENAI_API_KEY for cloud vision, or retry with a clearer photo for local OCR.'
			},
			{ status: 502 }
		);
	}
};

async function analyzeWithOpenAI(imageDataUrl: string, apiKey: string, model: string) {
	const prompt = `
You are helping an animal shelter intake team parse a kennel-board photo and propose records/actions.

Return JSON only with this shape:
{
  "notes": string[],
  "suggestions": [
    {
      "action": "create" | "update" | "ignore",
      "matchName": string,
      "confidence": "high" | "medium" | "low",
      "reason": string,
      "fields": {
        "name": string,
        "sex": "male" | "female" | "unknown",
        "origin": string,
        "dateOfBirth": string,
        "originalIntakeDate": string,
        "currentIntakeDate": string,
        "reentryDates": string[],
        "leftShelterDate": string,
        "weightLbs": number | null,
        "microchipDate": string,
        "pottyTrained": "yes" | "no" | "working_on_it" | "unknown",
        "goodWithDogs": "yes" | "no" | "unknown",
        "goodWithCats": "yes" | "no" | "unknown",
        "goodWithKids": "yes" | "no" | "unknown",
        "goodWithElderly": "yes" | "no" | "unknown",
        "goodOnLead": "yes" | "no" | "unknown",
        "goodTraveller": "yes" | "no" | "unknown",
        "crateTrained": "yes" | "no" | "unknown",
        "idealHome": string,
        "energyLevel": "low" | "medium" | "high" | "very_high" | "unknown",
        "dietaryNotes": string,
        "markings": string,
        "hiddenComments": string,
        "description": string,
        "warningNotes": string,
        "holdNotes": string,
        "outdoorKennelAssignment": string,
        "inFosterStatus": "yes" | "no" | "unknown",
        "microchippedStatus": "yes" | "no" | "unknown",
        "vaccinationStatus": "yes" | "no" | "unknown",
        "vaccinatedDate": string,
        "fixedStatus": "yes" | "no" | "unknown",
        "fixedDate": string,
        "surgeryDate": string,
        "healthProblems": string
      }
    }
  ]
}

Rules:
- Use "update" only when there is strong evidence this refers to an existing dog (name clearly visible).
- Use "create" for clearly new dog entries.
- Use "ignore" if uncertain/noisy.
- Fill unknown or missing values with "unknown" for enums and empty string for free text.
- Use YYYY-MM-DD for dates when possible. Use [] for missing reentryDates.
- Treat "Altered" as equivalent to fixed/spayed-neutered. Map altered date to "fixedDate".
- If a microchip number is present, set "microchippedStatus" to "yes".
- Use location text only to infer "inFosterStatus" ("yes" for foster, "no" for shelter/on-site).
- Parse date of birth when visible (labels like "Date of Birth", "DOB", or "Birthday").
- Parse sex when visible (labels like "Sex", or phrases like "Male Dog"/"Female Dog").
- If weight is visible (e.g., "56lb"), populate "weightLbs" as a number.
- Be conservative: if unsure, lower confidence and/or use "ignore".
`;

	const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model,
			temperature: 0.1,
			input: [
				{
					role: 'user',
					content: [
						{ type: 'input_text', text: prompt },
						{ type: 'input_image', image_url: imageDataUrl }
					]
				}
			]
		})
	});

	if (!openAiResponse.ok) {
		const details = await safeReadText(openAiResponse);
		throw new Error(`Vision request failed (${openAiResponse.status}). ${details}`.trim());
	}

	const payload = (await openAiResponse.json()) as Record<string, unknown>;
	const text = extractResponseText(payload);
	if (!text) {
		throw new Error('Vision response did not include text output.');
	}

	const parsed = parseJsonFromText(text);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error(
			`Could not parse model output as JSON. Try a clearer image or crop to the dog sheets. Raw: ${text.slice(0, 320)}`
		);
	}

	const rawSuggestions = Array.isArray((parsed as any).suggestions)
		? (parsed as any).suggestions
		: Array.isArray((parsed as any).dogs)
			? (parsed as any).dogs
			: [];
	const suggestions = rawSuggestions.map(normalizeSuggestion).filter(Boolean) as IntakeSuggestion[];
	const notes = Array.isArray((parsed as any).notes)
		? (parsed as any).notes.map((note: unknown) => cleanText(note)).filter(Boolean)
		: [];

	return {
		notes,
		suggestions,
		model
	};
}

function normalizeSuggestion(input: unknown): IntakeSuggestion | null {
	if (!input || typeof input !== 'object') return null;
	const raw = input as Record<string, unknown>;
	const rawFields =
		raw.fields && typeof raw.fields === 'object' ? (raw.fields as Record<string, unknown>) : raw;

	return {
		action: normalizeAction(raw.action),
		matchName: cleanText(raw.matchName),
		confidence: normalizeConfidence(raw.confidence),
		reason: cleanText(raw.reason) || 'No reason provided.',
		fields: {
			name: cleanText(rawFields.name),
			sex: normalizeSex(rawFields.sex),
			origin: cleanText(rawFields.origin),
			dateOfBirth: normalizeDateString(cleanText(rawFields.dateOfBirth)),
			originalIntakeDate: normalizeDateString(cleanText(rawFields.originalIntakeDate)),
			currentIntakeDate: normalizeDateString(cleanText(rawFields.currentIntakeDate)),
			reentryDates: normalizeDateStringList(rawFields.reentryDates),
			leftShelterDate: normalizeDateString(cleanText(rawFields.leftShelterDate)),
			weightLbs: normalizeWeightLbs(rawFields.weightLbs),
			microchipDate: normalizeDateString(cleanText(rawFields.microchipDate)),
			pottyTrained: normalizePotty(rawFields.pottyTrained),
			goodWithDogs: normalizeCompatibility(rawFields.goodWithDogs),
			goodWithCats: normalizeCompatibility(rawFields.goodWithCats),
			goodWithKids: normalizeCompatibility(rawFields.goodWithKids),
			goodWithElderly: normalizeCompatibility(rawFields.goodWithElderly),
			goodOnLead: normalizeCompatibility(rawFields.goodOnLead),
			goodTraveller: normalizeCompatibility(rawFields.goodTraveller),
			crateTrained: normalizeCompatibility(rawFields.crateTrained),
			idealHome: cleanText(rawFields.idealHome),
			energyLevel: normalizeEnergy(rawFields.energyLevel),
			dietaryNotes: cleanText(rawFields.dietaryNotes),
			markings: cleanText(rawFields.markings),
			hiddenComments: cleanText(rawFields.hiddenComments),
			description: cleanText(rawFields.description),
			warningNotes: cleanText(rawFields.warningNotes),
			holdNotes: cleanText(rawFields.holdNotes),
			outdoorKennelAssignment: cleanText(rawFields.outdoorKennelAssignment),
			inFosterStatus: normalizeFosterStatus(rawFields.inFosterStatus),
			microchippedStatus: normalizeMedical(rawFields.microchippedStatus),
			vaccinationStatus: normalizeMedical(rawFields.vaccinationStatus),
			vaccinatedDate: normalizeDateString(cleanText(rawFields.vaccinatedDate)),
			fixedStatus: normalizeMedical(rawFields.fixedStatus),
			fixedDate: normalizeDateString(cleanText(rawFields.fixedDate)),
			surgeryDate: normalizeDateString(cleanText(rawFields.surgeryDate)),
			healthProblems: cleanText(rawFields.healthProblems)
		}
	};
}

function normalizeAction(value: unknown): IntakeAction {
	const normalized = cleanText(value).toLowerCase();
	if (normalized === 'update') return 'update';
	if (normalized === 'ignore' || normalized === 'skip') return 'ignore';
	return 'create';
}

function normalizeConfidence(value: unknown): Confidence {
	const normalized = cleanText(value).toLowerCase();
	if (normalized === 'high') return 'high';
	if (normalized === 'low') return 'low';
	return 'medium';
}

function normalizeSex(value: unknown): DogSex {
	const normalized = cleanText(value).toLowerCase();
	if (normalized === 'male' || normalized === 'm') return 'male';
	if (normalized === 'female' || normalized === 'f') return 'female';
	return 'unknown';
}

function normalizePotty(value: unknown): PottyTrainedStatus {
	const normalized = cleanText(value).toLowerCase();
	if (normalized === 'yes') return 'yes';
	if (normalized === 'no') return 'no';
	if (
		normalized === 'working_on_it' ||
		normalized === 'working on it' ||
		normalized === 'in progress'
	) {
		return 'working_on_it';
	}
	return 'unknown';
}

function normalizeCompatibility(value: unknown): Compatibility {
	const normalized = cleanText(value).toLowerCase();
	if (normalized === 'yes') return 'yes';
	if (normalized === 'no') return 'no';
	return 'unknown';
}

function normalizeEnergy(value: unknown): EnergyLevel {
	const normalized = cleanText(value).toLowerCase();
	if (normalized === 'low') return 'low';
	if (normalized === 'medium') return 'medium';
	if (normalized === 'high') return 'high';
	if (normalized === 'very_high' || normalized === 'very high') return 'very_high';
	return 'unknown';
}

function normalizeMedical(value: unknown): MedicalStatus {
	const normalized = cleanText(value).toLowerCase();
	if (normalized === 'yes') return 'yes';
	if (normalized === 'no') return 'no';
	return 'unknown';
}

function normalizeFosterStatus(value: unknown): FosterStatus {
	return normalizeMedical(value);
}

function normalizeWeightLbs(value: unknown): number | null {
	const numeric = typeof value === 'number' ? value : Number(cleanText(value));
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	return Math.round(numeric * 10) / 10;
}

function normalizeDateStringList(value: unknown): string[] {
	const rawValues: string[] = [];
	if (Array.isArray(value)) {
		for (const item of value) {
			const cleaned = cleanText(item);
			if (cleaned) rawValues.push(cleaned);
		}
	} else {
		const cleaned = cleanText(value);
		if (cleaned) rawValues.push(...extractDateTokens(cleaned));
	}

	return dedupeAndSortDateStrings(
		rawValues
			.map((item) => normalizeDateString(item))
			.filter((item): item is string => Boolean(item))
	);
}

function cleanText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function extractResponseText(payload: Record<string, unknown>): string {
	const direct = payload.output_text;
	if (typeof direct === 'string' && direct.trim()) return direct.trim();
	if (Array.isArray(direct)) {
		const joined = direct
			.map((part) => (typeof part === 'string' ? part : ''))
			.join('\n')
			.trim();
		if (joined) return joined;
	}

	const output = Array.isArray(payload.output) ? payload.output : [];
	const chunks: string[] = [];
	for (const item of output) {
		if (!item || typeof item !== 'object') continue;
		const content = (item as any).content;
		if (!Array.isArray(content)) continue;
		for (const entry of content) {
			if (!entry || typeof entry !== 'object') continue;
			if ((entry as any).type === 'output_text' && typeof (entry as any).text === 'string') {
				chunks.push((entry as any).text);
			}
		}
	}

	return chunks.join('\n').trim();
}

function parseJsonFromText(text: string): unknown {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		// fall through
	}

	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) {
		try {
			return JSON.parse(fenced[1].trim());
		} catch {
			// fall through
		}
	}

	const firstBrace = trimmed.indexOf('{');
	const lastBrace = trimmed.lastIndexOf('}');
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		try {
			return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
		} catch {
			return null;
		}
	}

	return null;
}

function parseExistingDogs(input: FormDataEntryValue | null): ExistingDog[] {
	if (typeof input !== 'string' || !input.trim()) return [];
	try {
		const parsed = JSON.parse(input) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((item) => {
				if (!item || typeof item !== 'object') return null;
				const raw = item as Record<string, unknown>;
				const id = cleanText(raw.id);
				const name = cleanText(raw.name);
				if (!id || !name) return null;
				return { id, name };
			})
			.filter(Boolean) as ExistingDog[];
	} catch {
		return [];
	}
}

function buildSuggestionsFromManualText(text: string, existingDogs: ExistingDog[]) {
	const rosterEntries = parseManualRosterTextEntries(text);
	const compactEntries =
		rosterEntries.length > 0 ? [] : parseCompactRosterTextEntries(text);
	const parsedEntries = rosterEntries.length > 0 ? rosterEntries : compactEntries;
	if (parsedEntries.length === 0) {
		return buildSuggestionsFromOcr(text, 92, existingDogs, [text], []);
	}

	const parsedMode = rosterEntries.length > 0 ? 'line-based' : 'compact';
	const notes: string[] = [
		`Parsed ${parsedEntries.length} profile(s) from pasted text (${parsedMode} parser).`
	];
	let matchedExisting = 0;
	const suggestions: IntakeSuggestion[] = [];
	const seenNames = new Set<string>();

	for (const entry of parsedEntries) {
		const normalizedName = normalizeText(entry.name);
		if (!normalizedName || seenNames.has(normalizedName)) continue;
		seenNames.add(normalizedName);

		const defaults = extractDefaultFields(entry.context);
		const match = findExistingDogByName(existingDogs, entry.name);
		if (match) matchedExisting += 1;

		const summaryBits: string[] = [];
		if (entry.sex) summaryBits.push(entry.sex);
		if (entry.breed) summaryBits.push(entry.breed);
		if (entry.age) summaryBits.push(`aged ${entry.age}`);
		if (entry.lastChangedDate) {
			const changedBySuffix = entry.lastChangedBy ? ` by ${entry.lastChangedBy}` : '';
			summaryBits.push(`last changed ${entry.lastChangedDate}${changedBySuffix}`);
		}
		const parsedNotes = [defaults.dietaryNotes, summaryBits.join(', ')].filter(Boolean).join(' | ');
		const parsedEnteredDate = entry.enteredShelterDate || defaults.originalIntakeDate;

			suggestions.push({
				action: match ? 'update' : 'create',
				matchName: match?.name ?? '',
			confidence: 'high',
			reason: match
				? 'Name matched existing roster via pasted text; prepared update.'
				: 'Parsed from pasted roster text.',
				fields: {
					...defaults,
					name: entry.name,
					sex: normalizeSex(entry.sex),
					origin: defaults.origin,
					originalIntakeDate: parsedEnteredDate,
					currentIntakeDate: parsedEnteredDate || defaults.currentIntakeDate,
				reentryDates: [],
				dietaryNotes: parsedNotes
			}
		});
	}

	if (matchedExisting > 0) {
		notes.push(`Matched ${matchedExisting} existing dog(s); those were marked ignore.`);
	}

	return { suggestions, notes };
}

function parseCompactRosterTextEntries(text: string): ManualRosterEntry[] {
	const normalized = cleanText(text).replace(/\s+/g, ' ');
	if (!normalized) return [];

	const matches = [...normalized.matchAll(/\b(\d{4}-\d{4,6})\b/g)];
	if (matches.length === 0) return [];

	const entries: ManualRosterEntry[] = [];
	for (let i = 0; i < matches.length; i += 1) {
		const current = matches[i];
		if (!current) continue;
		const start = current.index ?? -1;
		if (start < 0) continue;

		const end =
			i + 1 < matches.length ? (matches[i + 1]?.index ?? normalized.length) : normalized.length;
		if (end <= start) continue;
		const segment = normalized.slice(start, end).trim();
		const parsed = parseCompactRosterSegment(segment);
		if (!parsed) continue;
		entries.push(parsed);
	}

	return entries;
}

function parseCompactRosterSegment(segment: string): ManualRosterEntry | null {
	const codeMatch = segment.match(/^(\d{4}-\d{4,6})(.*)$/);
	if (!codeMatch?.[1]) return null;

	const code = cleanText(codeMatch[1]);
	const remainder = cleanText(codeMatch[2]);
	if (!remainder) return null;

	const dateMatches = [...remainder.matchAll(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/g)];
	if (dateMatches.length < 2) return null;

	const firstDateMatch = dateMatches[0];
	const secondDateMatch = dateMatches[1];
	if (!firstDateMatch || !secondDateMatch) return null;

	const firstDateRaw = cleanText(firstDateMatch[1]);
	const secondDateRaw = cleanText(secondDateMatch[1]);
	const enteredShelterDate = normalizeDateString(firstDateRaw);
	const lastChangedDate = normalizeDateString(secondDateRaw);

	const firstDateStart = firstDateMatch.index ?? -1;
	const secondDateStart = secondDateMatch.index ?? -1;
	if (firstDateStart < 0 || secondDateStart < 0 || secondDateStart <= firstDateStart) return null;

	const profilePrefix = cleanText(remainder.slice(0, firstDateStart));
	const changedByStart = secondDateStart + secondDateRaw.length;
	const lastChangedBy = cleanText(remainder.slice(changedByStart));
	if (!profilePrefix) return null;

	const ageMatch = profilePrefix.match(/(\d+\s*y\s*\d+\s*m|\d+\s*y|\d+\s*m|\d+\s*wk)\s*$/i);
	const age = cleanText(ageMatch?.[1]);
	const prefixWithoutAge = cleanText(
		ageMatch ? profilePrefix.slice(0, profilePrefix.length - (ageMatch[0]?.length ?? 0)) : profilePrefix
	);
	if (!prefixWithoutAge) return null;

	const nameSexBreedMatch = prefixWithoutAge.match(/^(.+?)([A-Z]{0,4}[MF])([A-Za-z][A-Za-z/()' .-]{1,90})$/);
	if (!nameSexBreedMatch?.[1] || !nameSexBreedMatch[2] || !nameSexBreedMatch[3]) return null;

	const rawName = cleanManualRosterName(nameSexBreedMatch[1]);
	const sexMarker = cleanText(nameSexBreedMatch[2]);
	const breed = cleanText(nameSexBreedMatch[3]);
	if (!rawName || !breed) return null;

	const sex = deriveSexFromMarker(sexMarker);
	const detailsBits = [
		enteredShelterDate ? `Entered shelter ${enteredShelterDate}` : '',
		lastChangedDate ? `Last changed on ${lastChangedDate}` : '',
		lastChangedBy ? `by ${lastChangedBy}` : '',
		sex ? `${sex === 'male' ? 'Male' : 'Female'}` : '',
		breed ? `${breed}` : '',
		age ? `aged ${age}` : ''
	].filter(Boolean);
	const details = detailsBits.join(', ');

	return {
		code,
		name: rawName,
		details,
		context: `${code}: ${details}\n${rawName}`,
		enteredShelterDate,
		lastChangedDate,
		lastChangedBy,
		sex,
		breed,
		age
	};
}

function deriveSexFromMarker(marker: string): string {
	const cleaned = cleanText(marker).toUpperCase();
	if (!cleaned) return '';
	const last = cleaned.match(/[MF](?!.*[MF])/);
	if (!last?.[0]) return '';
	return last[0] === 'M' ? 'male' : 'female';
}

function parseManualRosterTextEntries(text: string): ManualRosterEntry[] {
	const normalized = normalizeContextText(text);
	if (!normalized) return [];

	const lines = normalized.split('\n');
	const entries: ManualRosterEntry[] = [];
	const headerRegex = /^\s*(?:[A-Z]{1,3}\s+)?(\d{4}-\d{4,6})\s*:\s*(.+)$/i;

	let index = 0;
	while (index < lines.length) {
		const line = cleanText(lines[index]);
		const headerMatch = line.match(headerRegex);
		if (!headerMatch) {
			index += 1;
			continue;
		}

		const code = cleanText(headerMatch[1]);
		let details = cleanText(headerMatch[2]);
		let name = '';
		let cursor = index + 1;

		while (cursor < lines.length) {
			const candidate = cleanText(lines[cursor]);
			if (!candidate) {
				cursor += 1;
				continue;
			}

			if (headerRegex.test(candidate)) break;

			if (!name && looksLikeManualRosterNameLine(candidate)) {
				name = cleanManualRosterName(candidate);
				cursor += 1;
				break;
			}

			if (!name && looksLikeDetailContinuation(candidate)) {
				details = `${details} ${candidate}`.trim();
			}

			cursor += 1;
		}

		if (!name) {
			index = cursor;
			continue;
		}

		const enteredShelterDate = normalizeDateString(
			extractByRegex(details, /\bentered\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i)
		);
		const lastChangedDate = normalizeDateString(
			extractByRegex(details, /\blast\s*changed\s*on\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i)
		);
		const lastChangedBy = cleanText(
			extractByRegex(
				details,
				/\blast\s*changed\s*on\s*[0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4}\s*by\s*([A-Za-z0-9._ -]{1,48})/i
			)
		);
		const sex = cleanText(extractByRegex(details, /\b(male|female)\b/i));
		const breed = cleanText(
			extractByRegex(details, /\b(?:male|female)\s+(.+?)\s+dog\s+aged\b/i) ||
				extractByRegex(details, /\b(?:male|female)\s+(.+?)\s+aged\b/i)
		);
		const age = cleanText(extractByRegex(details, /\baged\s+([^.,\n]{1,40})/i));

		entries.push({
			code,
			name,
			details,
			context: `${code}: ${details}\n${name}`,
			enteredShelterDate,
			lastChangedDate,
			lastChangedBy,
			sex,
			breed,
			age
		});

		index = cursor;
	}

	return entries;
}

function looksLikeManualRosterNameLine(value: string): boolean {
	const cleaned = cleanText(value);
	if (!cleaned) return false;
	if (cleaned.includes(':')) return false;
	if (/[0-9]/.test(cleaned)) return false;
	if (cleaned.length > 36) return false;
	if (/\b(?:entered|last\s*changed|shelter|male|female|dog\s+aged)\b/i.test(cleaned)) return false;
	if (!/^[A-Za-z][A-Za-z'() -]{1,35}$/.test(cleaned)) return false;
	return !isLikelyNonName(cleaned.replace(/[()]/g, ' '));
}

function looksLikeDetailContinuation(value: string): boolean {
	const cleaned = cleanText(value);
	if (!cleaned) return false;
	if (/^[A-Za-z][A-Za-z'() -]{1,35}$/.test(cleaned) && !/\b(?:entered|last\s*changed)\b/i.test(cleaned)) {
		return false;
	}
	return /[:.,]|\b(?:entered\s*shelter|last\s*changed|male|female|dog\s+aged)\b/i.test(cleaned);
}

function cleanManualRosterName(value: string): string {
	const cleaned = cleanText(value).replace(/\s+/g, ' ');
	if (!cleaned) return '';
	const stripped = cleaned.replace(/^[A-Z]{1,3}\s+/, '').trim();
	if (!stripped || /[0-9]/.test(stripped)) return '';
	return stripped;
}

async function analyzeWithLocalOcr(imageBuffer: Buffer, existingDogs: ExistingDog[]) {
	const worker = await createWorker('eng');
	try {
		await worker.setParameters({
			tessedit_pageseg_mode: PSM.SPARSE_TEXT,
			preserve_interword_spaces: '1',
			user_defined_dpi: '300'
		});

		const result = await worker.recognize(imageBuffer, undefined, { blocks: true });
		const rawText = normalizeContextText(result.data?.text ?? '');
		const confidence = Number(result.data?.confidence ?? 0);
		const blockTexts = collectOcrTextBlocks(result.data);
		const seededNames = collectOcrLineNameCandidates(result.data);
		const regionalNotes: string[] = [];
		const dimensions = getImageDimensionsFromBuffer(imageBuffer) ?? inferImageDimensionsFromOcr(result.data);

		const initialNameCount = uniqueNameCount(seededNames, detectDogNameCandidates([rawText, ...blockTexts].join('\n')));
		if (initialNameCount < 6) {
			if (dimensions) {
				const regional = await scanAdditionalOcrRegions(worker, imageBuffer, dimensions);
				for (const text of regional.texts) {
					pushUniqueContext(blockTexts, text);
				}
				for (const text of regional.blockTexts) {
					pushUniqueContext(blockTexts, text);
				}
				for (const name of regional.nameCandidates) {
					pushUniqueName(seededNames, name);
				}
				regionalNotes.push(`Scanned ${regional.scanned} extra image region(s) for additional profiles.`);
			} else {
				regionalNotes.push('Could not determine image size for regional OCR scan.');
			}
		}

		const postRegionalCount = uniqueNameCount(
			seededNames,
			detectDogNameCandidates([rawText, ...blockTexts].join('\n'))
		);
		if (postRegionalCount < 8) {
			const focused = await scanNameFocusedOcr(worker, imageBuffer, dimensions);
			for (const text of focused.texts) {
				pushUniqueContext(blockTexts, text);
			}
			for (const text of focused.blockTexts) {
				pushUniqueContext(blockTexts, text);
			}
			for (const name of focused.nameCandidates) {
				pushUniqueName(seededNames, name);
			}
			regionalNotes.push(`Ran ${focused.scanned} name-focused OCR pass(es).`);
		}

		const { suggestions, notes: parserNotes } = buildSuggestionsFromOcr(
			rawText,
			confidence,
			existingDogs,
			blockTexts,
			seededNames
		);

		return {
			notes: [
				'Local OCR mode is active (no OPENAI_API_KEY).',
				`OCR confidence: ${Math.round(confidence)}%`,
				...regionalNotes,
				...parserNotes
			],
			suggestions,
			model: 'local-ocr'
		};
	} finally {
		await worker.terminate();
	}
}

async function scanAdditionalOcrRegions(
	worker: Awaited<ReturnType<typeof createWorker>>,
	imageBuffer: Buffer,
	dimensions: ImageDimensions
) {
	const rectangles = buildRegionalScanRectangles(dimensions);
	const texts: string[] = [];
	const blockTexts: string[] = [];
	const nameCandidates: string[] = [];
	let scanned = 0;

	for (const rectangle of rectangles) {
		const result = await worker.recognize(imageBuffer, { rectangle }, { blocks: true });
		scanned += 1;
		pushUniqueContext(texts, result.data?.text ?? '');
		for (const block of collectOcrTextBlocks(result.data)) {
			pushUniqueContext(blockTexts, block);
		}
		for (const name of collectOcrLineNameCandidates(result.data)) {
			pushUniqueName(nameCandidates, name);
		}
	}

	return { texts, blockTexts, nameCandidates, scanned };
}

async function scanNameFocusedOcr(
	worker: Awaited<ReturnType<typeof createWorker>>,
	imageBuffer: Buffer,
	dimensions: ImageDimensions | null
) {
	await worker.setParameters({
		tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
		preserve_interword_spaces: '1',
		tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz()' -",
		user_defined_dpi: '300'
	});

	const rectangles = dimensions ? buildNameBandRectangles(dimensions) : [];
	const texts: string[] = [];
	const blockTexts: string[] = [];
	const nameCandidates: string[] = [];
	let scanned = 0;

	const firstResult = await worker.recognize(imageBuffer, undefined, { blocks: true });
	scanned += 1;
	pushUniqueContext(texts, firstResult.data?.text ?? '');
	for (const block of collectOcrTextBlocks(firstResult.data)) {
		pushUniqueContext(blockTexts, block);
	}
	for (const name of collectOcrLineNameCandidates(firstResult.data)) {
		pushUniqueName(nameCandidates, name);
	}

	for (const rectangle of rectangles) {
		const result = await worker.recognize(imageBuffer, { rectangle }, { blocks: true });
		scanned += 1;
		pushUniqueContext(texts, result.data?.text ?? '');
		for (const block of collectOcrTextBlocks(result.data)) {
			pushUniqueContext(blockTexts, block);
		}
		for (const name of collectOcrLineNameCandidates(result.data)) {
			pushUniqueName(nameCandidates, name);
		}
	}

	await worker.setParameters({
		tessedit_pageseg_mode: PSM.SPARSE_TEXT,
		preserve_interword_spaces: '1',
		tessedit_char_whitelist: '',
		user_defined_dpi: '300'
	});

	return { texts, blockTexts, nameCandidates, scanned };
}

function buildNameBandRectangles(dimensions: ImageDimensions): Rectangle[] {
	const { width, height } = dimensions;
	if (width < 100 || height < 100) return [];

	const rectangles: Rectangle[] = [];
	const bandHeight = clamp(Math.floor(height * 0.22), 56, Math.floor(height * 0.36));
	const steps = 6;
	for (let i = 0; i < steps; i += 1) {
		const top = clamp(Math.floor(((height - bandHeight) * i) / Math.max(steps - 1, 1)), 0, height - bandHeight);
		rectangles.push({
			left: 0,
			top,
			width,
			height: bandHeight
		});
	}

	return dedupeRectangles(rectangles);
}

function buildRegionalScanRectangles(dimensions: ImageDimensions): Rectangle[] {
	const { width, height } = dimensions;
	if (width < 100 || height < 100) return [];

	const rectangles: Rectangle[] = [];

	const columnWidth = Math.floor(width / 3);
	const columnOverlap = Math.max(24, Math.floor(width * 0.08));
	for (let i = 0; i < 3; i += 1) {
		const left = clamp(i * columnWidth - columnOverlap, 0, width - 1);
		const right = clamp((i + 1) * columnWidth + columnOverlap, left + 1, width);
		rectangles.push({
			left,
			top: 0,
			width: right - left,
			height
		});
	}

	const rowHeight = Math.floor(height / 2);
	const rowOverlap = Math.max(20, Math.floor(height * 0.08));
	for (let i = 0; i < 2; i += 1) {
		const top = clamp(i * rowHeight - rowOverlap, 0, height - 1);
		const bottom = clamp((i + 1) * rowHeight + rowOverlap, top + 1, height);
		rectangles.push({
			left: 0,
			top,
			width,
			height: bottom - top
		});
	}

	return dedupeRectangles(rectangles);
}

function dedupeRectangles(rectangles: Rectangle[]): Rectangle[] {
	const deduped: Rectangle[] = [];
	const keys = new Set<string>();
	for (const rectangle of rectangles) {
		if (rectangle.width < 20 || rectangle.height < 20) continue;
		const key = `${rectangle.left}:${rectangle.top}:${rectangle.width}:${rectangle.height}`;
		if (keys.has(key)) continue;
		keys.add(key);
		deduped.push(rectangle);
	}
	return deduped;
}

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function getImageDimensionsFromBuffer(imageBuffer: Buffer): ImageDimensions | null {
	const png = readPngDimensions(imageBuffer);
	if (png) return png;

	const jpeg = readJpegDimensions(imageBuffer);
	if (jpeg) return jpeg;

	return null;
}

function readPngDimensions(imageBuffer: Buffer): ImageDimensions | null {
	const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (imageBuffer.length < 24) return null;
	for (let i = 0; i < pngSignature.length; i += 1) {
		if (imageBuffer[i] !== pngSignature[i]) return null;
	}
	const width = imageBuffer.readUInt32BE(16);
	const height = imageBuffer.readUInt32BE(20);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}
	return { width, height };
}

function readJpegDimensions(imageBuffer: Buffer): ImageDimensions | null {
	if (imageBuffer.length < 4) return null;
	if (imageBuffer[0] !== 0xff || imageBuffer[1] !== 0xd8) return null;

	let offset = 2;
	while (offset + 9 < imageBuffer.length) {
		if (imageBuffer[offset] !== 0xff) {
			offset += 1;
			continue;
		}

		const marker = imageBuffer[offset + 1];
		if (marker === 0xd8 || marker === 0x01) {
			offset += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) break;

		const length = imageBuffer.readUInt16BE(offset + 2);
		if (length < 2 || offset + 2 + length > imageBuffer.length) break;

		if (isSofMarker(marker)) {
			const height = imageBuffer.readUInt16BE(offset + 5);
			const width = imageBuffer.readUInt16BE(offset + 7);
			if (width > 0 && height > 0) {
				return { width, height };
			}
			return null;
		}

		offset += 2 + length;
	}

	return null;
}

function isSofMarker(marker: number) {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

function inferImageDimensionsFromOcr(data: unknown): ImageDimensions | null {
	if (!data || typeof data !== 'object') return null;
	const root = data as Record<string, unknown>;
	const blocks = Array.isArray(root.blocks) ? root.blocks : [];
	let maxX = 0;
	let maxY = 0;

	for (const block of blocks) {
		if (!block || typeof block !== 'object') continue;
		const bbox = (block as Record<string, unknown>).bbox;
		if (!bbox || typeof bbox !== 'object') continue;
		const x1 = Number((bbox as Record<string, unknown>).x1);
		const y1 = Number((bbox as Record<string, unknown>).y1);
		if (Number.isFinite(x1) && x1 > maxX) maxX = x1;
		if (Number.isFinite(y1) && y1 > maxY) maxY = y1;
	}

	if (maxX > 100 && maxY > 100) {
		return { width: Math.round(maxX), height: Math.round(maxY) };
	}

	return null;
}

function buildSuggestionsFromOcr(
	text: string,
	confidence: number,
	existingDogs: ExistingDog[],
	blockTexts: string[] = [],
	seededNames: string[] = []
) {
	const notes: string[] = [];
	const contexts = buildCandidateContexts(text, blockTexts);
	const globalDefaults = extractDefaultFields(text);
	const profileLayout = looksLikeIndividualProfileLayout(text, blockTexts);
	let candidates: Array<{ name: string; context: string }> = [];
	const seen = new Set<string>();

	if (profileLayout) {
		notes.push('Detected individual dog profile layout.');
	}

	for (const name of seededNames) {
		const key = normalizeText(name);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		candidates.push({ name, context: text });
		if (candidates.length >= 24) break;
	}

	for (const context of contexts) {
		if (candidates.length >= 24) break;
		const detectedNames = [
			...detectDogNameCandidates(context),
			...detectNamesFromExistingRoster(context, existingDogs)
		];
		for (const name of detectedNames) {
			const key = normalizeText(name);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			candidates.push({ name, context });
			if (candidates.length >= 24) break;
		}
		if (candidates.length >= 24) break;
	}

	if (profileLayout) {
		const primaryName = extractPrimaryProfileName(text, existingDogs, [
			...seededNames,
			...candidates.map((candidate) => candidate.name)
		]);
		if (primaryName) {
			const primaryKey = normalizeText(primaryName);
			const contextualMatch =
				candidates.find((candidate) => normalizeText(candidate.name) === primaryKey) ?? null;
			candidates = [
				{
					name: primaryName,
					context: contextualMatch?.context ?? text
				}
			];
		} else if (candidates.length > 1) {
			candidates = [candidates[0] as { name: string; context: string }];
		}
	}

	const estimatedProfiles = profileLayout ? 1 : estimateProfileCount(text, blockTexts);

	if (candidates.length === 0) {
		const fallbackName = cleanText(
			profileLayout
				? extractPrimaryProfileName(text, existingDogs, seededNames)
				: extractByRegex(text, /na(?:m|rn)e\s*[:\-]?\s*([A-Za-z][A-Za-z' -]{1,24})/i)
		);
		const fallbackMatch = fallbackName ? findExistingDogByName(existingDogs, fallbackName) : null;
		if (estimatedProfiles > 1) {
			notes.push(
				`Detected roughly ${estimatedProfiles} profile sections, but most names were unreadable in OCR.`
			);
		}

		const suggestions: IntakeSuggestion[] = [
			{
				action: fallbackName ? (fallbackMatch ? 'update' : 'create') : 'ignore',
				matchName: fallbackMatch?.name ?? '',
				confidence: confidence >= 65 ? 'medium' : 'low',
				reason: fallbackName
					? fallbackMatch
						? 'Matched existing dog via OCR. Review extracted fields before applying update.'
						: 'Name partially detected via OCR. Verify before applying.'
					: 'Could not reliably detect dog names from this image.',
				fields: {
					...globalDefaults,
					name: fallbackName
				}
			}
		];

		if (!profileLayout) {
			const unreadableCount = Math.max(0, Math.min(estimatedProfiles, 12) - suggestions.length);
			for (let i = 0; i < unreadableCount; i += 1) {
				suggestions.push({
					action: 'ignore',
					matchName: '',
					confidence: 'low',
					reason: 'Possible extra dog profile detected, but the name could not be read.',
					fields: {
						...globalDefaults,
						name: ''
					}
				});
			}
		}

		return { suggestions, notes };
	}

	const suggestions: IntakeSuggestion[] = candidates.map(({ name, context }) => {
		const match = findExistingDogByName(existingDogs, name);
		const mergedDefaults = mergeFieldDefaults(globalDefaults, extractDefaultFields(context));
		const action: IntakeAction = match ? 'update' : 'create';
		return {
			action,
			matchName: match?.name ?? '',
			confidence: match ? (confidence >= 70 ? 'high' : 'medium') : confidence >= 60 ? 'medium' : 'low',
			reason: match
				? 'Matched existing dog via OCR. Prepared update suggestion.'
				: 'Name detected via OCR and not found in existing roster.',
			fields: {
				...mergedDefaults,
				name
			}
		} satisfies IntakeSuggestion;
	});

	if (suggestions.length > 1) {
		notes.push(`Detected ${suggestions.length} dog candidate(s) from OCR.`);
	}
	const detectedNames = suggestions
		.map((item) => item.fields.name)
		.filter((name) => Boolean(cleanText(name)))
		.slice(0, 8);
	if (detectedNames.length > 0) {
		notes.push(`Detected names: ${detectedNames.join(', ')}`);
	}

	if (estimatedProfiles > suggestions.length) {
		notes.push(
			`Photo may include around ${estimatedProfiles} dogs; some names were unclear in OCR.`
		);
	}

	if (!profileLayout) {
		const unreadableCount = Math.max(0, Math.min(estimatedProfiles, 12) - suggestions.length);
		if (unreadableCount > 1) {
			for (let i = 0; i < unreadableCount; i += 1) {
				suggestions.push({
					action: 'ignore',
					matchName: '',
					confidence: 'low',
					reason: 'Possible extra dog profile detected, but the name could not be read.',
					fields: {
						...globalDefaults,
						name: ''
					}
				});
			}
		}
	}

	return { suggestions, notes };
}

function looksLikeIndividualProfileLayout(text: string, blockTexts: string[]): boolean {
	const corpus = normalizeContextText([text, ...blockTexts.slice(0, 40)].join('\n')).toLowerCase();
	const signals = [
		/good\s*with\s*cats?/i,
		/good\s*with\s*dogs?/i,
		/good\s*with\s*(?:kids?|children)/i,
		/house\s*trained|housetrained|potty\s*trained/i,
		/energy\s*level/i,
		/markings/i,
		/hidden\s*comments?/i,
		/species/i,
		/breed/i,
		/date\s*of\s*birth/i,
		/adoption\s*fee/i,
		/location\s*:/i,
		/microchip\s*:/i,
		/\bnotes\b/i,
		/\bdetails\b/i
	];
	let signalCount = 0;
	for (const signal of signals) {
		if (signal.test(corpus)) signalCount += 1;
	}

	const boardHeaderSignal = /\b(?:dog_shelter|foster)\s*\(\d+\)/i.test(corpus);
	if (boardHeaderSignal && signalCount < 6) return false;
	return signalCount >= 5;
}

function extractPrimaryProfileName(
	text: string,
	existingDogs: ExistingDog[],
	candidateNames: string[] = []
): string {
	const normalized = text.replace(/[|]/g, 'I');
	const ranked: string[] = [];

	for (const match of normalized.matchAll(
		/(?:^|\n)\s*[^A-Za-z\n]{0,5}([A-Z][A-Za-z' -]{1,24})\s*[-–]\s*(?:20\d{2}\s*[-/]\s*\d{3,}|[A-Z0-9]{1,6}\s*[-/]\s*\d{3,})/g
	)) {
		pushUniqueName(ranked, match[1] ?? '');
	}

	for (const match of normalized.matchAll(
		/(?:^|\n)\s*na(?:m|rn)e\s*\*?\s*[:\-]?\s*([A-Z][A-Za-z' -]{1,24})/gi
	)) {
		pushUniqueName(ranked, match[1] ?? '');
	}

	for (const match of normalized.matchAll(
		/(?:^|\n)\s*([A-Z][A-Za-z' -]{1,24})[^\n]{0,60}(?:male|female)\s+dog\b/gi
	)) {
		pushUniqueName(ranked, match[1] ?? '');
	}

	for (const name of detectNamesFromExistingRoster(normalized, existingDogs)) {
		pushUniqueName(ranked, name);
	}
	for (const name of candidateNames) {
		pushUniqueName(ranked, name);
	}

	const existingFirst = ranked.find((name) => Boolean(findExistingDogByName(existingDogs, name)));
	return existingFirst ?? ranked[0] ?? '';
}

function collectOcrTextBlocks(data: unknown): string[] {
	if (!data || typeof data !== 'object') return [];
	const root = data as Record<string, unknown>;
	const contexts: string[] = [];

	for (const key of ['blocks', 'paragraphs', 'lines'] as const) {
		const items = root[key];
		if (!Array.isArray(items)) continue;
		for (const item of items) {
			if (!item || typeof item !== 'object') continue;
			const block = item as Record<string, unknown>;
			const text = normalizeContextText(block.text);
			if (text.length < 24) continue;
			pushUniqueContext(contexts, text);
		}
	}

	return contexts.slice(0, 200);
}

function collectOcrLineNameCandidates(data: unknown): string[] {
	if (!data || typeof data !== 'object') return [];
	const root = data as Record<string, unknown>;
	const blocks = Array.isArray(root.blocks) ? root.blocks : [];
	const names: string[] = [];

	for (const block of blocks) {
		if (!block || typeof block !== 'object') continue;
		const paragraphs = Array.isArray((block as Record<string, unknown>).paragraphs)
			? ((block as Record<string, unknown>).paragraphs as unknown[])
			: [];
		for (const paragraph of paragraphs) {
			if (!paragraph || typeof paragraph !== 'object') continue;
			const lines = Array.isArray((paragraph as Record<string, unknown>).lines)
				? ((paragraph as Record<string, unknown>).lines as unknown[])
				: [];
			for (const line of lines) {
				if (!line || typeof line !== 'object') continue;
				const raw = line as Record<string, unknown>;
				const lineConfidence = Number(raw.confidence ?? 0);
				const lineText = normalizeContextText(raw.text);
				if (!lineText || lineConfidence < 35) continue;
				for (const candidate of extractCandidateNamesFromLine(lineText)) {
					pushUniqueName(names, candidate);
				}
			}
		}
	}

	return names;
}

function extractCandidateNamesFromLine(lineText: string): string[] {
	const candidates: string[] = [];
	const cleanedLine = lineText.replace(/[^\x20-\x7E]/g, '').trim();
	if (!cleanedLine) return candidates;
	if (/[:;=]/.test(cleanedLine)) return candidates;
	if (/[0-9]{2,}/.test(cleanedLine)) return candidates;

	const wholeLineMatch = cleanedLine.match(
		/^([A-Z][A-Za-z']{2,}(?:\s+[A-Z][A-Za-z']{2,})?(?:\s*\([A-Z][A-Za-z']{2,}\))?)$/
	);
	if (wholeLineMatch?.[1]) {
		candidates.push(wholeLineMatch[1]);
	}

	for (const match of cleanedLine.matchAll(
		/([A-Z][A-Za-z']{2,}(?:\s+[A-Z][A-Za-z']{2,})?(?:\s*\([A-Z][A-Za-z']{2,}\))?)/g
	)) {
		if (match[1]) candidates.push(match[1]);
	}

	return candidates;
}

function uniqueNameCount(...groups: string[][]): number {
	const names: string[] = [];
	for (const group of groups) {
		for (const name of group) {
			pushUniqueName(names, name);
		}
	}
	return names.length;
}

function buildCandidateContexts(text: string, blockTexts: string[]): string[] {
	const contexts: string[] = [];
	pushUniqueContext(contexts, text);

	for (const block of blockTexts) {
		pushUniqueContext(contexts, block);
	}

	for (const segment of extractProfileSegments(text)) {
		pushUniqueContext(contexts, segment);
	}

	return contexts;
}

function pushUniqueContext(list: string[], candidate: string) {
	const text = normalizeContextText(candidate);
	if (!text) return;
	const key = normalizeContextKey(text);
	if (!key) return;
	if (!list.some((item) => normalizeContextKey(item) === key)) {
		list.push(text);
	}
}

function normalizeContextKey(value: string) {
	return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeContextText(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value
		.replace(/\r/g, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function extractProfileSegments(text: string): string[] {
	const normalized = text.replace(/\r/g, '');
	const anchors = [...normalized.matchAll(/(?:entry\s*date|intake\s*date|dog\s*id|microchip)/gi)]
		.map((match) => match.index ?? -1)
		.filter((index) => index >= 0);

	if (anchors.length === 0) return [];

	const segments: string[] = [];
	for (let i = 0; i < anchors.length; i += 1) {
		const current = anchors[i]!;
		const next = anchors[i + 1];
		const start = Math.max(0, current - 180);
		const end = Math.min(
			normalized.length,
			next !== undefined ? Math.max(next + 120, current + 220) : current + 320
		);
		const segment = normalized.slice(start, end);
		pushUniqueContext(segments, segment);
	}

	return segments;
}

function estimateProfileCount(text: string, blockTexts: string[]): number {
	const entryLabels = countMatches(text, /(?:entry\s*date|intake\s*date)\s*[:\-]?/gi);
	const nameLabels = countMatches(text, /(?:^|\b)na(?:m|rn)e\s*[:\-]?/gim);
	const idPatterns = countMatches(text, /(?:dog|animal)\s*(?:id|#)\s*[:\-]?/gi);
	const blockSignals = blockTexts.filter((block) =>
		/(?:entry\s*date|intake\s*date|na(?:m|rn)e\s*[:\-]?|dog\s*id|microchip)/i.test(block)
	).length;
	return Math.max(1, entryLabels, nameLabels, idPatterns, blockSignals);
}

function countMatches(text: string, regex: RegExp) {
	return [...text.matchAll(regex)].length;
}

function mergeFieldDefaults(
	base: IntakeSuggestion['fields'],
	overrides: IntakeSuggestion['fields']
): IntakeSuggestion['fields'] {
	const originalIntakeDate = overrides.originalIntakeDate || base.originalIntakeDate;
	const currentIntakeDate =
		overrides.currentIntakeDate || base.currentIntakeDate || originalIntakeDate;
	const reentryDates = dedupeAndSortDateStrings([
		...base.reentryDates,
		...overrides.reentryDates
	]).filter((value) => !originalIntakeDate || value !== originalIntakeDate);

	if (originalIntakeDate && currentIntakeDate && currentIntakeDate !== originalIntakeDate) {
		reentryDates.push(currentIntakeDate);
	}

	return {
			name: '',
			sex: overrides.sex === 'unknown' ? base.sex : overrides.sex,
			origin: overrides.origin || base.origin,
		dateOfBirth: overrides.dateOfBirth || base.dateOfBirth,
		originalIntakeDate,
		currentIntakeDate,
		reentryDates: dedupeAndSortDateStrings(reentryDates),
		leftShelterDate: overrides.leftShelterDate || base.leftShelterDate,
		weightLbs: overrides.weightLbs ?? base.weightLbs,
		microchipDate: overrides.microchipDate || base.microchipDate,
		pottyTrained: overrides.pottyTrained === 'unknown' ? base.pottyTrained : overrides.pottyTrained,
		goodWithDogs: overrides.goodWithDogs === 'unknown' ? base.goodWithDogs : overrides.goodWithDogs,
		goodWithCats: overrides.goodWithCats === 'unknown' ? base.goodWithCats : overrides.goodWithCats,
		goodWithKids: overrides.goodWithKids === 'unknown' ? base.goodWithKids : overrides.goodWithKids,
		goodWithElderly:
			overrides.goodWithElderly === 'unknown' ? base.goodWithElderly : overrides.goodWithElderly,
		goodOnLead: overrides.goodOnLead === 'unknown' ? base.goodOnLead : overrides.goodOnLead,
		goodTraveller:
			overrides.goodTraveller === 'unknown' ? base.goodTraveller : overrides.goodTraveller,
		crateTrained:
			overrides.crateTrained === 'unknown' ? base.crateTrained : overrides.crateTrained,
		idealHome: overrides.idealHome || base.idealHome,
		energyLevel: overrides.energyLevel === 'unknown' ? base.energyLevel : overrides.energyLevel,
		dietaryNotes: overrides.dietaryNotes || base.dietaryNotes,
		markings: overrides.markings || base.markings,
		hiddenComments: overrides.hiddenComments || base.hiddenComments,
		description: overrides.description || base.description,
		warningNotes: overrides.warningNotes || base.warningNotes,
		holdNotes: overrides.holdNotes || base.holdNotes,
		outdoorKennelAssignment: overrides.outdoorKennelAssignment || base.outdoorKennelAssignment,
		inFosterStatus:
			overrides.inFosterStatus === 'unknown' ? base.inFosterStatus : overrides.inFosterStatus,
		microchippedStatus:
			overrides.microchippedStatus === 'unknown'
				? base.microchippedStatus
				: overrides.microchippedStatus,
		vaccinationStatus:
			overrides.vaccinationStatus === 'unknown'
				? base.vaccinationStatus
				: overrides.vaccinationStatus,
		vaccinatedDate: overrides.vaccinatedDate || base.vaccinatedDate,
		fixedStatus: overrides.fixedStatus === 'unknown' ? base.fixedStatus : overrides.fixedStatus,
		fixedDate: overrides.fixedDate || base.fixedDate,
		surgeryDate: overrides.surgeryDate || base.surgeryDate,
		healthProblems: overrides.healthProblems || base.healthProblems
	};
}

function extractDefaultFields(text: string): IntakeSuggestion['fields'] {
	const dateOfBirth = parseDateOfBirthFromText(text);
	const sex = parseSexFromText(text);
	const originalIntakeDate = parseOriginalIntakeDateFromText(text);
	const currentIntakeDate = parseCurrentIntakeDateFromText(text, originalIntakeDate);
	const reentryDates = parseReentryDatesFromText(text, originalIntakeDate, currentIntakeDate);
	const leftShelterDate = parseLeftShelterDateFromText(text);
	const weightLbs = parseWeightLbsFromText(text);
	const locationValue = cleanText(
		extractByRegex(text, /(?:location|unit)\s*[:#\-]?\s*([A-Za-z0-9_()/ -]{1,48})/i)
	);
	const kennelValue = cleanText(
		extractByRegex(text, /(?:kennel(?:\s*assignment)?|run)\s*[:#\-]?\s*([A-Za-z0-9_()/ -]{1,24})/i)
	);
	const microchipDate = parseMicrochipDateFromText(text);
	const potty = parsePottyFromText(text);
	const goodWithDogs = parseCompatibilityFromText(text, [
		'good\\s*with\\s*dogs?',
		'dogs?\\s*friendly'
	]);
	const goodWithCats = parseCompatibilityFromText(text, [
		'good\\s*with\\s*cats?',
		'cats?\\s*friendly'
	]);
	const goodWithKids = parseCompatibilityFromText(text, [
		'good\\s*with\\s*(?:kids?|children)',
		'child(?:ren)?\\s*friendly'
	]);
	const goodWithElderly = parseCompatibilityFromText(text, ['good\\s*with\\s*elderly']);
	const goodOnLead = parseCompatibilityFromText(text, ['good\\s*on\\s*lead']);
	const goodTraveller = parseCompatibilityFromText(text, ['good\\s*travell?er']);
	const crateTrained = parseCompatibilityFromText(text, ['crate\\s*trained']);
	const energyLevel = parseEnergyFromText(text);
	const microchippedStatus = parseMicrochippedStatusFromText(text);
	const vaccinationStatus = parseVaccinationStatusFromText(text);
	const vaccinatedDate = parseVaccinationDateFromText(text);
	const fixedStatus = parseFixedStatusFromText(text);
	const fixedDate = parseFixedDateFromText(text);
	const surgeryDate = parseSurgeryDateFromText(text);
	const markings = parseLabeledFieldFromText(text, ['markings']);
	const hiddenComments = parseLabeledFieldFromText(text, ['hidden\\s*comments?']);
	const description = parseLabeledFieldFromText(text, ['description']);
	const warningNotes = parseLabeledFieldFromText(text, ['warning']);
	const holdNotes = parseLabeledFieldFromText(text, ['hold\\s*notes?']);
	const healthProblems = parseLabeledFieldFromText(text, ['health\\s*problems?']);
	const explicitIdealHome = cleanText(
		extractByRegex(text, /(?:ideal\s*home|best\s*home|home\s*fit)\s*[:\-]?\s*([^\n]{1,120})/i)
	);
	const inferredIdealHome = deriveIdealHomeHint({
		goodWithDogs,
		goodWithCats,
		goodWithKids,
		energyLevel
	});
	const originValue = cleanText(
		extractByRegex(text, /(?:origin|came\s*from|intake\s*type|source)\s*[:\-]?\s*([^\n]{1,80})/i)
	);
	const origin = originValue;
	const outdoorKennelAssignment = chooseKennelAssignment(kennelValue, locationValue);
	const inFosterStatus = parseInFosterStatusFromText(text, locationValue);

	return {
			name: '',
			sex,
			origin,
			dateOfBirth,
		originalIntakeDate,
		currentIntakeDate,
		reentryDates,
		leftShelterDate,
		weightLbs,
		microchipDate,
		pottyTrained: potty,
		goodWithDogs,
		goodWithCats,
		goodWithKids,
		goodWithElderly,
		goodOnLead,
		goodTraveller,
		crateTrained,
		idealHome: explicitIdealHome || inferredIdealHome,
		energyLevel,
		dietaryNotes: cleanText(
			extractByRegex(
				text,
				/(?:dietary\s*notes?|diet\s*notes?|feeding\s*notes?)\s*[:\-]?\s*([^\n]{1,120})/i
			)
		),
		markings,
		hiddenComments,
		description,
		warningNotes,
		holdNotes,
		outdoorKennelAssignment,
		inFosterStatus,
		microchippedStatus,
		vaccinationStatus,
		vaccinatedDate,
		fixedStatus,
		fixedDate,
		surgeryDate,
		healthProblems
	};
}

function parseSexFromText(text: string): DogSex {
	const explicit = cleanText(extractByRegex(text, /\bsex\s*[:\-]?\s*(male|female|unknown)\b/i));
	if (explicit) return normalizeSex(explicit);

	if (/\bmale\s+dog\b/i.test(text)) return 'male';
	if (/\bfemale\s+dog\b/i.test(text)) return 'female';

	return 'unknown';
}

function parseOriginalIntakeDateFromText(text: string): string {
	return firstMatchingDate(text, [
		/\bentered\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\boriginal\s*(?:entry|intake)(?:\s*date)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\bfirst\s*entered\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\badded\s*by[^\n]{0,80}\bon\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\b(?:entry|intake)\s*date\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i
	]);
}

function parseDateOfBirthFromText(text: string): string {
	return firstMatchingDate(text, [
		/\bdate\s*of\s*birth\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\bdob\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\bbirth(?:day)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i
	]);
}

function parseCurrentIntakeDateFromText(text: string, originalIntakeDate: string): string {
	const current = firstMatchingDate(text, [
		/\blast\s*entered\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\bre[- ]?entered\s*(?:shelter)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\breturned\s*to\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\bcurrent\s*(?:entry|intake)(?:\s*date)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\bentered\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i,
		/\b(?:entry|intake)\s*date\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i
	]);

	return current || originalIntakeDate;
}

function parseReentryDatesFromText(
	text: string,
	originalIntakeDate: string,
	currentIntakeDate: string
): string[] {
	const parsed = collectMatchingDates(text, [
		/\blast\s*entered\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/gi,
		/\bre[- ]?entered\s*(?:shelter)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/gi,
		/\breturned\s*to\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/gi,
		/\breentry(?:\s*date)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/gi
	]).filter((value) => !originalIntakeDate || value !== originalIntakeDate);

	if (originalIntakeDate && currentIntakeDate && currentIntakeDate !== originalIntakeDate) {
		parsed.push(currentIntakeDate);
	}

	return dedupeAndSortDateStrings(parsed);
}

function parseLeftShelterDateFromText(text: string): string {
	return firstMatchingDate(text, [
		/\bleft\s*shelter\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i
	]);
}

function parseMicrochipDateFromText(text: string): string {
	const direct = firstMatchingDate(text, [
		/\bmicrochip(?:ped)?(?:\s*date)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i
	]);
	if (direct) return direct;

	const nearbyMicrochipText = cleanText(extractByRegex(text, /\bmicrochip[^\n]{0,120}\b([^\n]{1,120})/i));
	const token = cleanText(nearbyMicrochipText.match(/\b([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})\b/i)?.[1]);
	return normalizeDateString(token);
}

function parseWeightLbsFromText(text: string): number | null {
	const explicitWeight = normalizeWeightLbs(
		extractByRegex(
			text,
			/(?:weight|wt)(?:\s*of\s*dog)?(?:\s*\(?(?:lbs?|pounds?)\)?)?\s*[:\-]?\s*([0-9]{1,3}(?:\.[0-9])?)/i
		)
	);
	if (explicitWeight !== null) return constrainWeightLbs(explicitWeight);

	const slashWeight = normalizeWeightLbs(
		extractByRegex(text, /\/\s*([0-9]{1,3}(?:\.[0-9])?)\s*(?:lb|lbs|pounds?)\b/i)
	);
	if (slashWeight !== null) return constrainWeightLbs(slashWeight);

	for (const match of text.matchAll(/\b([0-9]{1,3}(?:\.[0-9])?)\s*(?:lb|lbs|pounds?)\b/gi)) {
		const candidate = normalizeWeightLbs(match[1] ?? '');
		if (candidate !== null) return constrainWeightLbs(candidate);
	}

	return null;
}

function constrainWeightLbs(value: number) {
	if (value < 2 || value > 250) return null;
	return value;
}

function parseLabeledFieldFromText(text: string, labelPatterns: string[], maxLength = 180): string {
	for (const labelPattern of labelPatterns) {
		const regex = new RegExp(`(?:${labelPattern})\\s*[:\\-]?\\s*([^\\n]{1,${maxLength}})`, 'i');
		const value = cleanText(extractByRegex(text, regex));
		if (value) return value;
	}
	return '';
}

function firstMatchingDate(text: string, patterns: RegExp[]): string {
	for (const pattern of patterns) {
		const value = normalizeDateString(extractByRegex(text, pattern));
		if (value) return value;
	}
	return '';
}

function collectMatchingDates(text: string, patterns: RegExp[]): string[] {
	const values: string[] = [];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			const value = normalizeDateString(cleanText(match[1]));
			if (value) values.push(value);
		}
	}
	return dedupeAndSortDateStrings(values);
}

function chooseKennelAssignment(explicitKennel: string, locationValue: string): string {
	if (looksLikeSpecificKennel(explicitKennel)) return cleanText(explicitKennel);
	if (looksLikeSpecificKennel(locationValue)) return cleanText(locationValue);
	return '';
}

function parseInFosterStatusFromText(text: string, locationValue: string): FosterStatus {
	const locationKey = normalizeText(locationValue);
	if (locationKey) {
		if (isLikelyFosterLocation(locationKey)) return 'yes';
		if (isLikelyShelterLocation(locationKey)) return 'no';
	}

	if (/\bin\s*foster\b/i.test(text) || /\bfoster\s*status\s*[:\-]?\s*yes\b/i.test(text)) {
		return 'yes';
	}
	if (
		/\bnot\s*in\s*foster\b/i.test(text) ||
		/\bfoster\s*status\s*[:\-]?\s*no\b/i.test(text) ||
		/\blocation\s*[:\-]?\s*dog[_\s-]*shelter\b/i.test(text)
	) {
		return 'no';
	}

	return 'unknown';
}

function isLikelyFosterLocation(locationKey: string) {
	return (
		/(?:^|[^a-z])foster(?:home)?(?:[^a-z]|$)/i.test(locationKey) &&
		!isLikelyShelterLocation(locationKey)
	);
}

function isLikelyShelterLocation(locationKey: string) {
	return /dogshelter|animalshelter|shelter|kennel|onsite|inhouse|facility/i.test(locationKey);
}

function looksLikeSpecificKennel(value: string): boolean {
	const cleaned = cleanText(value);
	if (!cleaned) return false;
	if (isGenericShelterLocation(cleaned)) return false;

	if (/^(?:run|kennel|unit)\s*[#:-]?\s*[A-Za-z0-9-]{1,10}$/i.test(cleaned)) return true;
	if (/^[A-Za-z]{0,2}\d{1,3}[A-Za-z]?$/i.test(cleaned)) return true;
	if (/^[A-Za-z0-9][A-Za-z0-9 _/-]{1,20}$/.test(cleaned) && /\d/.test(cleaned)) return true;

	return false;
}

function isGenericShelterLocation(value: string): boolean {
	const key = normalizeText(value);
	if (!key) return true;

	const generic = new Set([
		'dogshelter',
		'shelter',
		'foster',
		'intake',
		'kennel',
		'dogkennel',
		'animalshelter',
		'unknown',
		'none',
		'select'
	]);
	if (generic.has(key)) return true;
	if (/^(dog|animal)?shelter[a-z0-9]*$/i.test(key)) return true;

	return false;
}

function deriveIdealHomeHint(input: {
	goodWithDogs: Compatibility;
	goodWithCats: Compatibility;
	goodWithKids: Compatibility;
	energyLevel: EnergyLevel;
}): string {
	const hints: string[] = [];
	if (input.goodWithKids === 'no') hints.push('Adult-only home preferred.');
	if (input.goodWithCats === 'no') hints.push('No cats recommended.');
	if (input.goodWithDogs === 'no') hints.push('Best as the only dog.');
	if (input.energyLevel === 'very_high' || input.energyLevel === 'high') {
		hints.push('Needs an active home.');
	} else if (input.energyLevel === 'low') {
		hints.push('Calmer home is a good fit.');
	}
	return hints.join(' ');
}

function parsePottyFromText(text: string): PottyTrainedStatus {
	const snippet = extractByRegex(
		text,
		/(?:house\s*trained|housetrained|potty(?:\s*trained)?)\s*[:\-]?\s*([A-Za-z _-]{1,48})/i
	);
	return parsePottySnippet(snippet);
}

function parseMicrochippedStatusFromText(text: string): MedicalStatus {
	const explicit = extractByRegex(
		text,
		/(?:microchipped?|microchip(?:\s*status)?)\s*[:\-]?\s*([A-Za-z0-9 _-]{1,48})/i
	);
	const parsedExplicit = parseMedicalSnippet(explicit);
	if (parsedExplicit !== 'unknown') return parsedExplicit;

	// Common shelter layouts show microchip label + date/number without an explicit yes/no token.
	if (/\bmicrochipp?(?:ed)?\b[^\n]{0,80}\b[0-9]{9,18}\b/i.test(text)) return 'yes';
	if (
		/\bmicrochipp?(?:ed)?\b[^\n]{0,80}\b[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}\b/i.test(text)
	) {
		return 'yes';
	}
	if (/\bmicrochip\s*[:\-]?\s*[A-Za-z0-9]{6,}\b/i.test(text)) return 'yes';
	if (/\bno\s*microchip\b|\bnot\s*microchipped\b|\bmicrochipp?(?:ed)?\s*[:\-]?\s*no\b/i.test(text)) {
		return 'no';
	}

	return 'unknown';
}

function parseVaccinationStatusFromText(text: string): MedicalStatus {
	const explicit = extractByRegex(
		text,
		/(?:vaccinated?|vaccinations?|vaccination\s*status|vax(?:xed)?)\s*[:\-]?\s*([A-Za-z _-]{1,40})/i
	);
	const parsedExplicit = parseMedicalSnippet(explicit);
	if (parsedExplicit !== 'unknown') return parsedExplicit;

	const rabiesDate = normalizeDateString(
		extractByRegex(text, /\brabies\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i)
	);
	if (rabiesDate) return 'yes';

	const vaccinatedDate = parseVaccinationDateFromText(text);
	if (vaccinatedDate) return 'yes';

	return 'unknown';
}

function parseVaccinationDateFromText(text: string): string {
	const direct = normalizeDateString(
		extractByRegex(
			text,
			/(?:vaccinated?|vaccination(?:\s*date)?|vax(?:xed)?(?:\s*date)?)\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i
		)
	);
	if (direct) return direct;

	return normalizeDateString(
		extractByRegex(text, /\brabies\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i)
	);
}

function parseFixedStatusFromText(text: string): MedicalStatus {
	const explicit = extractByRegex(
		text,
		/(?:spayed\/?\s*neutered|spayed|neutered|fixed|altered)\s*[:\-]?\s*([A-Za-z0-9 _/-]{1,40})/i
	);
	const parsedExplicit = parseMedicalSnippet(explicit);
	if (parsedExplicit !== 'unknown') return parsedExplicit;

	if (/\b(?:intact|not\s*fixed|not\s*spayed|not\s*neutered|not\s*altered|unaltered)\b/i.test(text)) {
		return 'no';
	}
	if (/\baltered\b/i.test(text) && !/\bnot\s*altered\b|\bunaltered\b/i.test(text)) return 'yes';
	if (parseFixedDateFromText(text)) return 'yes';
	return 'unknown';
}

function parseFixedDateFromText(text: string): string {
	const direct = normalizeDateString(
		extractByRegex(
			text,
			/(?:spayed\/?\s*neutered|spayed|neutered|fixed|altered)(?:\s*date)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i
		)
	);
	if (direct) return direct;
	return normalizeDateString(
		extractByRegex(text, /\b(?:fixed|altered)\s*date\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i)
	);
}

function parseSurgeryDateFromText(text: string): string {
	return normalizeDateString(
		extractByRegex(text, /\bsurgery(?:\s*date)?\s*[:\-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i)
	);
}

function detectDogNameCandidates(text: string): string[] {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
	const names: string[] = [];
	const normalized = text.replace(/[|]/g, 'I');

	// Pattern 1: "Oggie - 2026-62830" or similar
	for (const match of normalized.matchAll(/([A-Za-z][A-Za-z' ]{1,24})\s*[-–]\s*[A-Z0-9-]{3,}/g)) {
		pushUniqueName(names, match[1] ?? '');
	}

	// Pattern 2: "Name: Buddy" (including common OCR misspelling "Narne")
	for (const match of normalized.matchAll(/(?:^|\b)na(?:m|rn)e\s*[:\-]?\s*([A-Za-z][A-Za-z' ]{1,24})/gi)) {
		pushUniqueName(names, match[1] ?? '');
	}

	// Pattern 3: Name appears before "Entry Date" on a noisy line.
	for (const match of normalized.matchAll(
		/(?:^|\n)\s*([A-Za-z][A-Za-z' -]{1,24})[^\n]{0,140}(?:entry\s*date|intake\s*date)\b/gi
	)) {
		pushUniqueName(names, match[1] ?? '');
	}

	// Pattern 4: "Dog ID ... Name: Buddy" style boards.
	for (const match of normalized.matchAll(
		/(?:dog|animal)\s*(?:id|#)\s*[:\-]?\s*[A-Z0-9-]{2,}[^\n]{0,120}na(?:m|rn)e\s*[:\-]?\s*([A-Za-z][A-Za-z' -]{1,24})/gi
	)) {
		pushUniqueName(names, match[1] ?? '');
	}

	// Pattern 5: Standalone name followed by an ID token.
	for (const match of normalized.matchAll(
		/(?:^|\n)\s*([A-Za-z][A-Za-z' -]{1,24})\s+(?:[A-Z]{0,3}\d{3,}|20\d{2}\s*[-/]\s*\d{3,})\b/gim
	)) {
		pushUniqueName(names, match[1] ?? '');
	}

	// Pattern 6: Dense roster text with many title-case names.
	for (const match of normalized.matchAll(/\b([A-Z][A-Za-z']{2,24}(?:\s*\([A-Z][A-Za-z']{2,24}\))?)\b/g)) {
		pushUniqueName(names, match[1] ?? '');
	}

	for (const line of lines) {
		if (!line.includes(':')) {
			const rowNames = [...line.matchAll(/([A-Z][A-Za-z']{2,24}(?:\s*\([A-Z][A-Za-z']{2,24}\))?)/g)].map(
				(match) => match[1] ?? ''
			);
			if (rowNames.length >= 2) {
				for (const rowName of rowNames) {
					pushUniqueName(names, rowName);
				}
			}
		}

		const idPattern = line.match(/^([A-Za-z][A-Za-z' -]{1,24})\s*[-–]\s*[0-9]{3,}/);
		if (idPattern?.[1]) {
			pushUniqueName(names, idPattern[1]);
			continue;
		}

		const labelPattern = line.match(/^name\s*[:\-]?\s*([A-Za-z][A-Za-z' -]{1,24})/i);
		if (labelPattern?.[1]) {
			pushUniqueName(names, labelPattern[1]);
			continue;
		}

		// Fallback: short standalone line that looks like a proper name.
		if (line.length <= 24 && !line.includes(':') && /^[A-Z][A-Za-z' -]+$/.test(line)) {
			pushUniqueName(names, line);
		}
	}

	return names;
}

function pushUniqueName(list: string[], candidate: string) {
	const normalized = normalizeName(candidate);
	if (!normalized) return;
	if (isLikelyNonName(normalized)) return;
	if (!list.some((item) => normalizeText(item) === normalizeText(normalized))) {
		list.push(normalized);
	}
}

function normalizeName(input: string) {
	const cleaned = input
		.replace(/[^A-Za-z' -]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned) return '';
	const cased = cleaned
		.split(' ')
		.slice(0, 2)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(' ');
	return cased;
}

function isLikelyNonName(value: string) {
	if (value.length < 2) return true;
	const tokens = value
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (tokens.length === 0) return true;
	const stopWords = new Set([
		'entry',
		'date',
		'estimated',
		'breed',
		'birthday',
		'color',
		'sex',
		'weight',
		'markings',
		'microchip',
		'description',
		'good',
		'cats',
		'dogs',
		'kids',
		'children',
		'housetrained',
		'house',
		'trained',
		'staff',
		'only',
		'available',
		'adoption',
		'check',
		'back',
		'later',
		'not',
		'for',
		'please',
		'kennel',
		'unknown',
		'photo',
		'intake',
		'board',
		'dog',
		'shelter',
		'foster',
		'male',
		'female',
		'pup',
		'location',
		'details',
		'notes',
		'species',
		'code'
	]);
	return tokens.every((token) => stopWords.has(token));
}

function detectNamesFromExistingRoster(text: string, existingDogs: ExistingDog[]): string[] {
	if (existingDogs.length === 0) return [];
	const tokenSet = new Set(extractTokenKeys(text));
	const tokenList = [...tokenSet];
	const normalizedText = normalizeText(text);
	const matches: string[] = [];

	for (const dog of existingDogs) {
		const fullKey = normalizeText(dog.name);
		const firstKey = primaryNameKey(dog.name);
		const aliases = extractNameAliases(dog.name);
		let matched = false;

		if (fullKey.length >= 6 && normalizedText.includes(fullKey)) {
			matched = true;
		}

		if (!matched) {
			for (const alias of aliases) {
				if (!alias || alias.length < 3) continue;
				if (tokenSet.has(alias)) {
					matched = true;
					break;
				}
			}
		}

		if (!matched && firstKey.length >= 5) {
			matched = tokenList.some((token) => {
				if (token.length < 3) return false;
				if (token[0] !== firstKey[0]) return false;
				const limit = firstKey.length >= 8 ? 2 : 1;
				return boundedLevenshtein(firstKey, token, limit) <= limit;
			});
		}

		if (matched) {
			pushUniqueName(matches, dog.name);
		}
	}

	return matches;
}

function findExistingDogByName(existingDogs: ExistingDog[], name: string) {
	const cleaned = cleanText(name);
	if (!cleaned) return null;

	const normalized = normalizeText(cleaned);
	if (!normalized) return null;

	const exactMatches = existingDogs.filter((dog) => normalizeText(dog.name) === normalized);
	if (exactMatches.length === 1) return exactMatches[0] ?? null;
	if (exactMatches.length > 1) return exactMatches[0] ?? null;

	const primary = primaryNameKey(cleaned);
	if (primary) {
		const primaryMatches = existingDogs.filter((dog) => primaryNameKey(dog.name) === primary);
		if (primaryMatches.length === 1) return primaryMatches[0] ?? null;
	}

	const fuzzyFull = findClosestExistingDog(existingDogs, normalized, false);
	if (fuzzyFull) return fuzzyFull;

	if (primary && primary !== normalized) {
		const fuzzyPrimary = findClosestExistingDog(existingDogs, primary, true);
		if (fuzzyPrimary) return fuzzyPrimary;
	}

	return null;
}

function parseCompatibilityFromText(text: string, labels: string[]): Compatibility {
	const labelPattern = labels.join('|');
	const regex = new RegExp(`(?:${labelPattern})\\s*[:\\-]?\\s*([A-Za-z _-]{1,36})`, 'i');
	const snippet = extractByRegex(text, regex);
	return parseCompatibilitySnippet(snippet);
}

function parseEnergyFromText(text: string): EnergyLevel {
	const direct = extractByRegex(text, /(?:energy(?:\s*level)?|activity)\s*[:\-]?\s*([A-Za-z _-]{1,40})/i);
	const directEnergy = parseEnergySnippet(direct);
	if (directEnergy !== 'unknown') return directEnergy;
	if (/\benergy(?:\s*level)?\s*[:\-]?\s*unknown\b/i.test(text)) return 'unknown';
	if (/very\s*high\s*energy/i.test(text)) return 'very_high';
	if (/high\s*energy/i.test(text)) return 'high';
	if (/medium\s*energy/i.test(text)) return 'medium';
	if (/low\s*energy/i.test(text)) return 'low';
	return 'unknown';
}

function parsePottySnippet(value: string): PottyTrainedStatus {
	const normalized = cleanText(value).toLowerCase();
	const tokens = tokenizeEnumText(normalized);
	if (
		normalized.includes('working on it') ||
		normalized.includes('working_on_it') ||
		normalized.includes('in progress') ||
		(tokens.includes('working') && tokens.includes('it'))
	) {
		return 'working_on_it';
	}
	if (tokens.includes('yes') || tokens.includes('y') || tokens.includes('true')) return 'yes';
	if (tokens.includes('no') || tokens.includes('n') || tokens.includes('false')) return 'no';
	if (tokens.includes('unknown') || tokens.includes('unk') || tokens.includes('u')) return 'unknown';
	return 'unknown';
}

function parseMedicalSnippet(value: string): MedicalStatus {
	const normalized = cleanText(value).toLowerCase();
	const tokens = tokenizeEnumText(normalized);
	if (/not\s+(?:vaccinated|fixed|spayed|neutered)/i.test(normalized)) return 'no';
	if (normalized.includes('intact')) return 'no';
	if (tokens.includes('yes') || tokens.includes('y') || tokens.includes('true')) return 'yes';
	if (tokens.includes('no') || tokens.includes('n') || tokens.includes('false')) return 'no';
	if (tokens.includes('unknown') || tokens.includes('unk') || tokens.includes('u')) return 'unknown';
	if (normalized.includes('up to date') || normalized.includes('current')) return 'yes';
	return 'unknown';
}

function parseCompatibilitySnippet(value: string): Compatibility {
	const tokens = tokenizeEnumText(value);
	if (tokens.includes('yes') || tokens.includes('y') || tokens.includes('true')) return 'yes';
	if (tokens.includes('no') || tokens.includes('n') || tokens.includes('false')) return 'no';
	if (tokens.includes('unknown') || tokens.includes('unk') || tokens.includes('u')) return 'unknown';
	return 'unknown';
}

function parseEnergySnippet(value: string): EnergyLevel {
	const normalized = cleanText(value).toLowerCase();
	const tokens = tokenizeEnumText(normalized);
	if (normalized.includes('very high') || normalized.includes('very_high')) return 'very_high';
	if (tokens.includes('very') && tokens.includes('high')) return 'very_high';
	if (tokens.includes('high')) return 'high';
	if (tokens.includes('medium')) return 'medium';
	if (tokens.includes('low')) return 'low';
	if (tokens.includes('unknown') || tokens.includes('unk') || tokens.includes('u')) return 'unknown';
	return 'unknown';
}

function tokenizeEnumText(value: string): string[] {
	return cleanText(value)
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter(Boolean)
		.slice(0, 12);
}

function normalizeDateString(value: string): string {
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

	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return '';
	}

	const yyyy = String(year).padStart(4, '0');
	const mm = String(month).padStart(2, '0');
	const dd = String(day).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function extractDateTokens(text: string): string[] {
	return [...cleanText(text).matchAll(/\b(\d{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})\b/g)]
		.map((match) => cleanText(match[1]))
		.filter(Boolean);
}

function dedupeAndSortDateStrings(values: string[]): string[] {
	const deduped = [...new Set(values.filter(Boolean))];
	return deduped.sort((a, b) => a.localeCompare(b));
}

function extractByRegex(text: string, regex: RegExp): string {
	const match = text.match(regex);
	return match?.[1] ? cleanText(match[1]) : '';
}

function normalizeText(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function primaryNameKey(value: string) {
	const first = cleanText(value).split(/\s+/)[0] ?? '';
	return normalizeText(first);
}

function findClosestExistingDog(
	existingDogs: ExistingDog[],
	candidateKey: string,
	usePrimaryOnly: boolean
): ExistingDog | null {
	if (!candidateKey || candidateKey.length < 4) return null;

	const maxDistance = candidateKey.length >= 8 ? 2 : 1;
	let bestMatch: ExistingDog | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	let ambiguous = false;

	for (const dog of existingDogs) {
		const compareKey = usePrimaryOnly ? primaryNameKey(dog.name) : normalizeText(dog.name);
		if (!compareKey || compareKey.length < 3) continue;
		if (compareKey[0] !== candidateKey[0]) continue;
		if (Math.abs(compareKey.length - candidateKey.length) > maxDistance) continue;

		const distance = boundedLevenshtein(candidateKey, compareKey, maxDistance);
		if (distance > maxDistance) continue;

		if (distance < bestDistance) {
			bestDistance = distance;
			bestMatch = dog;
			ambiguous = false;
			continue;
		}

		if (distance === bestDistance) {
			ambiguous = true;
		}
	}

	if (!bestMatch || ambiguous) return null;
	return bestMatch;
}

function extractTokenKeys(text: string): string[] {
	const tokens = [...text.matchAll(/[A-Za-z][A-Za-z'()/-]{1,24}/g)]
		.map((match) => normalizeText(match[0] ?? ''))
		.filter((token) => token.length >= 3);
	return [...new Set(tokens)];
}

function extractNameAliases(name: string): string[] {
	const tokens = cleanText(name)
		.replace(/[()]/g, ' ')
		.split(/\s+/)
		.map((part) => normalizeText(part))
		.filter((part) => part.length >= 3);
	const aliases = new Set<string>();
	const full = normalizeText(name);
	const first = primaryNameKey(name);
	if (full) aliases.add(full);
	if (first) aliases.add(first);
	for (const token of tokens) aliases.add(token);
	return [...aliases];
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
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

async function safeReadText(response: Response): Promise<string> {
	try {
		const text = await response.text();
		return text.slice(0, 900);
	} catch {
		return '';
	}
}
