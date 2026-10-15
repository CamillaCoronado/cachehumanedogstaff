import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'key' } }));

const { parseMedicalPost } = await import('./slackMedicalParse');

const reply = (content: unknown) =>
	(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))) as unknown as typeof fetch;

const a = (o: Record<string, unknown>) => ({ type: 'monitor', dogName: 'Loki', condition: null, ...o });

describe('parseMedicalPost', () => {
	it('keeps monitor actions', async () => {
		const r = await parseMedicalPost('x', ['Loki'], reply({ unsure: false, actions: [a({ condition: 'diarrhea' })] }));
		expect(r).toEqual({ unsure: false, actions: [a({ condition: 'diarrhea' })] });
	});

	it('flags unsure when an action names no dog, and trims names', async () => {
		const r = await parseMedicalPost('x', [], reply({ unsure: false, actions: [a({ dogName: ' ' }), a({ dogName: ' Luno ' })] }));
		expect(r.unsure).toBe(true);
		expect(r.actions).toEqual([a({ dogName: 'Luno' })]);
	});

	it('throws on an API error so the post is queued, not lost', async () => {
		const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
		await expect(parseMedicalPost('x', [], failing)).rejects.toThrow('500');
	});
});
