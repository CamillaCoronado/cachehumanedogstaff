import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── A small in-memory Firestore: enough for the backfill's reads and writes. ──
const store = new Map<string, Record<string, unknown>>();
function docRef(path: string) {
	const id = path.split('/').pop()!;
	const ref = {
		id,
		path,
		get: async () => ({ id, ref, exists: store.has(path), data: () => store.get(path) }),
		set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
			store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data });
		},
		collection: (name: string) => collectionRef(`${path}/${name}`)
	};
	return ref;
}
function collectionRef(path: string) {
	const get = async () => ({
		docs: [...store.keys()]
			.filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
			.map((k) => ({ id: k.split('/').pop()!, ref: docRef(k), data: () => store.get(k)! }))
	});
	return { get, select: () => ({ get }), doc: (id: string) => docRef(`${path}/${id}`) };
}
const db = {
	collection: (name: string) => collectionRef(name),
	doc: (path: string) => docRef(path),
	batch: () => {
		const ops: (() => Promise<void>)[] = [];
		return {
			set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>, opts?: { merge?: boolean }) => ops.push(() => ref.set(data, opts)),
			commit: async () => { for (const op of ops) await op(); }
		};
	}
};

vi.mock('$env/dynamic/private', () => ({ env: { SLACK_BOT_TOKEN: 'tok', SLACK_FEEDING_CHANNEL_ID: 'C' } }));
vi.mock('$lib/firebase/admin', () => ({ getAdminDb: () => db }));

// Slack: a fixed set of messages, posted on 20 Sept 2026 (Mountain time).
const at = (h: number) => String(new Date(`2026-09-20T${String(h).padStart(2, '0')}:00:00-06:00`).getTime() / 1000);
let slackMessages: { ts: string; text: string; user: string }[] = [];
vi.mock('$lib/server/slackClient', () => ({
	channelHistory: async () => ({ messages: slackMessages, truncated: false, threadsSkipped: 0 }),
	resolveAuthors: async () => ({ u: 'Katie' })
}));

const { backfillDogStaff } = await import('./slackStaffBackfill');

const dog = (id: string, name: string, extra: Record<string, unknown> = {}) =>
	store.set(`dogs/${id}`, { name, status: 'active', intakeDate: '2026-01-01T12:00:00Z', ...extra });

beforeEach(() => {
	store.clear();
	dog('dior', 'Dior');
	dog('rex', 'Rex');
	dog('dot', 'Dot');
	slackMessages = [
		{ ts: at(10), text: 'Gave Dior a bath', user: 'u' },
		{ ts: at(11), text: 'Rex got yard time', user: 'u' },
		{ ts: at(8), text: "Rex didn't eat, everyone else ate", user: 'u' }
	];
});

describe('backfillDogStaff', () => {
	it('finds each kind on a dry run and writes nothing', async () => {
		const r = await backfillDogStaff(new Date('2026-09-01'), true, ['surgery', 'bath', 'yard', 'feeding']);
		expect(r.rows.map((x) => x.kind).sort()).toEqual(['bath', 'feeding', 'yard']);
		expect([...store.keys()].some((k) => k.includes('Logs/'))).toBe(false);
	});

	it('writes only the ticked rows, the way the live poll does', async () => {
		const dry = await backfillDogStaff(new Date('2026-09-01'), true, ['bath', 'yard', 'feeding']);
		const bath = dry.rows.find((x) => x.kind === 'bath')!;
		await backfillDogStaff(new Date('2026-09-01'), false, ['bath', 'yard', 'feeding'], [bath.key]);
		expect([...store.keys()].filter((k) => k.includes('/bathLogs/'))).toHaveLength(1);
		expect([...store.keys()].some((k) => k.includes('/yardLogs/') || k.includes('/feedingLogs/'))).toBe(false);
		expect(store.get('dogs/dior')?.lastBathDate).toBeTruthy();
	});

	it('skips what is already logged on a second run', async () => {
		const dry = await backfillDogStaff(new Date('2026-09-01'), true, ['bath', 'yard', 'feeding']);
		await backfillDogStaff(new Date('2026-09-01'), false, ['bath', 'yard', 'feeding'], dry.rows.map((x) => x.key));
		const again = await backfillDogStaff(new Date('2026-09-01'), true, ['bath', 'yard', 'feeding']);
		expect(again.rows).toEqual([]);
		expect(again.alreadyLogged).toMatchObject({ bath: 1, yard: 1, feeding: 1 });
	});

	it('only runs the kinds asked for', async () => {
		const r = await backfillDogStaff(new Date('2026-09-01'), true, ['yard']);
		expect(r.rows.map((x) => x.kind)).toEqual(['yard']);
	});
});
