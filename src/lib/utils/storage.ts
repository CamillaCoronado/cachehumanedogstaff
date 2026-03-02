import { browser } from '$app/environment';

export function readJson<T>(key: string, fallback: T): T {
	if (!browser) return fallback;
	const raw = localStorage.getItem(key);
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch (error) {
		console.warn(`Failed to parse localStorage key ${key}`, error);
		return fallback;
	}
}

export function writeJson<T>(key: string, value: T) {
	if (!browser) return;
	localStorage.setItem(key, JSON.stringify(value));
}

export function createId(prefix = 'id') {
	if (browser && 'crypto' in window && typeof window.crypto.randomUUID === 'function') {
		return window.crypto.randomUUID();
	}
	return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
