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

	it('only reads "morning", because that is the one meal staff name', () => {
		// Which feed it is is normally obvious from when it was posted, so nobody says.
		// A morning feed reported late says "morning" precisely because it no longer is.
		expect(parse("Only dog that didn't eat this morning was as Buck.").mealTime).toBe('am');
		expect(parse('Reina did not eat breakfast.').mealTime).toBe('am');
		expect(parse("Stony and Fred didn't eat").mealTime).toBeNull();
	});

	it('does not treat evening narration as a meal designation', () => {
		// These turn up constantly as ordinary prose, not as a label for which feed.
		expect(parse("Finn has liquidy poop so he is to have a bland diet tonight").mealTime).toBeNull();
		expect(parse("Buck didn't eat, clinic will see him this evening").mealTime).toBeNull();
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

	it('does not read every "didn\'t" as a refusal to eat', () => {
		// Real message. The bare fallback used to fire on any "didn't", turning a note
		// about water into a feeding record.
		expect(parse("Also yesterday Buck didn't drink water outside at all").entries).toEqual([]);
		expect(parse("Duke was very defensive this morning and we didn't handle him").entries).toEqual([]);
	});

	it('still reads a trailing bare "didnt"', () => {
		const result = parse('River uno ate half Tasha thor Linda doug didnt');
		expect(result.entries.find((e) => e.name === 'Doug')?.amountEaten).toBe('none');
	});

	it('recognises the second meal as its own slot', () => {
		// Real message. Filed as morning it contradicts whatever the AM report already said.
		expect(parse('Cookie vomitted a lot and ate a little of second meal').mealTime).toBe('second');
		expect(parse('Buck ate half of his 2nd meal').mealTime).toBe('second');
	});

	it('recovers a misspelled name', () => {
		// Real message: "Dexter stragler Zane ... didn't eat" silently lost Straggler.
		const result = parseFeedingMessage(
			"Dexter stragler Zane didn't eat",
			['Dexter', 'Straggler', 'Zane']
		);
		expect(result.entries.map((e) => e.name)).toEqual(['Dexter', 'Straggler', 'Zane']);
	});

	it('will not guess between two equally close names', () => {
		// "arley" is one insertion from both Marley and Harley; picking either is a coin flip.
		expect(parseFeedingMessage("arley didn't eat", ['Marley', 'Harley']).entries).toEqual([]);
	});

	it('does not fuzzy-match ordinary words onto dog names', () => {
		expect(parseFeedingMessage("hasn't eaten", ['Eaton']).entries).toEqual([]);
		expect(parseFeedingMessage("didn't drink water.", ['Walter']).entries).toEqual([]);
		// Too short to risk: one edit covers too much ground on a four-letter word.
		expect(parseFeedingMessage("Bear didn't eat", ['Bean']).entries).toEqual([]);
	});

	// Every case below came back from a real review of the import.
	describe('faults found in review', () => {
		it('never lets an alias outrank a real dog of that name', () => {
			// "Dot (Freya)" yields Freya as a guess; the shelter also has a dog called
			// Freya, and her meals were being filed onto Dot.
			const result = parseFeedingMessage(
				"Myla and Freya didn't eat",
				['Dot (Freya)', 'Freya', 'Myla']
			);
			expect(result.entries.map((e) => e.name)).toEqual(['Myla', 'Freya']);
		});

		it('still resolves a parenthetical alias when no real dog claims it', () => {
			expect(parseFeedingMessage("Newsie didn't eat", ['Nova (Newsie)']).entries)
				.toEqual([{ name: 'Nova (Newsie)', amountEaten: 'none' }]);
		});

		it('reads initials', () => {
			// "MJ" for Mary Jane, written that way about as often as not.
			expect(parseFeedingMessage("Dot, Zane, and MJ didn't eat", ['Dot', 'Zane', 'Mary Jane']).entries)
				.toContainEqual({ name: 'Mary Jane', amountEaten: 'none' });
		});

		it('splits names joined by a slash', () => {
			const result = parseFeedingMessage('Ate half: Dudley/Malone, Phantom', ['Dudley', 'Malone', 'Phantom']);
			expect(result.entries.map((e) => e.name)).toEqual(['Dudley', 'Malone', 'Phantom']);
		});

		it('reads a quarter as little, not as everything', () => {
			expect(parseFeedingMessage('Gwen and Frida ate about 1/4', ['Gwen', 'Frida']).entries[0].amountEaten).toBe('little');
			expect(parseFeedingMessage('Frida ate a quarter', ['Frida']).entries[0].amountEaten).toBe('little');
		});

		it('counts spilled food as barely eaten', () => {
			expect(parseFeedingMessage('Roe spilled most of his food', ['Roe']).entries)
				.toEqual([{ name: 'Roe', amountEaten: 'little' }]);
		});

		it('does not log a chewed toy as a meal', () => {
			expect(parseFeedingMessage('Hard toys for stowaway she ate most of rubber bone', ['Stowaway']).entries)
				.toEqual([]);
		});

		it('does not treat a refused second meal as a second meal report', () => {
			// "won't do second meal" is a plan, and the report itself is the afternoon feed.
			const result = parseFeedingMessage(
				"Ate some: Rea, Shorty Straggler didn't eat so I left his bowl with him and won't do second meal",
				['Rea', 'Shorty', 'Straggler']
			);
			expect(result.mealTime).toBeNull();
		});

		it('gives the trailing name to the verb that follows the colon list', () => {
			const result = parseFeedingMessage(
				"Ate some: Rea, Shorty Straggler didn't eat",
				['Rea', 'Shorty', 'Straggler']
			);
			expect(result.entries).toEqual([
				{ name: 'Rea', amountEaten: 'little' },
				{ name: 'Shorty', amountEaten: 'little' },
				{ name: 'Straggler', amountEaten: 'none' }
			]);
		});

		it('does not read a possessive noun as a dog', () => {
			// "his Ace" is his food; Ace only reaches the roster as an alias of another dog.
			expect(parseFeedingMessage('Roe spilled most of his Ace', ['Roe', 'Ace is the Place']).entries)
				.toEqual([{ name: 'Roe', amountEaten: 'little' }]);
			// Real message: the line break puts the possessive in a different fragment.
			expect(
				parseFeedingMessage(
					'Roe spilled most of his\n\nAce and Zane ate half',
					['Roe', 'Ace is the Place', 'Zane']
				).entries
			).toEqual([
				{ name: 'Roe', amountEaten: 'little' },
				{ name: 'Zane', amountEaten: 'half' }
			]);
			// A dog genuinely called Ace is still found.
			expect(parseFeedingMessage("Ace didn't eat", ['Ace']).entries)
				.toEqual([{ name: 'Ace', amountEaten: 'none' }]);
		});

		it('fuzzy-matches only real names, never derived aliases', () => {
			// "Freda" ties between Frida and Dot (Freya)'s alias unless aliases are excluded.
			expect(parseFeedingMessage("Freda didn't eat", ['Frida', 'Dot (Freya)', 'Fred']).entries)
				.toEqual([{ name: 'Frida', amountEaten: 'none' }]);
		});

		it('reads "eat" for "ate" when an amount follows', () => {
			// Real message, and the plainest statement of how staff report: exceptions
			// first, then everyone else accounted for in one phrase.
			const result = parseFeedingMessage(
				"Roe, Dot,Zane,Myla didn't eat there food. Pickles, Ace, eat half of there food all the other eat all of ther food.",
				['Roe', 'Dot (Freya)', 'Zane', 'Myla', 'Pickles', 'Ace is the Place']
			);
			expect(result.entries).toEqual([
				{ name: 'Roe', amountEaten: 'none' },
				{ name: 'Dot (Freya)', amountEaten: 'none' },
				{ name: 'Zane', amountEaten: 'none' },
				{ name: 'Myla', amountEaten: 'none' },
				{ name: 'Pickles', amountEaten: 'half' },
				{ name: 'Ace is the Place', amountEaten: 'half' }
			]);
			expect(result.allAte).toBe(true);
		});

		it('does not read a bare "eat" as a meal', () => {
			// "eat" only counts with an amount after it; on its own it is ordinary prose.
			expect(parseFeedingMessage('I got Duke to eat and approach me with wet food', ['Duke']).entries).toEqual([]);
			expect(parseFeedingMessage('Sammy is eating her poop so pick up as soon as she goes', ['Sammy']).entries).toEqual([]);
		});

		it('treats a bare "everyone ate" as a complete report', () => {
			// It names nobody because it does not need to. Requiring a named dog dropped
			// the one message that accounts for the whole shelter at once.
			expect(parse('Everyone ate!').looksLikeReport).toBe(true);
			expect(parse('All dogs ate').looksLikeReport).toBe(true);
		});

		it('does not treat a passing remark as the shift report', () => {
			// One dog mentioned in prose says nothing about the other eighty.
			expect(parse("Bodhi didn't eat much, but he did have a solid poop").looksLikeReport).toBe(false);
			expect(parse('Kennels look great today').looksLikeReport).toBe(false);
		});

		it('recognises the round-up forms', () => {
			expect(parse("Buck, Hulk, Cora didn't eat").looksLikeReport).toBe(true);
			expect(parse("Didn't eat: Buck, Cora").looksLikeReport).toBe(true);
			expect(parse("Buck didn't eat, everyone else did").looksLikeReport).toBe(true);
		});

		it('does not match an amount inside a longer word', () => {
			// "demonstr-ate some" was read as "ate some" and logged Caira as having eaten.
			expect(
				parseFeedingMessage(
					"Caira decided to demonstrate some resource guarding last night",
					['Caira']
				).entries
			).toEqual([]);
			expect(parseFeedingMessage("Seperate Malone and Steven's when eating", ['Malone']).entries).toEqual([]);
			// The real verb still matches.
			expect(parseFeedingMessage('Buck ate some', ['Buck']).entries).toEqual([
				{ name: 'Buck', amountEaten: 'little' }
			]);
		});

		it('recovers a name two edits out when it is long enough', () => {
			expect(parseFeedingMessage("scrunchy didn't eat", ['Scrunchie']).entries)
				.toEqual([{ name: 'Scrunchie', amountEaten: 'none' }]);
		});
	});

	it('returns nothing useful without a roster', () => {
		// Names here are overwhelmingly lowercase, so there is no safe way to spot them
		// without knowing the dogs. Better empty than invented.
		expect(parseFeedingMessage("buck and cookie didn't eat").entries).toEqual([]);
	});
});
