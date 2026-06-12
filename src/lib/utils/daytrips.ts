import type { DayTripLog } from '$lib/types';
import { toDate } from '$lib/utils/dates';

export function durationHours(log: DayTripLog) {
	const startedAt = toDate(log.startedAt);
	const endedAt = toDate(log.endedAt) ?? new Date();
	if (!startedAt) return 0;
	return Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 3_600_000);
}

export function formatDuration(hours: number): string {
	if (hours < 0.01) return '—';
	const totalMins = Math.round(hours * 60);
	const h = Math.floor(totalMins / 60);
	const m = totalMins % 60;
	if (h === 0) return `${m}m`;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatTime(d: Date | null): string {
	if (!d) return '—';
	if (d.getHours() === 0 && d.getMinutes() === 0) return '—';
	return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatShortDate(d: Date | null): string {
	if (!d) return '—';
	return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}
