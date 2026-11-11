// Live checks behind the setup and settings screens: each tries the given values against the
// real service and answers { ok, info } (what the service said: account, version…) or
// { ok: false, err }. Values the user left blank fall back to the saved ones, so a secret can be
// re-checked without typing it again.
import fs from 'node:fs';

import {
	type CheckResult,
	type ServiceId,
	type SettingKey,
	SETTINGS,
} from '@player1/shared/api';

type Values = Record<SettingKey, string>;

const get = async (url: string, opts: RequestInit = {}) => {
	const r = await fetch(url, {
		...opts,
		signal: AbortSignal.timeout(8000),
	});
	if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'refused' : `HTTP ${r.status}`);
	return r;
};
const json = async <T>(r: Promise<Response>) => (await (await r).json()) as T;
const causeCode = (err: Error) => {
	const c = err.cause;
	return c && typeof c === 'object' && 'code' in c ? c.code : undefined;
};
const fail = (err: unknown): CheckResult => {
	const e = err instanceof Error ? err : new Error(String(err));
	// the address can't be reached at all: unknown name, nothing listening, no route, a typo in it
	if (causeCode(e) || e instanceof TypeError) return {
		ok: false,
		err: 'unreachable',
	};
	return {
		ok: false,
		err: e.name === 'TimeoutError' ? 'timeout' : e.message,
	};
};

interface RdUser { type: string; username: string; expiration: string }
interface Manifest { name?: string; resources?: (string | { name: string })[] }
interface JfInfo { ServerName: string; Version: string }

async function rd({ RD_TOKEN }: Values): Promise<CheckResult> {
	const u = await json<RdUser>(get('https://api.real-debrid.com/rest/1.0/user', { headers: { Authorization: `Bearer ${RD_TOKEN}` } }));
	if (u.type === 'premium') return {
		ok: true,
		info: {
			user: u.username,
			until: u.expiration,
		},
	};
	return {
		ok: false,
		err: 'not-premium',
		info: { user: u.username },
	};
}

async function tmdb({ TMDB_KEY }: Values): Promise<CheckResult> {
	const bearer = TMDB_KEY.length > 40;
	await get(`https://api.themoviedb.org/3/configuration${bearer ? '' : `?api_key=${TMDB_KEY}`}`, bearer ? { headers: { Authorization: `Bearer ${TMDB_KEY}` } } : {});
	return { ok: true };
}

async function addon({ STREAM_ADDON }: Values): Promise<CheckResult> {
	const base = STREAM_ADDON.replace(/\/(manifest\.json)?$/, '');
	const m = await json<Manifest>(get(`${base}/manifest.json`));
	return {
		ok: (m.resources || []).some(r => (typeof r === 'string' ? r : r.name) === 'stream'),
		info: { name: m.name },
		err: 'no-streams',
	};
}

async function indexer({ TORZNAB_URL, TORZNAB_KEY }: Values): Promise<CheckResult> {
	const caps = `${TORZNAB_URL}?t=caps&apikey=${encodeURIComponent(TORZNAB_KEY)}`;
	const x = await (await get(caps)).text();
	if (/<error/.test(x)) return {
		ok: false,
		err: /description="([^"]*)"/.exec(x)?.[1] || 'refused',
	};
	if (!/<caps/.test(x)) return {
		ok: false,
		err: 'not-torznab',
	};
	return {
		ok: true,
		info: { name: /<server[^>]*title="([^"]*)"/.exec(x)?.[1] },
	};
}

async function qbit({ QBIT_URL, QBIT_USER, QBIT_PASS, QBIT_FILES }: Values): Promise<CheckResult> {
	const base = QBIT_URL.replace(/\/$/, ''), headers = {
		Referer: base,
		Origin: new URL(base).origin,
	};
	const login = await get(`${base}/api/v2/auth/login`, {
		method: 'POST',
		headers,
		body: new URLSearchParams({
			username: QBIT_USER,
			password: QBIT_PASS,
		}),
	});
	const sid = /\w*SID\w*=[^;]+/.exec(login.headers.get('set-cookie') || '')?.[0];
	if (!sid) return {
		ok: false,
		err: 'refused',
	};
	const version = await (await get(`${base}/api/v2/app/version`, {
		headers: {
			...headers,
			Cookie: sid,
		},
	})).text();
	const whatbox = /\/\/qbittorrent\.[^/]*box\.ca/.test(base);
	if (!QBIT_FILES && !whatbox) return {
		ok: false,
		err: 'files-missing',
		info: { version },
	};
	if (QBIT_FILES && !fs.existsSync(QBIT_FILES)) return {
		ok: false,
		err: 'files-not-found',
		info: { version },
	};
	return {
		ok: true,
		info: {
			version,
			files: QBIT_FILES || 'whatbox',
		},
	};
}

// downloads land in <MEDIA_DIR>/player1
const writable = (media: string) => {
	if (!media) return false;
	try {
		fs.mkdirSync(`${media}/player1`, { recursive: true });
		fs.accessSync(`${media}/player1`, fs.constants.W_OK);
		return true;
	} catch {
		return false;
	}
};

async function jellyfin({ JELLYFIN_URL, JELLYFIN_KEY, MEDIA_DIR }: Values): Promise<CheckResult> {
	if (MEDIA_DIR && !fs.existsSync(MEDIA_DIR)) return {
		ok: false,
		err: 'media-not-found',
	};
	if (!JELLYFIN_URL) return {
		ok: !!MEDIA_DIR,
		err: 'empty',
	};
	const url = `${JELLYFIN_URL.replace(/\/$/, '')}/System/Info`;
	const i = await json<JfInfo>(get(url, { headers: { 'X-Emby-Token': JELLYFIN_KEY } }));
	return {
		ok: true,
		info: {
			name: i.ServerName,
			version: i.Version,
			writable: writable(MEDIA_DIR),
		},
	};
}

const CHECKS: Record<ServiceId, (v: Values) => Promise<CheckResult>> = {
	rd,
	tmdb,
	addon,
	indexer,
	qbit,
	jellyfin,
};

export async function check(name: string, values: Partial<Record<string, unknown>> = {}) {
	if (!Object.hasOwn(CHECKS, name)) return {
		ok: false,
		err: 'unknown',
	};
	const fn = CHECKS[name as ServiceId];
	const v = Object.fromEntries(SETTINGS.map(k => {
		const given = values[k] ?? '';
		return [k, given === '' ? process.env[k] || '' : String(given).trim()];
	})) as Values;
	try {
		return await fn(v);
	} catch (err) {
		return fail(err);
	}
}
