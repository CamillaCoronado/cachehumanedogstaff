import { describe, it, expect } from 'vitest';
import { parseYardMessage } from './parseYardMessage';

// Every message below is real, from #dog-staff.
const ROSTER = [
	'Mia', 'Jack', 'Junior', 'Sally', 'Pickles', 'Thrifted Emmy Award (Emmy)', 'Straggler',
	'Zinnia', 'Ann', 'Dot (Freya)', 'Paisley', 'Dream', 'Myla', 'Zane', 'Roe', 'Shorty',
	'Ace is the Place', 'Luna'
];
const parse = (t: string) => parseYardMessage(t, ROSTER);

describe('parseYardMessage', () => {
	it('reads a named list', () => {
		expect(parse('Mia jack junior sally pickles Emmy got yard time').dogNames).toEqual([
			'Mia', 'Jack', 'Junior', 'Sally', 'Pickles', 'Thrifted Emmy Award (Emmy)'
		]);
		expect(parse('Stragler pickles zinnia junior sally Ann got yard time').dogNames).toContain('Zinnia');
	});

	it('reads the terse form, with no verb at all', () => {
		expect(parse('Mya Freda shorty roe ann dot zane paisley junior yard time').dogNames).toEqual([
			'Shorty', 'Roe', 'Ann', 'Dot (Freya)', 'Zane', 'Paisley', 'Junior'
		]);
	});

	it('tolerates the usual typo', () => {
		// "yard tine" turns up about as often as "yard time".
		expect(parse('Paisley zane Jack mia Zinnia got yard tine').dogNames).toContain('Paisley');
	});

	it('reads a blanket over the whole shelter', () => {
		expect(parse('All dogs got yard time').allDogs).toBe(true);
		expect(parse('all the healthy dogs got yard time').allDogs).toBe(true);
		expect(parse('All dogs got yard time or day trip').allDogs).toBe(true);
	});

	it('reads a stated duration', () => {
		const r = parse('Dot, Paisley, Dream, all got 15 min in the yard.');
		expect(r.durationMinutes).toBe(15);
		expect(r.dogNames).toEqual(['Dot (Freya)', 'Paisley', 'Dream']);
	});

	it('never reads the inverse as a report', () => {
		// The most dangerous message in the channel: it reads almost identically to a
		// blanket, and marking the shelter enriched on a day nobody went out would hide
		// exactly the dogs the overdue list exists to surface.
		const r = parse('No dogs got yard time, second shift will have to do that');
		expect(r.negated).toBe(true);
		expect(r.allDogs).toBe(false);
		expect(r.dogNames).toEqual([]);
	});

	it('ignores instructions and observations about the yard', () => {
		expect(parse('do not leave ace unattended in yard, he tries to escape.').dogNames).toEqual([]);
		expect(parse('Luna opens up a lot when you take her to the yards').dogNames).toEqual([]);
		expect(parse('Jack is terrified of other dogs in the meet and greet yard').dogNames).toEqual([]);
	});

	it('returns nothing for a message that is not about the yard', () => {
		expect(parse('Straggler was adopted!').dogNames).toEqual([]);
		expect(parse('Mia didn’t eat').dogNames).toEqual([]);
	});
});
