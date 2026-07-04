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
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (error) {
		console.warn(`Failed to write localStorage key ${key}`, error);
	}
}

// For values stored as plain strings (not JSON), e.g. the local role fallback.
export function readString(key: string): string | null {
	if (!browser) return null;
	return localStorage.getItem(key);
}

export function writeString(key: string, value: string) {
	if (!browser) return;
	try {
		localStorage.setItem(key, value);
	} catch (error) {
		console.warn(`Failed to write localStorage key ${key}`, error);
	}
}

export function createId(prefix = 'id') {
	if (browser && 'crypto' in window && typeof window.crypto.randomUUID === 'function') {
		return window.crypto.randomUUID();
	}
	return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
