import { describe, expect, it } from 'vitest';
import { tempAdvisory } from './tempGuidelines';

describe('tempAdvisory', () => {
	it('flags everyone at 35 and below, small dogs from 36 to 40', () => {
		expect(tempAdvisory(35)?.label).toBe('Bring everyone inside');
		expect(tempAdvisory(36)?.label).toBe('Bring small dogs inside');
		expect(tempAdvisory(40)?.label).toBe('Bring small dogs inside');
	});

	it('shows nothing in the normal range', () => {
		expect(tempAdvisory(41)).toBeNull();
		expect(tempAdvisory(75)).toBeNull();
		expect(tempAdvisory(79)).toBeNull();
		expect(tempAdvisory(null)).toBeNull();
	});

	it('steps through the heat chart tiers', () => {
		expect(tempAdvisory(80)?.tone).toBe('caution');
		expect(tempAdvisory(85)?.tone).toBe('high');
		expect(tempAdvisory(90)?.tone).toBe('severe');
		expect(tempAdvisory(95)?.tone).toBe('extreme');
		expect(tempAdvisory(104)?.tone).toBe('extreme');
	});
});
