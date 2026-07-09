import { describe, expect, it } from 'vitest';
import type { Dog } from '$lib/types';
import { matchDogByName } from './dogs';

let nextId = 1;
function makeDog(name: string): Dog {
	return { id: `dog-${nextId++}`, name } as Dog;
}

describe('matchDogByName', () => {
	it('matches exactly, case-insensitively', () => {
		const rex = makeDog('Rex');
		expect(matchDogByName('rex', [rex, makeDog('Fido')])?.id).toBe(rex.id);
	});

	it('matches the base name against a parenthetical nickname', () => {
		const sadie = makeDog('Sadie (Jazmine)');
		expect(matchDogByName('Sadie', [sadie])?.id).toBe(sadie.id);
		expect(matchDogByName('Jazmine', [sadie])).toBeNull(); // not the base name — falls to prefix step
	});

	it('prefix-matches a nickname when it uniquely resolves', () => {
		const sadie = makeDog('Sadie (Jazmine)');
		expect(matchDogByName('Sadie Jazmine', [sadie])?.id).toBe(sadie.id);
	});

	it('does not falsely match a short name against an unrelated dog containing it', () => {
		// "Leo" is a substring of "Cleopatra" but not a prefix of it — must not match.
		const cleopatra = makeDog('Cleopatra');
		expect(matchDogByName('Leo', [cleopatra])).toBeNull();
	});

	it('refuses to guess when a prefix match is ambiguous between two dogs', () => {
		const bones = makeDog('Bones');
		const boone = makeDog('Boone');
		expect(matchDogByName('Bo', [bones, boone])).toBeNull();
	});

	it('returns null when nothing matches', () => {
		expect(matchDogByName('Nobody', [makeDog('Rex')])).toBeNull();
	});
});
