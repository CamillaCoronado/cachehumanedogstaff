import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelHistory, newChannelMessages } from './slackClient';

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

	it('skips the rest of the threads when Slack keeps rate-limiting, instead of failing', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', async (url: URL | string) => {
			const method = new URL(String(url)).pathname.split('/').pop();
			const body =
				method === 'conversations.history'
					? { ok: true, messages: [{ ts: '2', text: 'a', user: 'u', reply_count: 1 }, { ts: '1', text: 'b', user: 'u', reply_count: 1 }] }
					: { ok: false, error: 'ratelimited' };
			return { json: async () => body, headers: new Headers({ 'retry-after': '1' }) } as Response;
		});
		const run = channelHistory('t', 'C', new Date(0), 15, true);
		await vi.runAllTimersAsync();
		const { messages, threadsSkipped } = await run;
		vi.useRealTimers();
		expect(messages.map((m) => m.ts)).toEqual(['2', '1']);
		expect(threadsSkipped).toBe(2);
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

describe('newChannelMessages', () => {
	it('picks up a new reply in an older thread, and nothing already read', async () => {
		const nowS = Date.now() / 1000;
		const t = (secondsAgo: number) => String(nowS - secondsAgo);
		const cursor = t(3600); // last read an hour ago
		const oldThread = t(86_400); // a thread started yesterday…
		const newReply = t(600); // …got a reply ten minutes ago
		fakeSlack({
			'conversations.history': () => ({
				messages: [
					{ ts: t(60), text: 'Rex got a bath', user: 'u' },
					{ ts: t(7200), text: 'already read', user: 'u' },
					{ ts: oldThread, text: 'baths:', user: 'u', reply_count: 2, latest_reply: newReply }
				]
			}),
			'conversations.replies': () => ({
				messages: [
					{ ts: oldThread, text: 'baths:', user: 'u' },
					{ ts: t(80_000), text: 'old reply, already read', user: 'u' },
					{ ts: newReply, text: 'Dior got a bath', user: 'u' }
				]
			})
		});
		const got = await newChannelMessages('tok', 'C', cursor, 2);
		expect(got.map((m) => m.text)).toEqual(['Rex got a bath', 'Dior got a bath']);
	});
});
