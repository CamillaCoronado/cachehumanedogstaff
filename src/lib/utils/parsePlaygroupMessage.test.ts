import { describe, expect, it } from 'vitest';
import { parsePlaygroupMessage } from './parsePlaygroupMessage';

describe('parsePlaygroupMessage', () => {
	it('parses simple in/out entries', () => {
		const result = parsePlaygroupMessage('Birdie in, Rosie in, Dexter in');
		expect(result.dogNames).toEqual(['Birdie', 'Rosie', 'Dexter']);
	});

	it('attaches colon notes to the entry', () => {
		const result = parsePlaygroupMessage('Birdie out: she was great');
		expect(result.notes).toContain('Birdie: she was great');
	});

	it('captures a genuine multi-word dog name', () => {
		const result = parsePlaygroupMessage('Chunky Monkey in');
		expect(result.dogNames).toEqual(['Chunky Monkey']);
	});

	it('never captures a name longer than 3 words, roster or not', () => {
		// The word cap alone blocks long sentences even without a roster to check
		// against — "the whole yard time is out" has 5 words before "out".
		const result = parsePlaygroupMessage('the whole yard time is out');
		expect(result.dogNames).toEqual([]);
	});

	it('rejects single-word filler that looks like an action, not a name', () => {
		const result = parsePlaygroupMessage('back in');
		expect(result.dogNames).toEqual([]);
	});

	it('rejects a filler phrase even without a roster to check against', () => {
		const result = parsePlaygroupMessage('everyone is out');
		expect(result.dogNames).toEqual([]);
	});

	it('rejects incident vocabulary from being parsed as a dog name', () => {
		const result = parsePlaygroupMessage('a fight broke out');
		expect(result.dogNames).toEqual([]);
	});

	it('rejects a plausible-looking but non-roster multi-word phrase when a roster is supplied', () => {
		// "sarah helped" contains no filler words and is only 2 words — it would
		// pass unchecked without a roster. With one supplied, it must not match
		// any real dog, so no in/out entry gets created for it. (Lowercase here
		// to isolate the entry parser from the separate capitalized-word scanner
		// below, which deliberately stays permissive to catch off-roster dogs
		// mentioned in free text.)
		const result = parsePlaygroupMessage('sarah helped out', ['Birdie', 'Rosie', 'Dexter']);
		expect(result.entries).toEqual([]);
		expect(result.dogNames).toEqual([]);
	});

	it('still accepts a real multi-word dog name when a roster is supplied', () => {
		const result = parsePlaygroupMessage('Chunky Monkey in', ['Chunky Monkey', 'Birdie']);
		expect(result.dogNames).toEqual(['Chunky Monkey']);
	});

	it('accepts single-word names even when off-roster (foster/visiting dog)', () => {
		const result = parsePlaygroupMessage('Buddy in', ['Birdie', 'Rosie']);
		expect(result.dogNames).toEqual(['Buddy']);
	});

	it('infers outcome from incident/mixed keywords', () => {
		expect(parsePlaygroupMessage('Birdie in, Rosie in, scuffle broke out').outcome).toBe('incident');
		expect(parsePlaygroupMessage('Birdie in, Rosie in, seemed nervous today').outcome).toBe('mixed');
		expect(parsePlaygroupMessage('Birdie in, Rosie in, great session').outcome).toBe('successful');
	});

	it('does not mistake "a bit nervous" (a little) for a bite incident', () => {
		expect(parsePlaygroupMessage('Birdie in, Rosie in, a bit nervous today').outcome).toBe('mixed');
	});

	it('still catches "bit" as a real incident when not preceded by "a"', () => {
		expect(parsePlaygroupMessage('Birdie in, Rosie in, she bit another dog').outcome).toBe('incident');
	});
});
