import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import {
	compareByWalkPath,
	getAssignments,
	getDogRun,
	getRunLabel,
	getRunPosition,
	getWalkRank,
	kennelCells,
	runOptions
} from './kennelLayout';

function dogIn(assignment: string, name = assignment): Dog {
	return { id: `dog-${name}`, name, outdoorKennelAssignment: assignment } as Dog;
}

describe('getDogRun', () => {
	it('parses numeric, puppy, and rock assignments', () => {
		expect(getDogRun(dogIn('12'))).toBe(12);
		expect(getDogRun(dogIn('Run 7'))).toBe(7);
		expect(getDogRun(dogIn('Puppy Run'))).toBe('puppy');
		expect(getDogRun(dogIn('rock run'))).toBe('rock');
		expect(getDogRun(dogIn(''))).toBeNull();
		expect(getDogRun(dogIn('TBD'))).toBeNull();
	});
});

describe('getRunLabel', () => {
	it('labels runs and unassigned dogs', () => {
		expect(getRunLabel(dogIn('5'))).toBe('Run 5');
		expect(getRunLabel(dogIn('puppy'))).toBe('Puppy Run');
		expect(getRunLabel(dogIn(''))).toBe('Unassigned');
	});
});

describe('layout integrity', () => {
	it('has a cell for every run 1-15, 17-35, puppy, and rock', () => {
		const keys = new Set(kennelCells.map((c) => c.runKey));
		for (let n = 1; n <= 35; n++) {
			if (n === 16) continue;
			expect(keys.has(String(n)), `run ${n}`).toBe(true);
		}
		expect(keys.has('puppy')).toBe(true);
		expect(keys.has('rock')).toBe(true);
	});

	it('exposes sorted numeric runOptions plus specials', () => {
		expect(runOptions[0]).toBe(1);
		expect(runOptions.slice(-2)).toEqual(['puppy', 'rock']);
	});

	it('positions known runs and returns null for unknown', () => {
		expect(getRunPosition(1)).toEqual({ row: 1, col: 1 });
		expect(getRunPosition(16)).toBeNull();
		expect(getRunPosition(null)).toBeNull();
	});
});

describe('getWalkRank / compareByWalkPath', () => {
	it('front_to_back walks top row first', () => {
		expect(getWalkRank(1, 'front_to_back')).toBeLessThan(getWalkRank(25, 'front_to_back'));
		expect(getWalkRank(1, 'front_to_back')).toBeLessThan(getWalkRank(2, 'front_to_back'));
	});

	it('back_to_front reverses the order', () => {
		expect(getWalkRank(25, 'back_to_front')).toBeLessThan(getWalkRank(1, 'back_to_front'));
	});

	it('snake_route alternates direction per row', () => {
		// Row 1 left-to-right: run 1 before run 15
		expect(getWalkRank(1, 'snake_route')).toBeLessThan(getWalkRank(15, 'snake_route'));
		// Next visited row right-to-left: higher col comes first
		expect(getWalkRank(35, 'snake_route')).toBeGreaterThan(getWalkRank(15, 'snake_route'));
	});

	it('ranks unassigned dogs last and ties break by name', () => {
		expect(getWalkRank(null, 'snake_route')).toBe(10_000);
		const a = dogIn('3', 'Abby');
		const b = dogIn('3', 'Zeke');
		expect(compareByWalkPath(a, b, 'snake_route')).toBeLessThan(0);
	});
});

describe('getAssignments', () => {
	it('groups dogs by run key and sorts by name', () => {
		const map = getAssignments([dogIn('3', 'Zeke'), dogIn('3', 'Abby'), dogIn('puppy', 'Pip'), dogIn('', 'Lost')]);
		expect(map['3'].map((d) => d.name)).toEqual(['Abby', 'Zeke']);
		expect(map['puppy']).toHaveLength(1);
		expect(Object.keys(map)).toHaveLength(2);
	});
});
