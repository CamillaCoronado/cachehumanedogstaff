import { env } from '$env/dynamic/private';
import type { MedicalActionType, RawMedicalAction } from '$lib/utils/medicalSlack';

const SYSTEM_PROMPT = `You read posts from an animal shelter's #medical-updates Slack channel and turn them into structured actions about specific dogs. Staff write casually, misspell drugs, and often cover several dogs in one post.

Action types (one action per dog per thing; "Loki and Luno on monitor" is two actions):
- "treatment": a dog started an ongoing medication or course. drug = the medication as written ("doxy", "cough tabs", "CBD oil"); condition = what it's for ("URI", "diarrhea", "anxiety"), or null. Two drugs = two actions. If the post says treatment started but names no drug, drug = "<condition> treatment" (e.g. "giardia treatment").
- "fortiflora": a dog started FortiFlora (a probiotic). days = course length if stated, else null. condition = why.
- "fleas": a dog HAS fleas or was treated for fleas found on it. Not for preventative given as a precaution.
- "monitor": staff should watch a dog for something ("on monitor for diarrhea", "please monitor for vomiting"). condition = what to watch for.
- "isolation": a dog was moved into ISO / isolation. condition = why.
- "note": a one-time dose or procedure, or a medical observation that isn't any of the above ("given triple dewormer for tapeworms", "given flea and tick preventative", "hasn't eaten in days, given mirtazapine"). note = a short plain summary.

Rules:
- dogName: the dog's name as written, without emoji. A name standing for several dogs ("van trap puppies") is kept as one dogName.
- Never invent dogs, drugs or conditions.
- Messages that aren't about a specific dog's medical care (questions, thanks, logistics) produce no actions and unsure=false.
- Set unsure=true when you'd have to guess what happened to which dog.`;

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
				required: ['type', 'dogName', 'drug', 'condition', 'days', 'note'],
				properties: {
					type: { type: 'string', enum: ['treatment', 'fortiflora', 'fleas', 'monitor', 'isolation', 'note'] },
					dogName: { type: 'string' },
					drug: { type: ['string', 'null'] },
					condition: { type: ['string', 'null'] },
					days: { type: ['integer', 'null'] },
					note: { type: ['string', 'null'] }
				}
			}
		}
	}
} as const;

const TYPES: MedicalActionType[] = ['treatment', 'fortiflora', 'fleas', 'monitor', 'isolation', 'note'];

/**
 * A #medical-updates post as actions, via OpenAI structured output (the same key the
 * phone-update line uses). The roster anchors the model on real names. An action
 * missing what its type needs flips `unsure`, so the post goes to the admin queue.
 */
export async function parseMedicalPost(
	text: string,
	dogNames: string[],
	fetchImpl: typeof fetch = fetch
): Promise<{ actions: RawMedicalAction[]; unsure: boolean }> {
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
					content: `Current shelter dogs: ${dogNames.join(', ') || '(roster unavailable)'}\n\nPost: """${text}"""`
				}
			],
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'medical_update_actions', strict: true, schema: RESPONSE_SCHEMA }
			}
		})
	});
	if (!response.ok) throw new Error(`OpenAI parse failed: ${response.status} ${await response.text()}`);

	const payload = await response.json();
	const content = payload?.choices?.[0]?.message?.content;
	if (typeof content !== 'string') throw new Error('OpenAI parse: empty response');

	const parsed = JSON.parse(content) as { unsure: boolean; actions: RawMedicalAction[] };
	let unsure = Boolean(parsed.unsure);
	const actions: RawMedicalAction[] = [];
	for (const a of parsed.actions ?? []) {
		const ok =
			TYPES.includes(a.type) &&
			Boolean(a.dogName?.trim()) &&
			(a.type !== 'treatment' || Boolean(a.drug?.trim())) &&
			(a.type !== 'note' || Boolean(a.note?.trim()));
		if (ok) actions.push({ ...a, dogName: a.dogName.trim() });
		else unsure = true;
	}
	return { actions, unsure };
}
