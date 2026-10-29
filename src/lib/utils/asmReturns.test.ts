import { describe, expect, it } from 'vitest';
import { dogsNeedingReturns, parseAsmReturns } from './asmReturns';

describe('parseAsmReturns', () => {
	it('keeps returned exit movements with category and reason, oldest first', () => {
		const rows = [
			{ MOVEMENTTYPE: 1, MOVEMENTNAME: 'Adoption', MOVEMENTDATE: '2026-08-01T00:00:00', RETURNDATE: '2026-09-10T00:00:00', RETURNEDREASONNAME: 'Behavior', REASONFORRETURN: ' bit the cat ' },
			{ movementtype: 1, movementname: 'Trial Adoption', movementdate: '2026-04-01', returndate: '2026-04-05', returnedreasonname: 'Allergies', reasonforreturn: '' }
		];
		expect(parseAsmReturns(rows, '2026-10-29')).toEqual([
			{ returnedAt: '2026-04-05', leftAt: '2026-04-01', movement: 'Trial Adoption', category: 'Allergies', reason: '' },
			{ returnedAt: '2026-09-10', leftAt: '2026-08-01', movement: 'Adoption', category: 'Behavior', reason: 'bit the cat' }
		]);
	});

	it('leaves out fosters, open movements, reservations and future returns', () => {
		const rows = [
			{ MOVEMENTTYPE: 2, MOVEMENTDATE: '2026-05-01', RETURNDATE: '2026-05-09' },
			{ MOVEMENTTYPE: 1, MOVEMENTDATE: '2026-10-01', RETURNDATE: null },
			{ MOVEMENTTYPE: 0, RESERVATIONDATE: '2026-03-01', RETURNDATE: '2026-03-02' },
			{ MOVEMENTTYPE: 3, MOVEMENTDATE: '2026-10-20', RETURNDATE: '2026-11-02' }
		];
		expect(parseAsmReturns(rows, '2026-10-29')).toEqual([]);
	});
});

describe('dogsNeedingReturns', () => {
	it('picks returned dogs not yet read for their current intake', () => {
		const docs = new Map<string, Record<string, unknown>>([
			['1', { asmId: 1, originalIntakeDate: '2026-01-01', intakeDate: '2026-09-10' }],
			['2', { asmId: 2, originalIntakeDate: '2026-01-01', intakeDate: '2026-01-01T00:00:00' }],
			['3', { asmId: 3, originalIntakeDate: '2026-01-01', intakeDate: '2026-09-10', returnHistoryFor: '2026-09-10' }],
			['4', { asmId: 4, originalIntakeDate: '2026-01-01', intakeDate: '2026-10-20', returnHistoryFor: '2026-09-10' }],
			['abc', { originalIntakeDate: '2026-01-01', intakeDate: '2026-09-10' }]
		]);
		expect(dogsNeedingReturns(docs)).toEqual([
			{ id: '1', asmId: 1, intake: '2026-09-10' },
			{ id: '4', asmId: 4, intake: '2026-10-20' }
		]);
	});
});
