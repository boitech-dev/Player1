// This device's own memory (localStorage): which profile uses it, its name, its preferences.
// A private window or blocked storage just forgets them.

type Key = 'profile' | 'lang' | 'dev' | 'devname' | 'quality' | 'caps' | 'hwover' | 'dkind'
	| `subdelay:${string}`;

export function load(k: Key): string | null {
	try {
		return localStorage.getItem(k);
	} catch {
		return null;
	}
}

export function keep(k: Key, v: string | number | null) {
	try {
		if (v === null || v === '') localStorage.removeItem(k);
		else localStorage.setItem(k, String(v));
	} catch {
		// storage blocked: nothing to remember
	}
}

export function loadJSON<T>(k: Key): T | null {
	try {
		return JSON.parse(load(k) ?? 'null') as T | null;
	} catch {
		return null;
	}
}

export const keepJSON = (k: Key, v: unknown) => keep(k, v == null ? null : JSON.stringify(v));

/** the one-time setup link's token, kept for this tab only */
export function setupToken() {
	try {
		return sessionStorage.getItem('setup') ?? '';
	} catch {
		return '';
	}
}

export function setSetupToken(v: string | null) {
	try {
		if (v) sessionStorage.setItem('setup', v);
		else sessionStorage.removeItem('setup');
	} catch {
		// storage blocked: the link has to be opened again
	}
}
