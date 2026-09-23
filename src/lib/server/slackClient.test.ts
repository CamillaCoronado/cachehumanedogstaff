import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelHistory } from './slackClient';

function fakeSlack(routes: Record<string, (params: URLSearchParams) => unknown>) {
	vi.stubGlobal('fetch', async (url: URL | string) => {
		const u = new URL(String(url));
		const method = u.pathname.split('/').pop()!;
		return { json: async () => ({ ok: true, ...(routes[method]?.(u.searchParams) as object) }) } as Response;
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('channelHistory', () => {
	it('reads thread replies when asked, once each', async () => {
		fakeSlack({
			'conversations.history': () => ({
				messages: [
					{ ts: '3', text: 'Rex got a bath', user: 'u' },
					{ ts: '1', text: 'baths today:', user: 'u', reply_count: 2, thread_ts: '1' },
					// A reply also sent to the channel appears in history too.
					{ ts: '2', text: 'Dot too', user: 'u', thread_ts: '1' }
				]
			}),
			'conversations.replies': (p) =>
				p.get('ts') === '1'
					? { messages: [{ ts: '1', text: 'baths today:', thread_ts: '1' }, { ts: '1.5', text: 'Dior got a bath', user: 'u', thread_ts: '1' }, { ts: '2', text: 'Dot too', user: 'u', thread_ts: '1' }] }
					: { messages: [] }
		});
		const { messages } = await channelHistory('t', 'C', new Date(0), 15, true);
		expect(messages.map((m) => m.ts).sort()).toEqual(['1', '1.5', '2', '3']);
	});

	it('leaves replies out unless asked', async () => {
		fakeSlack({
			'conversations.history': () => ({ messages: [{ ts: '1', text: 'x', reply_count: 1 }] }),
			'conversations.replies': () => ({ messages: [{ ts: '1.5', text: 'reply' }] })
		});
		const { messages } = await channelHistory('t', 'C', new Date(0));
		expect(messages.map((m) => m.ts)).toEqual(['1']);
	});
});
