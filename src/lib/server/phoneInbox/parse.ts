import { env } from '$env/dynamic/private';
import type { ParseOutcome, RawAction } from './types';

const SYSTEM_PROMPT = `You turn short staff messages from an animal shelter's phone update line into structured actions. Messages come from staff texting or leaving voicemails while working with dogs.

Action types:
- "feeding": a dog ate (amountEaten: all/most/half/little) or refused food (none). mealTime "am" or "pm" if stated or clearly implied (e.g. "this morning"), else null.
- "trip_return": a dog is back from a day trip; include any behavior observations as note.
- "dog_note": any other observation about a specific dog (behavior, health, accidents, mood).
- "handoff_note": a message for the next shift that is not about one specific dog.

Rules:
- Use dog names exactly as written; do not invent or "correct" names.
- A message may contain several actions.
- Set unsure=true when the message doesn't fit these actions, names no dog for a dog-specific action, or you would have to guess.
- Never output any action type other than the four above.`;

const RESPONSE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['unsure', 'actions'],
	properties: {
		unsure: { type: 'boolean' },
		actions: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['type', 'dogName', 'amountEaten', 'mealTime', 'note', 'notes'],
				properties: {
					type: { type: 'string', enum: ['feeding', 'trip_return', 'dog_note', 'handoff_note'] },
					dogName: { type: ['string', 'null'] },
					amountEaten: { type: ['string', 'null'], enum: ['all', 'most', 'half', 'little', 'none', null] },
					mealTime: { type: ['string', 'null'], enum: ['am', 'pm', null] },
					note: { type: ['string', 'null'] },
					notes: { type: ['string', 'null'] }
				}
			}
		}
	}
} as const;

interface ModelAction {
	type: 'feeding' | 'trip_return' | 'dog_note' | 'handoff_note';
	dogName: string | null;
	amountEaten: 'all' | 'most' | 'half' | 'little' | 'none' | null;
	mealTime: 'am' | 'pm' | null;
	note: string | null;
	notes: string | null;
}

function toRawAction(a: ModelAction): RawAction | null {
	switch (a.type) {
		case 'feeding':
			if (!a.dogName || !a.amountEaten) return null;
			return { type: 'feeding', dogName: a.dogName, amountEaten: a.amountEaten, mealTime: a.mealTime, notes: a.notes };
		case 'trip_return':
			if (!a.dogName) return null;
			return { type: 'trip_return', dogName: a.dogName, note: a.note };
		case 'dog_note':
			if (!a.dogName || !a.note?.trim()) return null;
			return { type: 'dog_note', dogName: a.dogName, note: a.note };
		case 'handoff_note':
			if (!a.note?.trim()) return null;
			return { type: 'handoff_note', note: a.note };
	}
}

/**
 * Extracts raw actions from a message via OpenAI structured output (the
 * existing OPENAI_API_KEY). The dog roster is passed as context so the model
 * anchors on real names. Any malformed model action flips `unsure`.
 */
export async function parseInboundText(
	text: string,
	dogNames: string[],
	fetchImpl: typeof fetch = fetch
): Promise<ParseOutcome> {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

	const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: env.OPENAI_PARSE_MODEL || 'gpt-4.1-mini',
			temperature: 0,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{
					role: 'user',
					content: `Current shelter dogs: ${dogNames.join(', ') || '(roster unavailable)'}\n\nMessage: """${text}"""`
				}
			],
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'phone_inbox_actions', strict: true, schema: RESPONSE_SCHEMA }
			}
		})
	});

	if (!response.ok) {
		throw new Error(`OpenAI parse failed: ${response.status} ${await response.text()}`);
	}

	const payload = await response.json();
	const content = payload?.choices?.[0]?.message?.content;
	if (typeof content !== 'string') throw new Error('OpenAI parse: empty response');

	const parsed = JSON.parse(content) as { unsure: boolean; actions: ModelAction[] };
	const actions: RawAction[] = [];
	let unsure = Boolean(parsed.unsure);
	for (const modelAction of parsed.actions ?? []) {
		const raw = toRawAction(modelAction);
		if (raw) actions.push(raw);
		else unsure = true;
	}
	if (actions.length === 0) unsure = true;
	return { actions, unsure };
}
