import { describe, it, expect } from 'vitest';
import { parseFeedingMessage } from './parseFeedingMessage';

// Every message below is real, taken from #dog-staff Jan–Aug 2026.
const ROSTER = [
	'Buck', 'Hulk', 'Cora', 'Duke', 'Paloma', 'Raffi', 'Bonita', 'Stony', 'Stoney', 'Leo',
	'Thor', 'Letty', 'Newsie', 'Koda', 'Bella', 'Fred', 'Gus', 'Bruno', 'Eddie', 'Acey',
	'Mama', 'Plum', 'Polo', 'Finn', 'Raven', 'Bean', 'Violetta', 'Ferb', 'Cookie', 'Remi',
	'Reina', 'Sheba', 'Oggie', 'Dandelion', 'River', 'Uno', 'Tasha', 'Linda', 'Doug',
	'Frankie', 'Frito Pie', 'Drake', 'Gravy', 'Walker', 'Annie', 'Phineas', 'Perry',
	'Jasper', 'Dexter', 'Susan', 'Bodhi', 'Tasia'
];

const parse = (text: string) => parseFeedingMessage(text, ROSTER);
const amountOf = (text: string, name: string) =>
	parse(text).entries.find((e) => e.name === name)?.amountEaten;

describe('parseFeedingMessage', () => {
	it('reads a comma list before "didn\'t eat"', () => {
		const result = parse("Buck, Hulk, Cora didn't eat there food every body else did.");
		expect(result.entries).toEqual([
			{ name: 'Buck', amountEaten: 'none' },
			{ name: 'Hulk', amountEaten: 'none' },
			{ name: 'Cora', amountEaten: 'none' }
		]);
	});

	it('handles "and" before the final name', () => {
		const result = parse("Buck, Duke, Paloma, and Raffi didn't eat.");
		expect(result.entries.map((e) => e.name)).toEqual(['Buck', 'Duke', 'Paloma', 'Raffi']);
		expect(result.entries.every((e) => e.amountEaten === 'none')).toBe(true);
	});

	it('maps partial amounts', () => {
		expect(amountOf('Gus and Hulk ate a little bit', 'Gus')).toBe('little');
		expect(amountOf('Letty ate half', 'Letty')).toBe('half');
		expect(amountOf('Everyone ate most of not all of their food', 'Buck')).toBeUndefined();
		expect(amountOf('Bodhi ate most', 'Bodhi')).toBe('most');
	});

	it('separates two amounts in one sentence', () => {
		const result = parse("Stoney, Leo, buck, and Thor didn't eat, Letty ate half");
		expect(amountOf(result ? "Stoney, Leo, buck, and Thor didn't eat, Letty ate half" : '', 'Leo')).toBe('none');
		expect(result.entries.find((e) => e.name === 'Letty')?.amountEaten).toBe('half');
	});

	it('splits run-on messages with no punctuation', () => {
		// The reason the parser anchors on verbs rather than commas.
		const result = parse('River uno ate half Tasha thor Linda doug didnt');
		expect(result.entries).toEqual([
			{ name: 'River', amountEaten: 'half' },
			{ name: 'Uno', amountEaten: 'half' },
			{ name: 'Tasha', amountEaten: 'none' },
			{ name: 'Thor', amountEaten: 'none' },
			{ name: 'Linda', amountEaten: 'none' },
			{ name: 'Doug', amountEaten: 'none' }
		]);
	});

	it('treats "everyone ate" as a blanket with exceptions', () => {
		const result = parse('Yoda has been bathed, he was good! Everyone ate except Bella and Fred');
		expect(result.allAte).toBe(true);
		expect(result.entries).toEqual([
			{ name: 'Bella', amountEaten: 'none' },
			{ name: 'Fred', amountEaten: 'none' }
		]);
	});

	it('recognises a blanket with no exceptions', () => {
		expect(parse('Everyone ate!').allAte).toBe(true);
		expect(parse('All dogs ate').allAte).toBe(true);
		expect(parse('Everyone ate!').entries).toEqual([]);
	});

	it('keeps "do not feed" out of the feeding record', () => {
		// A surgery instruction about a meal that has not happened. Logging these as
		// 'none' would say the dogs refused food they were never offered.
		const result = parse('Do not feed: Letty, Newsie, Eddie, Bruno');
		expect(result.doNotFeed).toEqual(['Letty', 'Newsie', 'Eddie', 'Bruno']);
		expect(result.entries).toEqual([]);
	});

	it('handles the lowercase directive form', () => {
		expect(parse('do not feed: Acey and Mama').doNotFeed).toEqual(['Acey', 'Mama']);
	});

	it('reads a directive embedded mid-message', () => {
		const result = parse(
			'check with clinic to see if surgery is happening today. If it is, do not feed Gravy, Raven, Bean, Walker, Drake, and Uno.'
		);
		expect(result.doNotFeed).toEqual(['Gravy', 'Raven', 'Bean', 'Walker', 'Drake', 'Uno']);
		expect(result.entries).toEqual([]);
	});

	it('ignores prose that happens to sit near a dog name', () => {
		const result = parse(
			"Buck, Duke, Paloma, and Raffi didn't eat. Cora threw it all up and has nasty poop. Bruno also has bad poop."
		);
		// Cora and Bruno appear, but nothing says they refused food.
		expect(result.entries.map((e) => e.name)).toEqual(['Buck', 'Duke', 'Paloma', 'Raffi']);
	});

	it('never invents dogs that are not on the roster', () => {
		const result = parseFeedingMessage("Zephyr and Mordecai didn't eat", ROSTER);
		expect(result.entries).toEqual([]);
	});

	it('matches multi-word names without splitting them', () => {
		const result = parse('frankie, dandelion, frito pie, cora did not eat');
		expect(result.entries.map((e) => e.name)).toEqual(['Frankie', 'Dandelion', 'Frito Pie', 'Cora']);
	});

	it('reads an explicit meal time when stated, and nothing when not', () => {
		expect(parse("Only dog that didn't eat this morning was as Buck.").mealTime).toBe('am');
		expect(parse('Reina did not eat breakfast.').mealTime).toBe('am');
		expect(parse("Stony and Fred didn't eat").mealTime).toBeNull();
	});

	it('keeps the first statement about a dog when it is mentioned twice', () => {
		const result = parse("Buck didn't eat. Buck ate half later.");
		expect(result.entries.filter((e) => e.name === 'Buck')).toHaveLength(1);
		expect(result.entries[0].amountEaten).toBe('none');
	});

	it('handles the curly apostrophe phones produce', () => {
		// Real message. With a straight-quote-only pattern this parsed to nothing, which
		// is how it went missing from the backfill without any error.
		const result = parse('eddie, oggie, river, newsie, frankie, didn\u2019t eat');
		expect(result.entries.map((e) => e.name)).toEqual(['Eddie', 'Oggie', 'River', 'Newsie', 'Frankie']);
		expect(result.entries.every((e) => e.amountEaten === 'none')).toBe(true);
	});

	it('reads an adverb between the negation and the verb', () => {
		expect(amountOf("Bodhi didn't eat much, but he did have a solid poop", 'Bodhi')).toBe('little');
		expect(amountOf("Plum didn't really eat much dinner", 'Plum')).toBe('little');
		expect(amountOf('Cookie barely ate', 'Cookie')).toBe('little');
	});

	it('reads a subject stated after the verb', () => {
		// Only when the verb had no subject before it — otherwise the next sentence bleeds in.
		expect(amountOf("Only dog that didn't eat this morning was Buck.", 'Buck')).toBe('none');
	});

	it('recognises the alias forms ASM stores', () => {
		// A renamed dog is stored "Nova (Newsie)" but only ever called Newsie in chat,
		// and "Duke of Earl" is only ever Duke. Both resolve to the canonical name.
		const asmRoster = ['Nova (Newsie)', 'Duke of Earl', 'Buck'];
		const result = parseFeedingMessage("Newsie, Buck, and Duke didn't eat", asmRoster);
		expect(result.entries.map((e) => e.name)).toEqual(['Nova (Newsie)', 'Buck', 'Duke of Earl']);
	});

	it('does not let a derived alias outrank a real name', () => {
		const result = parseFeedingMessage("Duke didn't eat", ['Duke', 'Duke of Earl']);
		expect(result.entries.map((e) => e.name)).toEqual(['Duke']);
	});

	it('reads colon-led headings, where the dogs follow the verb', () => {
		// Real format. Read as subject-first this parses exactly backwards — the dogs
		// that did not eat get recorded as having eaten half.
		const result = parseFeedingMessage(
			"Didn't eat: Nala, Buck Ate half: Daffodil, Dot, Thor",
			['Nala', 'Buck', 'Daffodil', 'Dot', 'Thor']
		);
		expect(result.entries).toEqual([
			{ name: 'Nala', amountEaten: 'none' },
			{ name: 'Buck', amountEaten: 'none' },
			{ name: 'Daffodil', amountEaten: 'half' },
			{ name: 'Dot', amountEaten: 'half' },
			{ name: 'Thor', amountEaten: 'half' }
		]);
	});

	it('still reads subject-first lists when there is no colon', () => {
		const result = parseFeedingMessage(
			"Garth, Daffodil, Buck, Nala didn't eat. Tulip, Dot, Wiley ate half.",
			['Garth', 'Daffodil', 'Buck', 'Nala', 'Tulip', 'Dot', 'Wiley']
		);
		expect(result.entries).toEqual([
			{ name: 'Garth', amountEaten: 'none' },
			{ name: 'Daffodil', amountEaten: 'none' },
			{ name: 'Buck', amountEaten: 'none' },
			{ name: 'Nala', amountEaten: 'none' },
			{ name: 'Tulip', amountEaten: 'half' },
			{ name: 'Dot', amountEaten: 'half' },
			{ name: 'Wiley', amountEaten: 'half' }
		]);
	});

	it('returns nothing useful without a roster', () => {
		// Names here are overwhelmingly lowercase, so there is no safe way to spot them
		// without knowing the dogs. Better empty than invented.
		expect(parseFeedingMessage("buck and cookie didn't eat").entries).toEqual([]);
	});
});
