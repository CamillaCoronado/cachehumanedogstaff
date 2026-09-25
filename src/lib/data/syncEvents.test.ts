import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/firebase/config', () => ({ db: null }));

import type { SyncChange } from '$lib/data/asm-sync';
import { syncEventDocs } from './syncEvents';

const change = (id: string, fields: string[]): SyncChange =>
	({ id, name: id, fields, isNew: false, isArchived: false, isTransferredOut: false }) as unknown as SyncChange;

describe('syncEventDocs', () => {
	it('gives a dog going to permanent foster its own event, not the plain foster one', () => {
		const docs = syncEventDocs(
			[change('arcanine', ['Foster (yes)', 'Permanent foster (yes)']), change('rex', ['Foster (yes)'])],
			new Date('2026-09-25T12:00:00Z')
		);
		const byType = Object.fromEntries(docs.map((d) => [d.data.type, d.data.dogIds]));
		expect(byType.permanentFoster).toEqual(['arcanine']);
		expect(byType.foster).toEqual(['rex']);
	});
});
