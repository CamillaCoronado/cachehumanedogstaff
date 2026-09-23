import type { SyncChange } from '$lib/data/asm-sync';

/** Several syncs' changes as one list: one line per dog, its updates combined. */
export function mergeChanges(entries: { changes: SyncChange[] }[]): SyncChange[] {
	const byId = new Map<string, SyncChange>();
	for (const { changes } of entries) {
		for (const c of changes) {
			const prev = byId.get(c.id);
			byId.set(
				c.id,
				prev
					? {
							...c,
							isNew: prev.isNew || c.isNew,
							isArchived: prev.isArchived || c.isArchived,
							isTransferredOut: prev.isTransferredOut || c.isTransferredOut,
							isEuthanized: prev.isEuthanized || c.isEuthanized,
							fields: [...new Set([...prev.fields, ...c.fields])]
						}
					: { ...c, fields: [...c.fields] }
			);
		}
	}
	return [...byId.values()];
}
