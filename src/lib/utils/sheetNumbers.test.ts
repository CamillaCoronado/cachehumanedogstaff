import { describe, expect, it } from 'vitest';
import { parseSheetNumber } from './sheetNumbers';

describe('parseSheetNumber', () => {
	it('reads thousands separators', () => {
		expect(parseSheetNumber('1,234')).toBe(1234);
		expect(parseSheetNumber('1,234.5')).toBe(1234.5);
	});
	it('reads a duration as hours', () => {
		expect(parseSheetNumber('12:30')).toBe(12.5);
		expect(parseSheetNumber('1:30:00')).toBe(1.5);
	});
	it('reads blanks and junk as zero', () => {
		expect(parseSheetNumber('')).toBe(0);
		expect(parseSheetNumber(undefined)).toBe(0);
		expect(parseSheetNumber('—')).toBe(0);
	});
});
