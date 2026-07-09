import { describe, expect, it } from 'vitest';
import { formatPhoneNumber, normalizePhoneNumber } from './phone';

describe('normalizePhoneNumber', () => {
	it('normalizes common US formats to E.164', () => {
		expect(normalizePhoneNumber('(435) 555-0134')).toBe('+14355550134');
		expect(normalizePhoneNumber('435.555.0134')).toBe('+14355550134');
		expect(normalizePhoneNumber('4355550134')).toBe('+14355550134');
		expect(normalizePhoneNumber('1-435-555-0134')).toBe('+14355550134');
		expect(normalizePhoneNumber('+1 435 555 0134')).toBe('+14355550134');
	});

	it('passes through non-US E.164', () => {
		expect(normalizePhoneNumber('+447911123456')).toBe('+447911123456');
	});

	it('rejects implausible input', () => {
		expect(normalizePhoneNumber('')).toBeNull();
		expect(normalizePhoneNumber(null)).toBeNull();
		expect(normalizePhoneNumber('555-0134')).toBeNull();
		expect(normalizePhoneNumber('not a number')).toBeNull();
		expect(normalizePhoneNumber('12345')).toBeNull();
	});
});

describe('formatPhoneNumber', () => {
	it('renders US numbers readably and passes others through', () => {
		expect(formatPhoneNumber('+14355550134')).toBe('(435) 555-0134');
		expect(formatPhoneNumber('+447911123456')).toBe('+447911123456');
		expect(formatPhoneNumber(null)).toBe('');
	});
});
