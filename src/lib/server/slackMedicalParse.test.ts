import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'key' } }));

const { parseMedicalPost } = await import('./slackMedicalParse');

const reply = (content: unknown) =>
	(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))) as unknown as typeof fetch;

const a = (o: Record<string, unknown>) => ({ type: 'treatment', dogName: 'Bruiser', drug: null, condition: null, days: null, note: null, ...o });

describe('parseMedicalPost', () => {
	it('keeps well-formed actions', async () => {
		const r = await parseMedicalPost('x', ['Bruiser'], reply({ unsure: false, actions: [a({ drug: 'doxy', condition: 'URI' })] }));
		expect(r).toEqual({ unsure: false, actions: [a({ drug: 'doxy', condition: 'URI' })] });
	});

	it('flags unsure when an action is missing what it needs', async () => {
		const r = await parseMedicalPost('x', [], reply({ unsure: false, actions: [a({ drug: null }), a({ type: 'monitor', dogName: ' Loki ' })] }));
		expect(r.unsure).toBe(true);
		expect(r.actions).toEqual([a({ type: 'monitor', dogName: 'Loki' })]);
	});

	it('throws on an API error so the post is queued, not lost', async () => {
		const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
		await expect(parseMedicalPost('x', [], failing)).rejects.toThrow('500');
	});
});
