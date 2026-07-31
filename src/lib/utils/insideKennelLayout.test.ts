import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import {
	assignableInsideKennels,
	checkInsidePlacement,
	compareByInsidePosition,
	getDogInsideKennel,
	getFleaBufferKeys,
	getInsideAssignments,
	getInsideKennelLabel,
	getRowNeighborKeys,
	insideCellByKey,
	insideKennelCells
} from './insideKennelLayout';

function dogIn(assignment: string, overrides: Partial<Dog> = {}): Dog {
	return {
		id: `dog-${assignment || 'none'}`,
		name: assignment || 'None',
		insideKennelAssignment: assignment,
		sickHold: false,
		...overrides
	} as Dog;
}

describe('getDogInsideKennel', () => {
	it('parses a valid kennel key and rejects unknown/empty ones', () => {
		expect(getDogInsideKennel(dogIn('1'))).toBe('1');
		expect(getDogInsideKennel(dogIn('Kennel 12'))).toBe('12');
		expect(getDogInsideKennel(dogIn(''))).toBeNull();
		expect(getDogInsideKennel(dogIn('TBD'))).toBeNull();
		// 999 isn't a real kennel in the layout.
		expect(getDogInsideKennel(dogIn('999'))).toBeNull();
	});
});

describe('layout shape', () => {
	it('has exactly one blocked cell, and blocked cells are unassignable', () => {
		const blockedCells = insideKennelCells.filter((c) => c.kind === 'blocked');
		expect(blockedCells).toHaveLength(1);
		expect(assignableInsideKennels.every((c) => c.kind !== 'blocked')).toBe(true);
		expect(assignableInsideKennels).toHaveLength(insideKennelCells.length - blockedCells.length);
	});

});

describe('flea buffers (dynamic)', () => {
	// Find a kennel that has both a left and a right same-row neighbour, so its buffers
	// are unambiguous.
	const midCell = insideKennelCells.find((c) => getRowNeighborKeys(c.key).length === 2)!;
	const neighborKeys = getRowNeighborKeys(midCell.key);

	it('returns the same-row left/right neighbours of a kennel', () => {
		expect(neighborKeys).toHaveLength(2);
		for (const key of neighborKeys) {
			const n = insideCellByKey.get(key)!;
			expect(n.row).toBe(midCell.row);
			expect(Math.abs(n.col - midCell.col)).toBe(1);
		}
	});

	it('buffers the neighbours of every dog marked with fleas', () => {
		const fleaDog = dogIn(midCell.key, { hasFleas: true });
		const buffers = getFleaBufferKeys([fleaDog]);
		expect(new Set(buffers)).toEqual(new Set(neighborKeys));
		// A dog without fleas creates no buffer.
		expect(getFleaBufferKeys([dogIn(midCell.key, { hasFleas: false })]).size).toBe(0);
	});
});

describe('checkInsidePlacement', () => {
	const blocked = insideKennelCells.find((c) => c.kind === 'blocked')!;
	const normal = insideKennelCells.find((c) => c.kind === 'normal')!;

	it('hard-blocks the Do Not Use kennel', () => {
		const result = checkInsidePlacement(blocked, new Set());
		expect(result.blocked).toBe(true);
		expect(result.warning).toBeTruthy();
	});

	it('warns (but allows) when dropping into a flea-buffer kennel', () => {
		const result = checkInsidePlacement(normal, new Set([normal.key]));
		expect(result.blocked).toBe(false);
		expect(result.warning).toBeTruthy();
	});

	it('allows a normal kennel with no warning when it is not a buffer', () => {
		expect(checkInsidePlacement(normal, new Set())).toEqual({ blocked: false, warning: null });
	});
});

describe('getInsideAssignments + labels', () => {
	it('groups dogs by kennel and labels assigned/unassigned', () => {
		const a = dogIn('1', { name: 'Bravo' });
		const b = dogIn('1', { name: 'Alpha' });
		const c = dogIn('', { name: 'Charlie' });
		const map = getInsideAssignments([a, b, c]);
		expect(map['1'].map((d) => d.name)).toEqual(['Alpha', 'Bravo']); // sorted by name
		expect(map['']).toBeUndefined();
		expect(getInsideKennelLabel(a)).toBe('Kennel 1');
		expect(getInsideKennelLabel(c)).toBe('Unassigned');
	});
});

describe('compareByInsidePosition', () => {
	it('orders by physical position with unassigned dogs last', () => {
		const topLeft = insideKennelCells.find((c) => c.row === 1 && c.col === 1)!;
		const bottom = insideKennelCells.find((c) => c.row === 3)!;
		const first = dogIn(topLeft.key, { name: 'First' });
		const later = dogIn(bottom.key, { name: 'Later' });
		const none = dogIn('', { name: 'Unassigned' });
		const sorted = [none, later, first].sort(compareByInsidePosition);
		expect(sorted.map((d) => d.name)).toEqual(['First', 'Later', 'Unassigned']);
	});
});

describe('insideCellByKey', () => {
	it('indexes every cell by its key', () => {
		expect(insideCellByKey.size).toBe(insideKennelCells.length);
		for (const cell of insideKennelCells) {
			expect(insideCellByKey.get(cell.key)).toBe(cell);
		}
	});
});
