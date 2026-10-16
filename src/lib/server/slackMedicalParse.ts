import { env } from '$env/dynamic/private';
import type { RawMedicalAction } from '$lib/utils/medicalSlack';

const SYSTEM_PROMPT = `You read posts from an animal shelter's #medical-updates Slack channel and find which dogs staff have put ON MONITOR. Staff write casually and often cover several dogs in one post.

A monitor action means staff should watch a dog for something: "on monitor for diarrhea", "please monitor and report any vomiting", "monitor for coughing". One action per dog ("Loki and Luno on monitor" is two actions). condition = what to watch for, or null.

Ignore everything else: medications started, FortiFlora, fleas, isolation, one-off doses. Those come from another system.

Rules:
- dogName: the dog's name as written, without emoji. A name standing for several dogs ("van trap puppies") is kept as one dogName.
- Never invent dogs or conditions.
- A post with no monitor call produces no actions and unsure=false.
- Set unsure=true only when a post puts someone on monitor but you'd have to guess which dog.`;

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
				required: ['type', 'dogName', 'condition'],
				properties: {
					type: { type: 'string', enum: ['monitor'] },
					dogName: { type: 'string' },
					condition: { type: ['string', 'null'] }
				}
			}
		}
	}
} as const;

/**
 * The monitor calls in a #medical-updates post, via OpenAI structured output (the same
 * key the phone-update line uses). The roster anchors the model on real names. An
 * action with no dog flips `unsure`, so the post goes to the admin queue.
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
				json_schema: { name: 'medical_monitor_actions', strict: true, schema: RESPONSE_SCHEMA }
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
		if (a.type === 'monitor' && a.dogName?.trim()) {
			actions.push({ type: 'monitor', dogName: a.dogName.trim(), condition: a.condition ?? null });
		} else unsure = true;
	}
	return { actions, unsure };
}
