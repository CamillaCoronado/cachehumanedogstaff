// Phone-number helpers for the phone inbox (docs/phone-inbox-plan.md).
// Numbers are stored in E.164 (+1XXXXXXXXXX) so webhook `From` values match
// profiles exactly.

/**
 * Normalizes a US-centric phone input to E.164. Accepts "(435) 555-0134",
 * "435.555.0134", "1-435-555-0134", "+14355550134"; returns null when the
 * input isn't a plausible number.
 */
export function normalizePhoneNumber(input: string | null | undefined): string | null {
	if (!input?.trim()) return null;
	const digits = input.replace(/\D/g, '');
	if (digits.length === 10) return `+1${digits}`;
	if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
	// Already-international input: keep as-is if it looks like E.164.
	if (input.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
	return null;
}

/** Renders +14355550134 as "(435) 555-0134"; non-US E.164 passes through. */
export function formatPhoneNumber(e164: string | null | undefined): string {
	if (!e164) return '';
	const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
	if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
	return e164;
}
