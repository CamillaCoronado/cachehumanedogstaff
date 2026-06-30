import type { Dog } from '$lib/types';

// Shared kennel map layout used by the feeding and kennels pages.
// Cell positions mirror the physical shelter: runs 1-15 along the top,
// 35 on the bridge, the rock banks (17-24) in the middle, 25-34 at the
// bottom, plus the special puppy/rock runs.

export type RunId = number | 'puppy' | 'rock';
export type WalkPathId = 'back_to_front' | 'front_to_back' | 'snake_route' | 'snake_route_reverse';

export type KennelCell = {
	id: string;
	runId: RunId | null;
	runKey?: string;
	label: string;
	row: number;
	col: number;
	colSpan?: number;
	isSpecial?: boolean;
	mobileCol: number;
	mobileRow: number;
	mobileRowSpan?: number;
};

export const MAX_DOGS_PER_RUN = 2;

export const routeOptions: Array<{ id: WalkPathId; label: string }> = [
	{ id: 'back_to_front', label: 'Back to Front' },
	{ id: 'front_to_back', label: 'Front to Back' },
	{ id: 'snake_route', label: 'Snake Route' },
	{ id: 'snake_route_reverse', label: 'Snake Route (Reversed)' }
];

function makeRunCells(start: number, count: number, row: number, colStart: number) {
	return Array.from({ length: count }, (_, index) => ({
		id: `run-${start + index}`,
		runId: start + index,
		runKey: String(start + index),
		label: String(start + index),
		row,
		col: colStart + index
	}));
}

const topRow = makeRunCells(1, 15, 1, 1);
const bridgeRun = {
	id: 'run-35',
	runId: 35,
	runKey: '35',
	label: '35',
	row: 2,
	col: 1
};
const rockLeft = [
	{ id: 'run-17', runId: 17, runKey: '17', label: '17', row: 4, col: 1 },
	{ id: 'run-18', runId: 18, runKey: '18', label: '18', row: 4, col: 2 },
	{ id: 'run-19', runId: 19, runKey: '19', label: '19', row: 4, col: 3, colSpan: 2 },
	{ id: 'run-20', runId: 20, runKey: '20', label: '20', row: 4, col: 5, colSpan: 2 }
];
const rockRight = [
	{ id: 'run-21', runId: 21, runKey: '21', label: '21', row: 4, col: 8, colSpan: 2 },
	{ id: 'run-22', runId: 22, runKey: '22', label: '22', row: 4, col: 10, colSpan: 2 },
	{ id: 'run-23', runId: 23, runKey: '23', label: '23', row: 4, col: 12, colSpan: 2 },
	{ id: 'run-24', runId: 24, runKey: '24', label: '24', row: 4, col: 14, colSpan: 2 }
];
const bottomLeft = makeRunCells(25, 6, 6, 1);
const bottomRight = [
	{ id: 'run-31', runId: 31, runKey: '31', label: '31', row: 6, col: 8, colSpan: 2 },
	{ id: 'run-32', runId: 32, runKey: '32', label: '32', row: 6, col: 10, colSpan: 2 },
	{ id: 'run-33', runId: 33, runKey: '33', label: '33', row: 6, col: 12, colSpan: 2 },
	{ id: 'run-34', runId: 34, runKey: '34', label: '34', row: 6, col: 14, colSpan: 2 }
];

const specialCells = [
	{
		id: 'puppy-run',
		runId: 'puppy' as const,
		runKey: 'puppy',
		label: 'Puppy Run',
		row: 1,
		col: 16,
		colSpan: 2,
		isSpecial: true
	},
	{
		id: 'rock-run',
		runId: 'rock' as const,
		runKey: 'rock',
		label: 'Rock Run',
		row: 2,
		col: 16,
		colSpan: 2,
		isSpecial: true
	}
];

const mobilePlacement = new Map<string, { col: number; row: number; rowSpan?: number }>();

function assignMobileColumn(
	runIds: RunId[],
	col: number,
	startRow: number,
	rowSpans: Record<string, number>,
	gapAfter?: RunId
) {
	let row = startRow;
	for (const runId of runIds) {
		const key = typeof runId === 'number' ? String(runId) : runId;
		const span = rowSpans[key] ?? 1;
		mobilePlacement.set(key, { col, row, rowSpan: span });
		row += span;
		if (gapAfter && runId === gapAfter) {
			row += 1;
		}
	}
}

// Match desktop layout on mobile by transposing into four columns,
// keeping the 1-15 line on the right side.
topRow.forEach((cell, index) => {
	mobilePlacement.set(cell.runKey ?? String(cell.runId), { col: 4, row: index + 1 });
});
mobilePlacement.set('35', { col: 3, row: 1 });
mobilePlacement.set('puppy', { col: 4, row: topRow.length + 1 });
mobilePlacement.set('rock', { col: 3, row: topRow.length + 1 });

assignMobileColumn(
	[17, 18, 19, 20, 21, 22, 23, 24],
	2,
	1,
	{ '19': 2, '20': 2, '21': 2, '22': 2, '23': 2, '24': 2 },
	20
);

// Shift only the 21-24 bank down for visual alignment on mobile.
for (const key of ['21', '22', '23', '24']) {
	const placement = mobilePlacement.get(key);
	if (!placement) continue;
	mobilePlacement.set(key, { ...placement, row: placement.row + 1 });
}

assignMobileColumn([25, 26, 27, 28, 29, 30, 31, 32, 33, 34], 1, 1, { '31': 2, '32': 2, '33': 2, '34': 2 }, 30);

// Slight downward offset keeps the 31-34 bank visually aligned on mobile.
for (const key of ['31', '32', '33', '34']) {
	const placement = mobilePlacement.get(key);
	if (!placement) continue;
	mobilePlacement.set(key, { ...placement, row: placement.row + 1 });
}

export const kennelCells: KennelCell[] = [
	...topRow,
	bridgeRun,
	...rockLeft,
	...rockRight,
	...bottomLeft,
	...bottomRight,
	...specialCells
].map((cell) => {
	const key = cell.runKey ?? String(cell.runId ?? '');
	const placement = mobilePlacement.get(key);
	return {
		...cell,
		mobileCol: placement?.col ?? 4,
		mobileRow: placement?.row ?? 1,
		mobileRowSpan: placement?.rowSpan ?? 1
	};
});

export const mobileRows = Math.max(
	...kennelCells.map((cell) => cell.mobileRow + (cell.mobileRowSpan ?? 1) - 1)
);

export const runOptions: RunId[] = [
	...Array.from(
		new Set(
			kennelCells
				.filter((cell) => cell.runId !== null && typeof cell.runId === 'number')
				.map((cell) => cell.runId as number)
		)
	).sort((a, b) => a - b),
	'puppy',
	'rock'
];

export function getDogRun(dog: Dog): RunId | null {
	const raw = dog.outdoorKennelAssignment?.toString().trim() ?? '';
	if (!raw) return null;
	const lower = raw.toLowerCase();
	if (lower.includes('puppy')) return 'puppy';
	if (lower.includes('rock')) return 'rock';
	const match = raw.match(/\d+/);
	if (!match) return null;
	const parsed = Number(match[0]);
	return Number.isFinite(parsed) ? parsed : null;
}

export function getRunLabel(dog: Dog) {
	const run = getDogRun(dog);
	if (!run) return 'Unassigned';
	if (run === 'puppy') return 'Puppy Run';
	if (run === 'rock') return 'Rock Run';
	return `Run ${run}`;
}

export function runIdToKey(run: RunId): string;
export function runIdToKey(run: RunId | null): string | null;
export function runIdToKey(run: RunId | null) {
	if (!run) return null;
	return typeof run === 'number' ? String(run) : run;
}

export function runIdToLabel(runId: RunId) {
	if (runId === 'puppy') return 'Puppy Run';
	if (runId === 'rock') return 'Rock Run';
	return String(runId);
}

export function runIdToAssignment(runId: RunId | null) {
	if (!runId) return '';
	return runIdToLabel(runId);
}

export function runIdToSelectValue(runId: RunId | null) {
	if (!runId) return '';
	return typeof runId === 'number' ? String(runId) : runId;
}

export function getRunPosition(run: RunId | null) {
	const key = runIdToKey(run);
	if (!key) return null;
	const cell = kennelCells.find((item) => item.runKey === key && item.runId !== null);
	if (!cell) return null;
	return { row: cell.row, col: cell.col };
}

// Physical feeding walk order, confirmed with staff (2026-06-17):
// Puppy Run first (top-right corner, where you enter), then down the top wall right→left
// (15→1), down to 35, across the left island (17–20), across the right island (21–24),
// then the bottom row right→left (34→25). Rock Run never holds dogs, so it sorts last —
// it only matters if something is accidentally assigned there.
const SNAKE_ROUTE_ORDER: string[] = [
	'puppy',
	'15', '14', '13', '12', '11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1',
	'35',
	'17', '18', '19', '20',
	'21', '22', '23', '24',
	'34', '33', '32', '31', '30', '29', '28', '27', '26', '25',
	'rock'
];
const snakeRankByKey = new Map(SNAKE_ROUTE_ORDER.map((key, index) => [key, index]));

export function getWalkRank(run: RunId | null, path: WalkPathId) {
	if (path === 'snake_route' || path === 'snake_route_reverse') {
		const rank = snakeRankByKey.get(runIdToKey(run) ?? '');
		if (rank === undefined) return 10_000;
		return path === 'snake_route' ? rank : SNAKE_ROUTE_ORDER.length - 1 - rank;
	}

	const position = getRunPosition(run);
	if (!position) return 10_000;

	const allRows = Array.from(
		new Set(kennelCells.filter((cell) => cell.runId !== null).map((cell) => cell.row))
	).sort((a, b) => a - b);
	const maxRow = Math.max(...allRows);
	const maxCol = Math.max(...kennelCells.filter((cell) => cell.runId !== null).map((cell) => cell.col));

	if (path === 'front_to_back') {
		return position.row * 100 + position.col;
	}

	// back_to_front
	return (maxRow - position.row) * 100 + (maxCol - position.col);
}

export function compareByWalkPath(a: Dog, b: Dog, path: WalkPathId) {
	const rankDiff = getWalkRank(getDogRun(a), path) - getWalkRank(getDogRun(b), path);
	if (rankDiff !== 0) return rankDiff;
	return a.name.localeCompare(b.name);
}

export function getAssignments(list: Dog[]) {
	const map: Record<string, Dog[]> = {};
	for (const dog of list) {
		const run = getDogRun(dog);
		if (!run) continue;
		const key = typeof run === 'number' ? String(run) : run;
		if (!map[key]) map[key] = [];
		map[key].push(dog);
	}
	for (const key of Object.keys(map)) {
		map[key].sort((a, b) => a.name.localeCompare(b.name));
	}
	return map;
}
