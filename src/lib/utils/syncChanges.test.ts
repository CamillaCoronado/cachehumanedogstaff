import { describe, expect, it } from 'vitest';
import type { SyncChange } from '$lib/data/asm-sync';
import { mergeChanges } from './syncChanges';

const change = (id: string, o: Partial<SyncChange> = {}): SyncChange => ({
	id, name: id, isNew: false, isArchived: false, isTransferredOut: false, isEuthanized: false, fields: [], ...o
});

describe('mergeChanges', () => {
	it('lists each dog once across several syncs, combining what changed', () => {
		const merged = mergeChanges([
			{ changes: [change('rex', { fields: ['Weight'] }), change('dot', { isNew: true })] },
			{ changes: [change('rex', { fields: ['Weight', 'Kennel'] })] }
		]);
		expect(merged).toHaveLength(2);
		expect(merged.find((c) => c.id === 'rex')?.fields).toEqual(['Weight', 'Kennel']);
		expect(merged.find((c) => c.id === 'dot')?.isNew).toBe(true);
	});

	it('keeps a departure once any sync saw it', () => {
		const merged = mergeChanges([{ changes: [change('old', { isEuthanized: true })] }, { changes: [change('old')] }]);
		expect(merged[0].isEuthanized).toBe(true);
	});
});
