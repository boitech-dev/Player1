// Upstream helpers: JSON over HTTP, TMDB, Real-Debrid, and a small time-boxed cache in front of
// them (source resolution is cached: a TV re-resolving a sent item is instant).
import { lang } from './i18n.ts';

const { RD_TOKEN = '', TMDB_KEY = '' } = process.env;

export const errMsg = (err: unknown) => err instanceof Error ? err.message : String(err);
/** a .catch() that logs and goes on without a value */
export const warn = (what: string) => (err: unknown): undefined => {
	console.warn(what, errMsg(err));
	return undefined;
};

// the answer's shape is the service's documented one: read through the small interfaces each
// caller declares
export async function getJSON<T>(url: string, opts?: RequestInit): Promise<T> {
	const r = await fetch(url, opts);
	if (!r.ok) {
		const where = url.split('?')[0] ?? url;
		throw new Error(`${r.status} ${RD_TOKEN ? where.replace(RD_TOKEN, '***') : where}`);
	}
	return (r.status === 204 ? {} : await r.json()) as T;
}

export type Params = Record<string, string | number>;
const strings = (p: Params) => Object.entries(p).map(([k, v]) => [k, String(v)]);

export function tmdb<T>(path: string, params: Params = {}) {
	const bearer = TMDB_KEY.length > 40; // v4 read token vs v3 api key
	const qs = new URLSearchParams(strings({
		language: lang() === 'fr' ? 'fr-FR' : 'en-US',
		...params,
		...(bearer ? {} : { api_key: TMDB_KEY }),
	}));
	const opts = bearer ? { headers: { Authorization: `Bearer ${TMDB_KEY}` } } : {};
	return getJSON<T>(`https://api.themoviedb.org/3${path}?${qs}`, opts);
}
export const hasTmdb = !!TMDB_KEY;

export const rd = <T>(path: string, form?: Record<string, string>) => getJSON<T>(`https://api.real-debrid.com/rest/1.0${path}`, {
	method: form ? 'POST' : 'GET',
	headers: { Authorization: `Bearer ${RD_TOKEN}` },
	body: form && new URLSearchParams(form),
});

const cache = new Map<string, { v: unknown; t: number }>();
export async function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const hit = cache.get(key);
	if (hit && hit.t > Date.now() - 3600e3) return hit.v as T;
	const v = await fn();
	cache.set(key, {
		v,
		t: Date.now(),
	});
	return v;
}
// ponytail: 1 cache entry per minute used, fine at household scale
export const fresh = <T>(key: string, fn: () => Promise<T>) => {
	return memo(`${key}:${Math.floor(Date.now() / 60e3)}`, fn);
};
