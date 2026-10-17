import { describe, it, expect } from 'vitest';
import { parseOneOnOneMessage } from './parseOneOnOneMessage';

const ROSTER = ['Miles', 'Rex', 'Luna', 'Sheba', 'Dot (Freya)', 'Natalie'];
const parse = (t: string) => parseOneOnOneMessage(t, ROSTER);

describe('parseOneOnOneMessage', () => {
	it('reads "spent time with"', () => {
		expect(parse('spent time with Miles').dogNames).toEqual(['Miles']);
		expect(parse('I spent some time with Rex and Luna today').dogNames).toEqual(['Rex', 'Luna']);
		expect(parse('Spent some quality time with freya this morning').dogNames).toEqual(['Dot (Freya)']);
		expect(parse('spent the afternoon with Sheba').dogNames).toEqual(['Sheba']);
	});

	it('reads a duration', () => {
		expect(parse('spent 20 min with Miles').durationMinutes).toBe(20);
		expect(parse('spent an hour with Rex').durationMinutes).toBe(60);
		expect(parse('spent time with Luna for 15 minutes').durationMinutes).toBe(15);
		expect(parse('spent time with Luna').durationMinutes).toBeNull();
	});

	it('stops at the end of the sentence', () => {
		expect(parse('spent time with Miles. Rex was barking all day').dogNames).toEqual(['Miles']);
		expect(parse('Rex was barking all day. Spent time with Luna').dogNames).toEqual(['Luna']);
	});

	it('tolerates a misspelled name', () => {
		expect(parse('spent time with natilie').dogNames).toEqual(['Natalie']);
	});

	it('ignores asks, negations and other tenses', () => {
		expect(parse('can someone spend time with Miles').dogNames).toEqual([]);
		expect(parse('Has anyone spent time with Rex?').dogNames).toEqual([]);
		expect(parse("nobody has spent time with Luna").dogNames).toEqual([]);
		expect(parse("I haven't spent time with Sheba yet").dogNames).toEqual([]);
		expect(parse('Rex needs someone who has spent time with him').dogNames).toEqual([]);
		expect(parse("I'll spend time with Miles tomorrow").dogNames).toEqual([]);
	});

	it('needs a dog after "with"', () => {
		expect(parse('spent time with the new volunteers').dogNames).toEqual([]);
		expect(parse('spent all morning with Sarah cleaning kennels').dogNames).toEqual([]);
	});
});
