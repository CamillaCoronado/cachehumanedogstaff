import type { Dog } from '$lib/types';

// Inside (indoor) kennel map. Modeled on the outdoor kennelLayout.ts. There is no fixed
// "sick zone" / "healthy zone" partition — a kennel simply reads red or green based on
// whether the dog currently in it is on a sick hold. The grid is the physical arrangement
// of kennels plus one blocked "Do Not Use" kennel. Flea buffers are NOT fixed: they follow
// dogs marked with fleas (the kennels on either side are kept empty). Assignment is stored
// in Dog.insideKennelAssignment and parsed the same tolerant way as the outdoor field
// (first run of digits → kennel key).

export type InsideCellKind = 'normal' | 'blocked';

export type InsideKennelCell = {
	id: string;
	key: string;
	label: string;
	row: number;
	col: number;
	/** Mobile placement — the desktop grid is transposed 90° (like the outdoor map) so it
	 *  fits a portrait screen without horizontal scrolling: each row becomes a column, top
	 *  row on the right. */
	mobileCol: number;
	mobileRow: number;
	kind: InsideCellKind;
	note?: string;
};

export const INSIDE_GRID_COLUMNS = 14;
const INSIDE_GRID_ROWS = 3;

type CellSpec = {
	kind?: InsideCellKind;
	note?: string;
};

// Build a row left-to-right from compact specs. `id`/`key`/`label` are the sequential
// kennel number; the physical kennels in the photo are unlabeled, so a stable 1..N
// numbering is fine for storage + display.
function makeRow(row: number, specs: CellSpec[], startId: number): InsideKennelCell[] {
	return specs.map((spec, index) => {
		const n = startId + index;
		const col = index + 1;
		return {
			id: `inside-${n}`,
			key: String(n),
			label: String(n),
			row,
			col,
			// 90° transpose: top row (row 1) → rightmost mobile column, columns → rows.
			mobileCol: INSIDE_GRID_ROWS - row + 1,
			mobileRow: col,
			kind: spec.kind ?? 'normal',
			note: spec.note
		};
	});
}

const N: CellSpec = {};

// Row 1: the top row of (physically white) kennels — 12 normal kennels.
const row1 = makeRow(1, Array.from({ length: 12 }, () => N), 1);

// Row 2 (14): three normal kennels, the blocked "Do Not Use", then ten normal kennels.
const row2 = makeRow(
	2,
	[N, N, N, { kind: 'blocked', note: 'Do Not Use' }, N, N, N, N, N, N, N, N, N, N],
	row1.length + 1
);

// Row 3: a full row of 14 normal kennels.
const row3 = makeRow(3, Array.from({ length: 14 }, () => N), row1.length + row2.length + 1);

export const insideKennelCells: InsideKennelCell[] = [...row1, ...row2, ...row3];

// Rows needed by the transposed mobile grid (= widest desktop row).
export const INSIDE_MOBILE_ROWS = Math.max(...insideKennelCells.map((cell) => cell.mobileRow));

export const insideCellByKey = new Map(insideKennelCells.map((cell) => [cell.key, cell]));

// Kennels a dog can actually be dropped into (blocked cells are never assignable).
export const assignableInsideKennels = insideKennelCells.filter((cell) => cell.kind !== 'blocked');

/** Parse Dog.insideKennelAssignment → kennel key (first run of digits), or null. */
export function getDogInsideKennel(dog: Pick<Dog, 'insideKennelAssignment'>): string | null {
	const raw = dog.insideKennelAssignment?.toString().trim() ?? '';
	if (!raw) return null;
	const match = raw.match(/\d+/);
	if (!match) return null;
	return insideCellByKey.has(match[0]) ? match[0] : null;
}

/** The string stored in insideKennelAssignment for a kennel key (empty = unassigned). */
export function insideKeyToAssignment(key: string | null): string {
	return key ?? '';
}

export function getInsideKennelLabel(dog: Pick<Dog, 'insideKennelAssignment'>): string {
	const key = getDogInsideKennel(dog);
	return key ? `Kennel ${key}` : 'Unassigned';
}

/** Group dogs by their inside-kennel key, each list sorted by name. */
export function getInsideAssignments(dogs: Dog[]): Record<string, Dog[]> {
	const map: Record<string, Dog[]> = {};
	for (const dog of dogs) {
		const key = getDogInsideKennel(dog);
		if (!key) continue;
		(map[key] ??= []).push(dog);
	}
	for (const key of Object.keys(map)) {
		map[key].sort((a, b) => a.name.localeCompare(b.name));
	}
	return map;
}

/** Sort by physical kennel position (row, then col); unassigned dogs sort last. */
export function compareByInsidePosition(a: Dog, b: Dog): number {
	const ca = insideCellByKey.get(getDogInsideKennel(a) ?? '');
	const cb = insideCellByKey.get(getDogInsideKennel(b) ?? '');
	const ra = ca ? ca.row * 100 + ca.col : Number.MAX_SAFE_INTEGER;
	const rb = cb ? cb.row * 100 + cb.col : Number.MAX_SAFE_INTEGER;
	if (ra !== rb) return ra - rb;
	return a.name.localeCompare(b.name);
}

/** Same-row left/right neighbour kennel keys (the flea-buffer positions). */
export function getRowNeighborKeys(key: string): string[] {
	const cell = insideCellByKey.get(key);
	if (!cell) return [];
	return insideKennelCells
		.filter((c) => c.row === cell.row && Math.abs(c.col - cell.col) === 1)
		.map((c) => c.key);
}

/**
 * The set of flea-buffer kennel keys for the current placements: the kennels on either
 * side of every dog marked with fleas. Fleas can jump, so those neighbours are kept empty.
 */
export function getFleaBufferKeys(dogs: Pick<Dog, 'hasFleas' | 'insideKennelAssignment'>[]): Set<string> {
	const keys = new Set<string>();
	for (const dog of dogs) {
		if (!dog.hasFleas) continue;
		const key = getDogInsideKennel(dog);
		if (!key) continue;
		for (const neighbor of getRowNeighborKeys(key)) keys.add(neighbor);
	}
	return keys;
}

/**
 * Soft check for a proposed drop. Returns `{ blocked: true }` for a hard rejection (the
 * "Do Not Use" kennel) or a warning string when dropping into a flea-buffer kennel (one
 * beside a dog with fleas). No zone-mismatch check — color follows the dog's sick status.
 */
export function checkInsidePlacement(
	cell: InsideKennelCell,
	fleaBufferKeys: Set<string>
): { blocked: boolean; warning: string | null } {
	if (cell.kind === 'blocked') {
		return { blocked: true, warning: `Kennel ${cell.label} is marked Do Not Use.` };
	}
	if (fleaBufferKeys.has(cell.key)) {
		return { blocked: false, warning: `Kennel ${cell.label} is a flea buffer — keep it empty.` };
	}
	return { blocked: false, warning: null };
}
