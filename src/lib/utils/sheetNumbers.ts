/**
 * Reads a sheet cell as a number. The API returns formatted text, so "1,234" must not
 * read as 1, and an hours cell formatted as a duration ("12:30") is 12.5.
 */
export function parseSheetNumber(cell: string | undefined): number {
	const value = (cell ?? '').replace(/[,\s]/g, '');
	const duration = value.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
	if (duration) {
		return Number(duration[1]) + Number(duration[2]) / 60 + Number(duration[3] ?? 0) / 3600;
	}
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}
