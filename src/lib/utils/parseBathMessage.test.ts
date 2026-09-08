import { describe, it, expect } from 'vitest';
import { parseBathMessage } from './parseBathMessage';

// Every message below is real, from #dog-staff.
const ROSTER = [
	'Koda', 'Roscoe', 'Junior', 'Potpourri', 'Hattie', 'Dot (Freya)', 'Sally', 'Pickles',
	'Roe', 'Rainbow', 'Dream', 'Gwen', 'Mary Jane', 'Ace is the Place', 'Canyon', 'Yukon',
	'Madonna', 'Bon Jovi', 'Whoogie', 'Spaghetti', 'Meatball', 'Luna', 'Yoda'
];
const parse = (t: string) => parseBathMessage(t, ROSTER);

describe('parseBathMessage', () => {
	it('reads the plain report', () => {
		expect(parse('koda got a bath').dogNames).toEqual(['Koda']);
		expect(parse('Roe got a bath').dogNames).toEqual(['Roe']);
		expect(parse('Roscoe got a bath today').dogNames).toEqual(['Roscoe']);
	});

	it('reads several dogs at once', () => {
		expect(parse('Junior and potpourri got baths').dogNames).toEqual(['Junior', 'Potpourri']);
		expect(parse('Hattie and dot got baths').dogNames).toEqual(['Hattie', 'Dot (Freya)']);
		expect(parse('Sally pickles junior got baths').dogNames).toEqual(['Sally', 'Pickles', 'Junior']);
	});

	it('reads the passive form', () => {
		expect(parse('Madonna and Bob Jovi were bathed this morning').dogNames).toEqual(['Madonna']);
		expect(parse('Yoda has been bathed, he was good!').dogNames).toEqual(['Yoda']);
	});

	it('reads the verb-first form, where the dogs follow', () => {
		expect(parse('We gave whoogie a bath yesterday and nail trim').dogNames).toEqual(['Whoogie']);
		expect(parse('Spaghetti and meatballs I gave them fle baths again').dogNames).toContain('Spaghetti');
	});

	it('counts "yesterday" back a day', () => {
		expect(parse('We gave whoogie a bath yesterday').daysAgo).toBe(1);
		expect(parse('Roe got a bath').daysAgo).toBe(0);
	});

	it('ignores a bath that has not happened', () => {
		// These outnumber the actual reports in the channel.
		expect(parse('Ace, Canyon, and Yukon could use baths.').notYet).toBe(true);
		expect(parse('Ace, Canyon, and Yukon could use baths.').dogNames).toEqual([]);
		expect(parse('he also need to get a bath with hypoallergenic shampoo').dogNames).toEqual([]);
		expect(parse("They're coming from not great conditions and will need baths").dogNames).toEqual([]);
		expect(parse('Liz might want to have the kids bathe them so hold off on that').dogNames).toEqual([]);
	});

	it('ignores a question about a bath', () => {
		expect(parse('Did Koda or Luna get bathed when they first came in?').dogNames).toEqual([]);
		expect(parse('Did Koda or Luna get bathed when they first came in?').notYet).toBe(true);
	});

	it('does not read washing an object as a bath', () => {
		// Mentions dogs and washing, and is not a bath.
		expect(parse('I washed and refilled the adult dog food bucket').dogNames).toEqual([]);
		expect(parse('Junior make sure his bed is changed out every other day').dogNames).toEqual([]);
	});

	it('says nothing when no dog is recognisable', () => {
		// "All the transfer dogs got flea/tick baths" names a group, not a dog; only a
		// caller holding the groups can turn that into dogs.
		expect(parse('All the transfer dogs got flea/tick baths!').dogNames).toEqual([]);
		expect(parse('The 3 Tremonton dogs got baths').dogNames).toEqual([]);
	});

	it('reads a nickname to the dog it belongs to', () => {
		expect(parse('Gwen and MJ got baths today').dogNames).toEqual(['Gwen', 'Mary Jane']);
	});

	it('reads the terse form', () => {
		// How a bath gets noted while working through the kennels.
		expect(parseBathMessage('birdie bath', ['Birdie']).dogNames).toEqual(['Birdie']);
		expect(parseBathMessage('archer bath', ['Archer']).dogNames).toEqual(['Archer']);
	});

	it('reads the word heading a list', () => {
		expect(parseBathMessage('Baths Roomba and Toby.', ['Roomba', 'Toby']).dogNames).toEqual([
			'Roomba',
			'Toby'
		]);
		expect(parseBathMessage('Bathed: Phineas, Ferb, Perry', ['Phineas', 'Ferb', 'Perry']).dogNames)
			.toEqual(['Phineas', 'Ferb', 'Perry']);
	});

	it('allows whatever kind of bath it was', () => {
		const dogs = ['Sadie', 'Daisy', 'Maggie'];
		expect(parseBathMessage('Sadie, Daisy, Maggie all got flea and tic baths!', dogs).dogNames)
			.toEqual(dogs);
		expect(parseBathMessage('All new dogs have gotten flea and tick baths', dogs).dogNames).toEqual([]);
	});

	it('returns nothing for a message that is not about a bath', () => {
		expect(parse('Straggler was adopted!').dogNames).toEqual([]);
		expect(parse('Myla on a drive hold').dogNames).toEqual([]);
	});
});
